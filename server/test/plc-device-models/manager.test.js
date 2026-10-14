'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const api = require('../../api/plc-device-models');

function request(app, method, route, body) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const data = body ? JSON.stringify(body) : '';
            const req = http.request({ method, port: server.address().port, path: route,
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, response => {
                let text = '';
                response.on('data', chunk => { text += chunk; });
                response.on('end', () => server.close(() => resolve({ status: response.statusCode, body: text })));
            });
            req.on('error', reject);
            req.end(data);
        });
    });
}

function runChild(script, mode, dir) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, mode, dir]);
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`${mode}: ${output}`)));
    });
}

describe('PLC Device Models', function () {
    it('returns HTTP 207 when tags commit but the runtime reload fails', async function () {
        const devices = Object.fromEntries(require('../../../tools/plc-device-model/test/fixtures/devices.empty-valves.json')
            .map(device => [device.id, structuredClone(device)]));
        const id = 'd_b6ba9d1c-2b054dc3';
        const rows = [{ 'Device Name': 'V101', 'PLC Device ID': id, 'Device Model': 'Valve@1.0.0',
            'Array Symbol': 'GVL.g_aValve_HMI', 'Array Indices': '1,1', Profile: 'Full' }];
        const project = {
            getDevices: () => devices,
            getModelInstances: () => rows,
            getDevicesHash: () => crypto.createHash('sha256').update(JSON.stringify([devices, rows])).digest('hex'),
            commitDeviceTags: async (deviceId, hash, build) => {
                const result = build(structuredClone(devices[deviceId]));
                devices[deviceId] = result.device;
                return result;
            }
        };
        const app = express();
        app.use(express.json());
        app.use(api.app({ project, update: async (cmd, device, options) => {
            assert.equal(cmd, 'set-device');
            assert.deepEqual(options, { suppressRestore: true });
            throw new Error('start failed');
        } },
            (req, res, next) => { req.userId = 'admin'; next(); }, () => 255));
        const preview = await request(app, 'POST', '/api/plc-device-models/preview', { rows });
        assert.equal(preview.status, 200);
        const result = await request(app, 'POST', '/api/plc-device-models/apply',
            { token: JSON.parse(preview.body).token, confirmed: true });
        assert.equal(result.status, 207);
        assert.equal(JSON.parse(result.body).persistence, 'committed');
        assert.deepEqual(JSON.parse(result.body).runtime, { status: 'failed', message: 'start failed' });
        assert.equal(Object.keys(devices[id].tags).length, 20);
    });

    it('rejects operator Apply before calling project mutation', async function () {
        let called = false;
        const app = express();
        app.use(express.json());
        app.use(api.app({ project: {}, update: async () => { called = true; } },
            (req, res, next) => { req.userId = 'operator'; next(); }, () => 1));
        const result = await request(app, 'POST', '/api/plc-device-models/apply', { token: 'x', confirmed: true });
        assert.equal(result.status, 401);
        assert.equal(called, false);
    });

    it('serves the v2 save, Preview and Apply flow with version checks', async function () {
        const devices = Object.fromEntries(require('../../../tools/plc-device-model/test/fixtures/devices.empty-valves.json')
            .map(device => [device.id, structuredClone(device)]));
        const id = 'd_b6ba9d1c-2b054dc3';
        let configurations = [];
        const project = {
            getDevices: () => devices,
            getTagGeneratorConfigurations: () => structuredClone(configurations),
            getTagGeneratorModels: () => [],
            getDevicesHash: () => crypto.createHash('sha256').update(JSON.stringify([devices, configurations])).digest('hex'),
            saveTagGeneratorConfigurations: async (next, hash) => {
                assert.equal(hash, project.getDevicesHash());
                configurations = structuredClone(next);
            },
            commitDeviceTags: async (deviceId, hash, build) => {
                assert.equal(hash, project.getDevicesHash());
                const result = build(structuredClone(devices[deviceId]));
                devices[deviceId] = result.device;
                return result;
            }
        };
        const app = express();
        app.use(express.json());
        app.use(api.app({ project, update: async (cmd, device, options) => {
            assert.equal(cmd, 'set-device');
            assert.deepEqual(options, { suppressRestore: true });
        } },
            (req, res, next) => { req.userId = 'admin'; next(); }, () => 255));
        const initial = JSON.parse((await request(app, 'GET', '/api/plc-device-models/configurations')).body);
        const config = { schemaVersion: 2, id: 'start', name: 'Start', deviceId: id,
            tagPrefix: 'Start', adsSymbol: 'GVL.bStart', valueKind: 'primitive', plcType: 'BOOL',
            array: { mode: 'scalar' } };
        const missingHash = await request(app, 'POST', '/api/plc-device-models/configurations',
            { configurations: [config] });
        assert.equal(missingHash.status, 400);
        const saved = await request(app, 'POST', '/api/plc-device-models/configurations',
            { configurations: [config], expectedHash: initial.hash });
        assert.equal(saved.status, 200);
        const currentHash = JSON.parse(saved.body).hash;
        assert.equal((await request(app, 'POST', '/api/plc-device-models/preview',
            { configurationIds: ['start'], expectedHash: initial.hash })).status, 409);
        const preview = await request(app, 'POST', '/api/plc-device-models/preview',
            { configurationIds: ['start'], expectedHash: currentHash });
        assert.equal(preview.status, 200);
        const applied = await request(app, 'POST', '/api/plc-device-models/apply',
            { token: JSON.parse(preview.body).token, confirmed: true });
        assert.equal(applied.status, 200);
        assert.equal(Object.keys(devices[id].tags).length, 1);
    });

    it('persists instances and tags through a separate process reopen', async function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-phase3b-'));
        const script = path.join(__dirname, 'persistence.child.cjs');
        try {
            for (const mode of ['apply', 'reopen']) {
                await runChild(script, mode, dir);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
