'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
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
