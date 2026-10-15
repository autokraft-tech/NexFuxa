// Run against a locally built FUXA image, using only a new disposable volume.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const fixture = require('./widget-prefix-fixture.cjs');
const image = process.argv[2];
if (!image) throw Error('Provide a local FUXA Docker image');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-prefix-docker-'));
const volume = 'nexfuxa-prefix-test-' + crypto.randomBytes(8).toString('hex');
fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(fixture));
function docker(...args) {
    const result = spawnSync('docker', args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error || Error('Docker failed: ' + args[0]);
}
const code = `
const fs = require('fs'), assert = require('assert').strict;
const fixture = JSON.parse(fs.readFileSync('/fixture/fixture.json', 'utf8'));
const project = require('./runtime/project'), storage = require('./runtime/project/prjstorage');
(async () => {
 await project.init({workDir:'/tmp/prefix-data'}, {info(){},warn(){},error(e){throw Error(e)}}, {checkPermission:()=>({show:true,enabled:true})});
 await project.load();
 if (process.argv[1] === 'seed') {
   await project.setProjectData(project.ProjectDataCmdType.SetDevice, fixture.device);
   await project.setProjectData(project.ProjectDataCmdType.SetView, fixture.view);
 }
 const saved = await project.getProject();
 assert.deepEqual(saved.devices[fixture.device.id], fixture.device);
 assert.deepEqual(saved.hmi.views.find(v => v.id === fixture.view.id).items, fixture.view.items);
 storage.close();
 console.log(process.argv[1] + ': Docker SQLite prefix binding persistence passed');
})().catch(e=>{console.error(e);process.exitCode=1});`;
docker('volume', 'create', volume);
try {
    for (const mode of ['seed', 'reopen']) docker('run', '--rm', '--network', 'none',
        '--mount', `type=volume,source=${volume},target=/tmp/prefix-data`,
        '--mount', `type=bind,source=${directory},target=/fixture,readonly`,
        '--entrypoint', 'node', image, '-e', code, mode);
} finally {
    docker('volume', 'rm', volume);
    fs.rmSync(directory, { recursive: true });
}
