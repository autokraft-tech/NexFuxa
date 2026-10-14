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
        fs.writeFileSync(path.join(dir, 'original-tag.json'), JSON.stringify(existing));
    } else {
        assert.deepEqual(manager.instances(), rows);
        const device = project.getDevices()[id];
        assert.equal(Object.values(device.tags).filter(tag => tag.address?.startsWith('GVL.g_aValve_HMI[')).length, 40);
        const tag = JSON.parse(fs.readFileSync(path.join(dir, 'original-tag.json'), 'utf8'));
        assert.deepEqual(device.tags[tag.id], tag);
        const saved = await project.getProject();
        assert.equal(saved.hmi.views.find(view => view.id === 'v_phase3b_binding').items.valve.property.varsToBind[0].variableId, tag.id);
    }
    storage.close();
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
