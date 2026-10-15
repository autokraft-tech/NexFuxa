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

test('DAQ defaults create Tags and repeated Apply previews and preserves existing properties', async () => {
    const { manager, devices } = setup();
    await manager.saveModels([{ ...pump, memberDefaults: { 'Sts.Speed': {
        daq: { enabled: true, interval: 10, changed: true, restored: false }, description: 'Speed' } } }]);
    await manager.saveConfigurations([config('Pump1', { valueKind: 'structure', model: 'Pump@1.0.0',
        adsSymbol: 'GVL.stPump', memberPaths: ['Sts.Speed'] })]);
    const first = preview(manager, ['Pump1']);
    assert.equal(first.rows[0].daq.interval, 10);
    await manager.apply(first.token, 'admin');
    const existing = Object.values(devices[deviceId].tags)[0];
    existing.name = 'HistoricalSpeed';
    existing.type = 'Number';
    const before = structuredClone(devices[deviceId].tags);
    await manager.saveConfigurations([config('Pump1', { valueKind: 'structure', model: 'Pump@1.0.0',
        adsSymbol: 'GVL.stPump', memberPaths: ['Sts.Speed'], memberOverrides: { 'Sts.Speed': { daq: { interval: 5 } } } })]);
    const second = preview(manager, ['Pump1']);
    assert.equal(second.rows[0].operation, 'Reused');
    assert.equal(second.rows[0].actualName, 'HistoricalSpeed');
    assert.equal(second.rows[0].actualType, 'Number');
    assert.equal(second.rows[0].daq.interval, 10);
    assert.equal(second.rows[0].propertiesScope, 'Existing properties preserved');
    await manager.apply(second.token, 'admin');
    assert.deepEqual(devices[deviceId].tags, before);
});

test('legacy migration is deterministic, keeps exact Valve naming and never writes Tags', async () => {
    const { manager, project, devices } = setup();
    const rows = ['1,1', '1,2'].map((indices, i) => ({
        'Device Name': 'V10' + (i + 1), 'PLC Device ID': deviceId, 'Device Model': 'Valve@1.0.0',
        'Array Symbol': 'GVL.g_aValve_HMI', 'Array Indices': indices, Profile: 'Full'
    }));
    project.getModelInstances = () => rows;
    const configs = manager.legacyConfigurations().configurations;
    assert.deepEqual(configs, manager.legacyConfigurations().configurations);
    await manager.saveConfigurations(configs);
    assert.equal(manager.legacyConfigurations().configurations.length, 0);
    const report = preview(manager, configs.map(item => item.id));
    const { expand } = require('../model.cjs');
    const legacy = expand(require('../models/valve.v1.json'), rows);
    assert.deepEqual(report.rows.map(tag => [tag.name, tag.address]), legacy.map(tag => [tag.name, tag.address]));
    assert.equal(Object.keys(devices[deviceId].tags).length, 0);
    assert.deepEqual(project.getModelInstances(), rows);
});

test('new Tags enforce native per-device UNS uniqueness without changing reused Tags', async () => {
    const { manager, devices } = setup();
    await manager.saveConfigurations([config('Start', { memberOverrides: { $value: { unsPath: ' plant/start ' } } })]);
    const first = preview(manager, ['Start']);
    assert.equal(first.rows[0].unsPath, 'plant/start');
    await manager.apply(first.token, 'admin');
    const before = structuredClone(devices[deviceId].tags);
    await manager.saveConfigurations([config('Stop', { adsSymbol: 'GVL.bStop', memberOverrides: { $value: { unsPath: 'plant/start' } } })]);
    const conflict = preview(manager, ['Stop']);
    assert.equal(conflict.rows[0].reason, 'UNS Path conflict');
    await assert.rejects(manager.apply(conflict.token, 'admin'), /conflicts/);
    assert.deepEqual(devices[deviceId].tags, before);
});
