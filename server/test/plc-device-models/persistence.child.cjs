'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const project = require('../../runtime/project');
const storage = require('../../runtime/project/prjstorage');
const { createManager } = require('../../api/plc-device-models/manager');

const dir = process.argv[3];
const mode = process.argv[2];
const id = 'd_b6ba9d1c-2b054dc3';
const rows = ['1,1', '1,2'].map((indices, i) => ({
    'Device Name': `V10${i + 1}`, 'PLC Device ID': id, 'Device Model': 'Valve@1.0.0',
    'Array Symbol': 'GVL.g_aValve_HMI', 'Array Indices': indices, Profile: 'Full'
}));
const pump = { schemaVersion: 2, name: 'Pump', version: '1.0.0', rootType: 'ST_Pump_HMI',
    types: { ST_Pump_HMI: { Cmd: 'ST_Pump_Command', Sts: 'ST_Pump_Status' },
        ST_Pump_Command: { Start: 'BOOL', Stop: 'BOOL' },
        ST_Pump_Status: { Running: 'BOOL', Speed: 'REAL', ErrorCode: 'UDINT' } }, profiles: {},
    memberDefaults: { 'Sts.Speed': { daq: { enabled: true, interval: 10, changed: true, restored: false }, description: 'Pump speed' } } };
const pumpConfiguration = { schemaVersion: 2, id: 'pump_array', name: 'Pump array', deviceId: id,
    tagPrefix: 'Pump', adsSymbol: 'GVL.aPump', valueKind: 'structure', model: 'Pump@1.0.0',
    array: { mode: 'range', dimensions: [{ start: 1, end: 2, step: 1 }] } };
const logger = { info() {}, warn() {}, error(message) { throw new Error(String(message)); } };
const runtime = { checkPermission: () => ({ show: true, enabled: true }) };

async function main() {
    await project.init({ workDir: dir }, logger, runtime);
    await project.load();
    const manager = createManager(project, async () => {});
    if (mode === 'seed') {
        const devices = require('../../../tools/plc-device-model/test/fixtures/devices.empty-valves.json');
        for (const device of devices) {
            if (device.id === id) device.enabled = false;
            await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
        }
    } else if (mode === 'apply') {
        const original = require('../../../tools/plc-device-model/test/fixtures/devices.sanitized.json');
        for (const device of original) await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
        const existing = Object.values(project.getDevices()[id].tags)[0];
        const view = { id: 'v_phase3b_binding', name: 'Binding', type: 'svg',
            profile: { width: 100, height: 100 }, variables: {}, items: {
                valve: { id: 'valve', property: { varsToBind: [{ variableId: existing.id }] } }
            } };
        await project.setProjectData(project.ProjectDataCmdType.SetView, view);
        await manager.saveInstances(rows);
        const preview = manager.preview(rows, 'admin');
        assert.equal(preview.summary.candidates, 40);
        assert.equal(preview.summary.reused, 8);
        await manager.apply(preview.token, 'admin');
        await manager.saveModels([pump]);
        await manager.saveConfigurations([pumpConfiguration]);
        const pumpPreview = manager.previewConfigurations(['pump_array'], 'admin', manager.configurations().hash);
        assert.equal(pumpPreview.summary.candidates, 10);
        await manager.apply(pumpPreview.token, 'admin');
        fs.writeFileSync(path.join(dir, 'original-tag.json'), JSON.stringify(existing));
    } else {
        assert.deepEqual(manager.instances(), rows);
        assert.deepEqual(manager.models().models, [pump]);
        assert.deepEqual(manager.configurations().configurations, [pumpConfiguration]);
        const device = project.getDevices()[id];
        assert.equal(Object.values(device.tags).filter(tag => tag.address?.startsWith('GVL.g_aValve_HMI[')).length, 40);
        assert.equal(Object.values(device.tags).filter(tag => tag.address?.startsWith('GVL.aPump[')).length, 10);
        assert.equal(Object.values(device.tags).find(tag => tag.address === 'GVL.aPump[1].Sts.Speed').daq.interval, 10);
        const tag = JSON.parse(fs.readFileSync(path.join(dir, 'original-tag.json'), 'utf8'));
        assert.deepEqual(device.tags[tag.id], tag);
        const saved = await project.getProject();
        assert.equal(saved.hmi.views.find(view => view.id === 'v_phase3b_binding').items.valve.property.varsToBind[0].variableId, tag.id);
    }
    storage.close();
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
