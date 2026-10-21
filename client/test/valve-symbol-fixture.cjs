// Isolated Phase B runtime project; disabled ADS devices, no write targets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { device: source } = require('./widget-prefix-fixture.cjs');
const device = structuredClone(source);
const svg = fs.readFileSync(path.join(__dirname, '../../custom/widgets/valves/NexFuxa_ValveSymbol.svg'), 'utf8');
const profile = JSON.parse(svg.match(/data-fuxa-binding-profile="1"><!\[CDATA\[([\s\S]*?)\]\]>/)[1]);
const ref = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/_helpers/svg-utils.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true }
}).outputText, { module: ref, exports: ref.exports, require: n => n === '@angular/core' ? { Injectable: () => target => target } : {} });
const script = ref.exports.SvgUtils.processWidget(svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)[1], 'wModule_fixture', {});
const instances = require('../../docs/component-ui/examples/valve-instances.json');
const view = { id: 'valve_symbols', name: 'Valve Symbol Phase B', type: 'svg', variables: {}, profile: { width: 1100, height: 650, bkcolor: '#E6E8EB' }, items: {} };
let content = '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="650"><path d="M0 100H1100" stroke="#7B8794" fill="none"/>';
for (const [i, variant] of ['compact', 'standard', 'detailed'].entries()) {
    const id = `symbol_${variant}`;
    const prefix = instances[i === 1 ? 1 : 0].prefixBinding.parameters['#1'];
    view.items[id] = { id, name: prefix, type: 'svg-ext-own_ctrl-image', property: {
        type: 'widget', address: 'NexFuxa_ValveSymbol.svg', bindingProfile: profile,
        prefixBinding: { deviceId: device.id, parameters: {'#1': prefix} }, layout: { symbolVariant: variant },
        componentUi: { metadata: { label: `${prefix} 进料阀 Intake Valve`, description: 'Phase B fixture', direction: i * 90 } },
        svgContent: svg.replace(/<script><!\[CDATA\[[\s\S]*?\]\]><\/script>/, ''),
        scriptContent: { moduleId: 'wModule_fixture', content: script.content }, varsToBind: structuredClone(script.vars),
        events: [{ type: 'click', action: 'ondialog', actparam: 'symbol_detail', actoptions: {} }]
    } };
    const [w,h] = [[96,112],[144,152],[192,184]][i];
    content += `<g id="${id}" type="svg-ext-own_ctrl-image" transform="translate(${20+i*240},40)"><svg width="${w}" height="${h}"><svg id="D-OXC_${id}" width="${w}" height="${h}"/></svg></g>`;
}
const otherDevice = structuredClone(device);
otherDevice.id += '_other'; otherDevice.name = 'Second PLC Fixture';
otherDevice.tags = Object.fromEntries(Object.values(otherDevice.tags).map(tag => { tag.id += '_other'; return [tag.id, tag]; }));
view.items.symbol_other = structuredClone(view.items.symbol_standard);
view.items.symbol_other.id = 'symbol_other';
view.items.symbol_other.property.prefixBinding = { deviceId: otherDevice.id, parameters: {'#1':'V101'} };
view.items.symbol_other.property.componentUi.metadata.label = 'Second PLC V101';
view.items.symbol_other.property.bindingProfile = structuredClone(profile);
view.items.symbol_other.property.bindingProfile.bindings._pb_isManualMode = '{#1}_missing_h';
delete view.items.symbol_other.property.events;
content += '<g id="symbol_other" type="svg-ext-own_ctrl-image" transform="translate(760,40)"><svg width="144" height="152"><svg id="D-OXC_other" width="144" height="152"/></svg></g>';
view.svgcontent = content + '</svg>';
const detail = structuredClone(view);
detail.id = 'symbol_detail'; detail.name = 'Symbol Read-only Detail';
detail.items = { symbol_standard: structuredClone(view.items.symbol_standard) };
delete detail.items.symbol_standard.property.prefixBinding;
detail.items.symbol_standard.property.inheritFaceplateBinding = true;
delete detail.items.symbol_standard.property.events;
detail.svgcontent = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240"><g id="symbol_standard" type="svg-ext-own_ctrl-image"><svg width="192" height="184"><svg id="D-OXC_detail" width="192" height="184"/></svg></g></svg>';
detail.profile = { width: 300, height: 240, bkcolor:'#E6E8EB' };
async function main() {
    const project = require('../../server/runtime/project');
    const storage = require('../../server/runtime/project/prjstorage');
    await project.init({workDir:process.argv[3]}, {info(){},warn(){},error(e){throw Error(e);}}, {checkPermission:()=>({show:true,enabled:true})});
    await project.load();
    if (process.argv[2] === 'seed') {
        for (const d of [device, otherDevice]) await project.setProjectData(project.ProjectDataCmdType.SetDevice, d);
        for (const v of [view, detail]) await project.setProjectData(project.ProjectDataCmdType.SetView, v);
    }
    const saved = await project.getProject();
    require('node:assert/strict').deepEqual(saved.hmi.views.find(v=>v.id===view.id).items, JSON.parse(JSON.stringify(view.items)));
    storage.close();
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1;});
