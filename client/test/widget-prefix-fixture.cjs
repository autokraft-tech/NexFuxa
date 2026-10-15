// Disposable test project only; never invokes Generator Apply or opens an ADS connection.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const svg = fs.readFileSync(path.join(root, 'custom/widgets/valves/NexPlc_Valve.svg'), 'utf8');
const profile = JSON.parse(svg.match(/<metadata[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]);
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'client/src/app/_helpers/svg-utils.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true }
}).outputText;
const ref = { exports: {} };
vm.runInNewContext(compiled, { module: ref, exports: ref.exports, require: name => name === '@angular/core' ?
    { Injectable: () => target => target } : {} });
const processed = ref.exports.SvgUtils.processWidget(svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)[1], 'wModule_fixture', {});
const deviceId = 'd_b6ba9d1c-2b054dc3';
const device = { id: deviceId, name: 'TwinCAT_ADS Fixture', enabled: false, type: 'ADSclient', property: {}, polling: 1000, tags: {} };
for (const prefix of ['V101', 'V102']) Object.values(profile.bindings).forEach((expression, i) => {
    const id = `t_fixture_${prefix}_${i}`;
    device.tags[id] = { id, name: expression.replace('{#1}', prefix), type: 'Boolean', address: `Fixture.${prefix}.${i}`,
        daq: { enabled: false, changed: false, interval: 60, restored: false } };
});
function widget(prefix) {
    return { id: `widget_${prefix}`, name: prefix, type: 'svg-ext-own_ctrl-image', property: {
        type: 'widget', address: 'NexPlc_Valve.svg', bindingProfile: profile,
        prefixBinding: { deviceId, parameters: { '#1': prefix } },
        svgContent: svg.replace(/<script><!\[CDATA\[[\s\S]*?\]\]><\/script>/, ''),
        scriptContent: { moduleId: 'wModule_fixture', content: processed.content }, varsToBind: processed.vars
    } };
}
const view = { id: 'v_prefix_fixture', name: 'Prefix Binding Fixture', type: 'svg',
    profile: { width: 800, height: 400, bkcolor: '#ffffff' }, variables: {},
    items: { widget_V101: widget('V101'), widget_V102: widget('V102') },
    svgcontent: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">' + ['V101', 'V102'].map((prefix, i) =>
        `<g id="widget_${prefix}" type="svg-ext-own_ctrl-image" transform="translate(${20 + i * 310},40)"><svg width="280" height="160"><svg id="D-OXC_${prefix}" width="280" height="160"></svg></svg></g>`).join('') + '</svg>' };

async function main() {
    const project = require('../../server/runtime/project');
    const storage = require('../../server/runtime/project/prjstorage');
    const assert = require('node:assert/strict');
    const [mode, dir] = process.argv.slice(2);
    await project.init({ workDir: dir }, { info() {}, warn() {}, error(message) { throw Error(message); } },
        { checkPermission: () => ({ show: true, enabled: true }) });
    await project.load();
    if (mode === 'seed') {
        await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
        await project.setProjectData(project.ProjectDataCmdType.SetView, view);
    }
    const saved = await project.getProject();
    const restored = saved.hmi.views.find(item => item.id === view.id);
    assert.deepEqual(restored.items, JSON.parse(JSON.stringify(view.items)));
    assert.deepEqual(saved.devices[deviceId], device);
    storage.close();
    console.log(`${mode}: SQLite preserved two prefix instances, profiles, scripts and all Tag definitions`);
}
module.exports = { device, view };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
