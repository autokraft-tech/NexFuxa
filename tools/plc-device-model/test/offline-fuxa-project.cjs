#!/usr/bin/env node
'use strict';

// Run in an isolated FUXA server environment with sqlite3 installed.
// The import and reopen phases run in separate processes against one temporary workDir.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = process.env.PHASE3A_SERVER_ROOT || path.resolve(__dirname, '../../../server');
const project = require(path.join(serverRoot, 'runtime/project'));
const storage = require(path.join(serverRoot, 'runtime/project/prjstorage'));
const model = require('../models/valve.v1.json');
const workDir = process.env.PHASE3A_WORK_DIR;
const originalPath = process.env.PHASE3A_ORIGINAL_JSON;
const mergedPath = process.env.PHASE3A_MERGED_JSON;
const widgetPath = process.env.PHASE3A_WIDGET_SVG;
const mode = process.argv[2];
const deviceId = 'd_b6ba9d1c-2b054dc3';

if (!workDir || !originalPath || !mergedPath || !widgetPath || !['import', 'reopen'].includes(mode)) {
    throw new Error('Set PHASE3A_WORK_DIR, PHASE3A_ORIGINAL_JSON, PHASE3A_MERGED_JSON, PHASE3A_WIDGET_SVG and pass import or reopen');
}

const logger = { info() {}, warn() {}, error(message) { console.error(message); } };
const runtime = { checkPermission: () => ({ show: true, enabled: true }) };
const original = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
const merged = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
const oldDevice = original.find(device => device.id === deviceId);
const newDevice = merged.find(device => device.id === deviceId);
const parameters = {
    Extended: '_pb_extended', Retracted: '_pb_retracted', Extending: '_pb_extending',
    Retracting: '_pb_retracting', Error: '_pb_error', IsManualMode: '_pb_isManualMode'
};

function expectedBindings() {
    return model.profiles.Status.map(memberPath => {
        const member = memberPath.split('.')[1];
        const address = `GVL.g_aValve_HMI[1,1].${memberPath}`;
        const tag = Object.values(newDevice.tags).find(item => item.address === address);
        assert.ok(tag, `Generated V101 tag missing: ${address}`);
        const originalTag = Object.values(oldDevice.tags).find(item => item.address === address);
        if (originalTag) assert.equal(tag.id, originalTag.id, `V101 widget tag ID changed: ${address}`);
        return { originalName: parameters[member], name: parameters[member], type: 'boolean', variableId: tag.id };
    });
}

function verify(devices, view) {
    assert.deepEqual(Object.keys(devices).sort(), merged.map(device => device.id).sort());
    assert.deepEqual(devices['0'], original.find(device => device.id === '0'));
    assert.deepEqual(devices[deviceId], newDevice);
    for (const [id, tag] of Object.entries(oldDevice.tags)) assert.deepEqual(devices[deviceId].tags[id], tag);
    for (const indices of ['1,1', '1,2']) {
        const tags = Object.values(devices[deviceId].tags).filter(tag => tag.address?.startsWith(`GVL.g_aValve_HMI[${indices}].`));
        assert.equal(tags.length, 20);
        assert.equal(tags.filter(tag => tag.address.includes('.Cmd.')).length, 4);
        assert.equal(tags.filter(tag => tag.address.includes('.Sts.')).length, 9);
        assert.equal(tags.filter(tag => tag.address.includes('.Cfg.')).length, 7);
    }
    assert.equal(view.id, 'v_phase3a_valve_binding');
    const bindings = view.items.widget_v101.property.varsToBind;
    assert.deepEqual(bindings, expectedBindings());
    for (const binding of bindings) {
        const tag = devices[deviceId].tags[binding.variableId];
        assert.ok(tag, `Broken V101 widget binding: ${binding.name}`);
        assert.ok(fs.readFileSync(widgetPath, 'utf8').includes(`let ${binding.name} =`));
    }
}

async function main() {
    fs.mkdirSync(workDir, { recursive: true });
    await project.init({ workDir }, logger, runtime);
    await project.load();
    if (mode === 'import') {
        for (const device of merged) await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
        const view = {
            id: 'v_phase3a_valve_binding', name: 'V101 offline binding check', type: 'svg',
            profile: { width: 280, height: 160 }, svgcontent: '<svg xmlns="http://www.w3.org/2000/svg"><g id="widget_v101"/></svg>',
            variables: {}, items: {
                widget_v101: { id: 'widget_v101', type: 'html-image', property: {
                    type: 'widget', varsToBind: expectedBindings()
                } }
            }
        };
        await project.setProjectData(project.ProjectDataCmdType.SetView, view);
    }
    const saved = await project.getProject();
    const view = saved.hmi.views.find(item => item.id === 'v_phase3a_valve_binding');
    assert.ok(view, 'V101 binding view is missing');
    verify(saved.devices, view);
    console.log(`${mode}: FUXA project storage verified, V101 IDs/bindings and 40 Valve tags intact`);
    storage.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
