'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const image = process.argv[2];
if (!image) throw new Error('Provide the locally built Docker image name');
const volume = 'nexfuxa-ci-' + crypto.randomBytes(8).toString('hex');

function docker(...args) {
    const result = spawnSync('docker', args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Docker command failed: ' + args.slice(0, 2).join(' '));
}

function run(code) {
    docker('run', '--rm', '--network', 'none',
        '--mount', 'type=volume,source=' + volume + ',target=/tmp/_appdata',
        '--entrypoint', 'node', image, '-e', code);
}

const init = `
const project = require('./runtime/project');
const storage = require('./runtime/project/prjstorage');
const { createManager } = require('./api/plc-device-models/manager');
const logger = { info() {}, warn() {}, error(error) { throw error; } };
const runtime = { checkPermission: () => ({ show: true, enabled: true }) };
async function open() {
    await project.init({ workDir: '/tmp/_appdata' }, logger, runtime);
    await project.load();
    return createManager(project, async () => {});
}
`;
const seed = `
${init}
(async () => {
    const manager = await open();
    await manager.saveModels([{ schemaVersion: 2, name: 'Pump', version: '1.0.0',
        rootType: 'ST_Pump', types: { ST_Pump: { Running: 'BOOL' } }, profiles: {} }]);
    await project.saveTagGeneratorConfigurations([{ schemaVersion: 2, id: 'pump_1',
        name: 'Pump 1', deviceId: 'isolated', tagPrefix: 'Pump',
        adsSymbol: 'GVL.stPump', valueKind: 'structure', model: 'Pump@1.0.0',
        array: { mode: 'scalar' } }]);
    await project.saveModelInstances([{ 'Device Name': 'V101', 'PLC Device ID': 'isolated',
        'Device Model': 'Valve@1.0.0', 'Array Symbol': 'GVL.g_aValve_HMI',
        'Array Indices': '1,1', Profile: 'Full' }]);
    storage.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
const reopen = `
${init}
const assert = require('node:assert/strict');
(async () => {
    const manager = await open();
    assert.equal(manager.models().models[0].name, 'Pump');
    assert.equal(manager.configurations().configurations[0].id, 'pump_1');
    assert.equal(manager.instances()[0]['Device Name'], 'V101');
    storage.close();
    console.log('Legacy and v2 configurations and custom model survived Docker restart');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

docker('volume', 'create', volume);
try {
    run(seed);
    run(reopen);
} finally {
    docker('volume', 'rm', volume);
}
