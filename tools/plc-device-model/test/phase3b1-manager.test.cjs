'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createManager } = require('../../../server/api/plc-device-models/manager');
const fixture = require('./fixtures/devices.empty-valves.json');

const deviceId = 'd_b6ba9d1c-2b054dc3';
const config = (id, overrides = {}) => ({ schemaVersion: 2, id, name: id, deviceId,
    tagPrefix: id, adsSymbol: 'GVL.bStart', valueKind: 'primitive', plcType: 'BOOL',
    array: { mode: 'scalar' }, ...overrides });
const pump = { schemaVersion: 2, name: 'Pump', version: '1.0.0', rootType: 'ST_Pump_HMI',
    types: { ST_Pump_HMI: { Cmd: 'ST_Pump_Command', Sts: 'ST_Pump_Status' },
        ST_Pump_Command: { Start: 'BOOL', Stop: 'BOOL' },
        ST_Pump_Status: { Running: 'BOOL', Speed: 'REAL', ErrorCode: 'UDINT' } }, profiles: {} };

function setup(update = async () => {}) {
    const devices = Object.fromEntries(structuredClone(fixture).map(device => [device.id, device]));
    let configurations = [];
    let models = [];
    let writes = 0;
    const project = {
        getDevices: () => devices,
        getTagGeneratorConfigurations: () => structuredClone(configurations),
        getTagGeneratorModels: () => structuredClone(models),
        getDevicesHash: () => crypto.createHash('sha256').update(JSON.stringify([devices, configurations, models])).digest('hex'),
        saveTagGeneratorConfigurations: async (next, hash) => {
            if (hash !== project.getDevicesHash()) throw new Error('stale');
            configurations = structuredClone(next); writes++;
        },
        saveTagGeneratorModels: async (next, hash) => {
            if (hash !== project.getDevicesHash()) throw new Error('stale');
            models = structuredClone(next); writes++;
        },
        commitDeviceTags: async (id, hash, build) => {
            if (hash !== project.getDevicesHash()) { const error = new Error('stale'); error.code = 'stale_preview'; throw error; }
            const result = build(structuredClone(devices[id]));
            devices[id] = result.device; writes++;
            return result;
        }
    };
    return { manager: createManager(project, update), project, devices, writes: () => writes };
}

const preview = (manager, ids) => manager.previewConfigurations(ids, 'admin', manager.configurations().hash);

test('saved v2 config previews and applies, then reuses the same Tag and ID', async () => {
    const { manager, devices } = setup();
    await manager.saveConfigurations([config('Start')]);
    const first = preview(manager, ['Start']);
    assert.equal(first.summary.created, 1);
    assert.equal(first.rows[0].plcType, 'BOOL');
    assert.equal(first.rows[0].sourceConfiguration, 'Start');
    assert.equal(Object.keys(devices[deviceId].tags).length, 0);
    await manager.apply(first.token, 'admin');
    const id = Object.keys(devices[deviceId].tags)[0];
    const second = preview(manager, ['Start']);
    assert.equal(second.summary.reused, 1);
    await manager.apply(second.token, 'admin');
    assert.deepEqual(Object.keys(devices[deviceId].tags), [id]);
});

test('unsaved config and changed config invalidate Preview and Apply', async () => {
    const { manager, devices } = setup();
    assert.throws(() => preview(manager, ['Start']), /not saved/);
    await manager.saveConfigurations([config('Start')]);
    const first = preview(manager, ['Start']);
    await manager.saveConfigurations([config('Start', { adsSymbol: 'GVL.bStop' })]);
    await assert.rejects(manager.apply(first.token, 'admin'), /stale/);
    assert.equal(Object.keys(devices[deviceId].tags).length, 0);
});

test('different configurations with duplicate address or name report conflicts without writing', async () => {
    const { manager, devices } = setup();
    await manager.saveConfigurations([config('Start'), config('Stop')]);
    const addressConflict = preview(manager, ['Start', 'Stop']);
    assert.equal(addressConflict.summary.conflicts, 1);
    await assert.rejects(manager.apply(addressConflict.token, 'admin'), /conflicts/);
    await manager.saveConfigurations([config('Start'), config('Start2', { tagPrefix: 'Start', adsSymbol: 'GVL.bStop' })]);
    const nameConflict = preview(manager, ['Start', 'Start2']);
    assert.equal(nameConflict.summary.conflicts, 1);
    await assert.rejects(manager.apply(nameConflict.token, 'admin'), /conflicts/);
    assert.equal(Object.keys(devices[deviceId].tags).length, 0);
});

test('custom model versions are immutable and cannot be deleted while referenced', async () => {
    const { manager } = setup();
    await manager.saveModels([pump]);
    await assert.rejects(manager.saveModels([{ ...pump, types: { ...pump.types,
        ST_Pump_Status: { Running: 'REAL' } } }]), /immutable/);
    await manager.saveConfigurations([config('Pump1', { valueKind: 'structure', model: 'Pump@1.0.0',
        adsSymbol: 'GVL.stPump' })]);
    assert.equal(preview(manager, ['Pump1']).summary.candidates, 5);
    await assert.rejects(manager.saveModels([]), /referenced/);
    await manager.saveModels([pump, { ...pump, version: '1.0.1' }]);
});

test('invalid config, over-limit expansion and mixed-device batch never write', async () => {
    const { manager, writes } = setup();
    const before = writes();
    await assert.rejects(manager.saveConfigurations([config('Bad', { plcType: 'TIME' })]), /Unsupported/);
    await assert.rejects(manager.saveConfigurations([config('Bad', { array: { mode: 'range',
        dimensions: [{ start: 0, end: 500, step: 1 }] } })]), /500/);
    await assert.rejects(manager.saveConfigurations([config('Bad', { array: { mode: 'range',
        dimensions: [{ start: 0, end: 4, step: 0 }] } })]), /range/);
    assert.equal(writes(), before);
});

test('stale project version, mixed ADS devices and runtime failure are explicit', async () => {
    const context = setup(async () => { throw new Error('start failed'); });
    const { manager, devices } = context;
    const secondId = 'ads_second';
    devices[secondId] = { id: secondId, type: 'ADSclient', tags: {} };
    await manager.saveConfigurations([config('Start'), config('Other', { deviceId: secondId,
        adsSymbol: 'GVL.bOther' })]);
    assert.throws(() => manager.previewConfigurations(['Start'], 'admin', 'old-hash'), /changed/);
    assert.throws(() => preview(manager, ['Start', 'Other']), /one ADS device/);
    const first = preview(manager, ['Start']);
    const result = await manager.apply(first.token, 'admin');
    assert.equal(result.persistence, 'committed');
    assert.deepEqual(result.runtime, { status: 'failed', message: 'start failed' });
    assert.equal(Object.keys(devices[deviceId].tags).length, 1);
});
