'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./fixtures/devices.empty-valves.json');
const { createManager } = require('../../../server/api/plc-device-models/manager');

const id = 'd_b6ba9d1c-2b054dc3';
const rows = () => ['1,1', '1,2'].map((indices, i) => ({
    'Device Name': `V10${i + 1}`, 'PLC Device ID': id, 'Device Model': 'Valve@1.0.0',
    'Array Symbol': 'GVL.g_aValve_HMI', 'Array Indices': indices, Profile: 'Full'
}));

function setup(devices = fixture, update = async () => {}) {
    let state = Object.fromEntries(structuredClone(devices).map(device => [device.id, device]));
    let saved = structuredClone(state);
    let savedRows = structuredClone(rows());
    let failWrite = false;
    const project = {
        getDevices: () => state,
        getModelInstances: () => structuredClone(savedRows),
        saveModelInstances: async input => { savedRows = structuredClone(input); },
        getDevicesHash: () => crypto.createHash('sha256').update(JSON.stringify([state, savedRows])).digest('hex'),
        commitDeviceTags: async (deviceId, hash, build) => {
            if (hash !== project.getDevicesHash()) {
                const error = new Error('stale'); error.code = 'stale_preview'; throw error;
            }
            const result = build(structuredClone(state[deviceId]));
            if (failWrite) throw new Error('SQLite write failed');
            state[deviceId] = result.device;
            saved = structuredClone(state);
            return result;
        }
    };
    const manager = createManager(project, update);
    return { manager, project, state: () => state, saved: () => saved,
        failWrite: () => { failWrite = true; } };
}

test('two Full valves preview and apply 40 tags; repeated apply reuses all tags', async () => {
    const context = setup();
    const first = context.manager.preview(rows(), 'admin');
    assert.deepEqual(first.summary, { candidates: 40, created: 40, reused: 0, conflicts: 0, unchanged: 0 });
    assert.equal(first.rows.find(row => row.name === 'V101_cmd_extend').address, 'GVL.g_aValve_HMI[1,1].Cmd.Extend');
    assert.equal(first.rows.find(row => row.name === 'V102_sts_extended').plcType, 'BOOL');
    assert.deepEqual(context.state(), context.saved(), 'Preview must not write');
    assert.deepEqual(await context.manager.apply(first.token, 'admin'),
        { created: 40, reused: 0, persistence: 'committed', runtime: { status: 'updated' } });
    const second = context.manager.preview(rows(), 'admin');
    assert.equal(second.summary.created, 0);
    assert.equal(second.summary.reused, 40);
    await context.manager.apply(second.token, 'admin');
    assert.equal(Object.keys(context.state()[id].tags).length, 40);
});

test('existing tag IDs, tag data and widget binding IDs survive merge', async () => {
    const original = require('./fixtures/devices.sanitized.json');
    const context = setup(original);
    const before = structuredClone(context.state()[id].tags);
    const widgetBindingIds = Object.keys(before);
    const preview = context.manager.preview(rows(), 'admin');
    await context.manager.apply(preview.token, 'admin');
    for (const bindingId of widgetBindingIds) assert.deepEqual(context.state()[id].tags[bindingId], before[bindingId]);
});

test('conflicts, duplicate instances and invalid indices never write', async () => {
    const context = setup();
    const original = structuredClone(context.state());
    const conflicting = structuredClone(rows());
    conflicting[1]['Array Indices'] = '1,1';
    await context.manager.saveInstances(conflicting);
    const preview = context.manager.preview(conflicting, 'admin');
    assert.ok(preview.summary.conflicts > 0);
    await assert.rejects(context.manager.apply(preview.token, 'admin'), /conflicts/);
    assert.deepEqual(context.state(), original);
    assert.throws(() => context.manager.preview([rows()[0], rows()[0]], 'admin'), /Duplicate/);
    assert.throws(() => context.manager.preview([{ ...rows()[0], 'Array Indices': '-1,1' }], 'admin'), /indices/);
});

test('same name at another address and different type at same address conflict', () => {
    for (const tag of [
        { id: 't_aaaaaaaa-bbbbbbbb', name: 'V101_cmd_extend', address: 'OTHER[1,1].Cmd.Extend', type: 'boolean' },
        { id: 't_aaaaaaaa-bbbbbbbb', name: 'other', address: 'GVL.g_aValve_HMI[1,1].Cmd.Extend', type: 'number' }
    ]) {
        const devices = structuredClone(fixture);
        devices.find(device => device.id === id).tags[tag.id] = tag;
        const context = setup(devices);
        const preview = context.manager.preview([rows()[0]], 'admin');
        assert.ok(preview.summary.conflicts > 0);
    }
});

test('stale preview, wrong owner and failed storage write make no changes', async () => {
    const context = setup();
    const preview = context.manager.preview(rows(), 'admin');
    await assert.rejects(context.manager.apply(preview.token, 'operator'), /expired/);
    context.state()[id].name = 'changed';
    await assert.rejects(context.manager.apply(preview.token, 'admin'), /stale/);
    const next = context.manager.preview(rows(), 'admin');
    const beforeWrite = structuredClone(context.state());
    context.failWrite();
    await assert.rejects(context.manager.apply(next.token, 'admin'), /SQLite/);
    assert.deepEqual(context.state(), beforeWrite);
});

test('Preview accepts only saved rows and Apply rejects a changed saved configuration', async () => {
    const context = setup();
    const unsaved = { ...rows()[0], 'Device Name': 'V999' };
    assert.throws(() => context.manager.preview([unsaved], 'admin'), /not saved/);
    const preview = context.manager.preview([rows()[0]], 'admin');
    await context.manager.saveInstances([rows()[1]]);
    await assert.rejects(context.manager.apply(preview.token, 'admin'), /stale/);
    assert.equal(Object.keys(context.state()[id].tags).length, 0);
    assert.throws(() => context.manager.preview([rows()[0]], 'admin'), /not saved/);
});

test('Apply rechecks saved rows inside the commit even when the hash check passes', async () => {
    const context = setup();
    const preview = context.manager.preview([rows()[0]], 'admin');
    const originalHash = context.project.getDevicesHash();
    await context.manager.saveInstances([rows()[1]]);
    context.project.getDevicesHash = () => originalHash;
    await assert.rejects(context.manager.apply(preview.token, 'admin'), /not saved/);
    assert.equal(Object.keys(context.state()[id].tags).length, 0);
});

test('runtime reload failure is reported after the SQLite commit without undoing tags', async () => {
    let attempts = 0;
    const context = setup(fixture, async () => { if (++attempts === 1) throw new Error('stop failed'); });
    const preview = context.manager.preview([rows()[0]], 'admin');
    const result = await context.manager.apply(preview.token, 'admin');
    assert.deepEqual(result, { created: 20, reused: 0, persistence: 'committed',
        runtime: { status: 'failed', message: 'stop failed' } });
    assert.equal(Object.keys(context.saved()[id].tags).length, 20);
    const retry = context.manager.preview([rows()[0]], 'admin');
    assert.equal(retry.summary.reused, 20);
    assert.deepEqual((await context.manager.apply(retry.token, 'admin')).runtime, { status: 'updated' });
    assert.equal(Object.keys(context.saved()[id].tags).length, 20);
});

test('Phase 3A CSV parser is used for import with bounded valid rows', () => {
    const context = setup();
    const csv = 'Device Name,PLC Device ID,Device Model,Array Symbol,Array Indices,Profile\n' +
        `V101,${id},Valve@1.0.0,GVL.g_aValve_HMI,"1,1",Full\n`;
    assert.deepEqual(context.manager.parseCsv(csv), [rows()[0]]);
    assert.deepEqual(context.manager.parseCsv(csv.replace('Valve@1.0.0', 'Valve').replace(',Full', ',')), [rows()[0]]);
    assert.throws(() => context.manager.parseCsv('x'.repeat(65537)), /64 KB/);
});
