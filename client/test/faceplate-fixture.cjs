// Existing licensed Valve asset; disabled ADS and temporary SQLite only.
const { device, view: original } = require('./widget-prefix-fixture.cjs');
function widget(id, prefix, inherit = false) {
    const item = structuredClone(original.items.widget_V101);
    item.id = id; item.name = id;
    item.property.events = [];
    item.property.varsToBind.find(v => v.originalName === '_ps_label').variableValue = id;
    if (inherit) {
        delete item.property.prefixBinding;
        item.property.inheritFaceplateBinding = true;
    } else item.property.prefixBinding.parameters['#1'] = prefix;
    return item;
}
function svg(items, width, height) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        items.map((id,i) => `<g id="${id}" type="svg-ext-own_ctrl-image" transform="translate(${i % 4 * 290},${Math.floor(i/4)*220+20})"><rect width="280" height="160" stroke-width="0"/><foreignObject width="280" height="160"><div xmlns="http://www.w3.org/1999/xhtml" id="D-OXC_${id}" style="width:100%;height:100%;"></div></foreignObject></g>`).join('') + '</svg>';
}
const faceplate = {id:'faceplate_prefix',name:'Valve.Faceplate',type:'svg',profile:{width:1160,height:210,bkcolor:'#ffffff'},variables:{},items:{}};
faceplate.items.feedback = widget('feedback', '', true);
faceplate.items.secondary = widget('secondary', '', true);
faceplate.items.secondary.property.events = [{type:'click',action:'ondialog',actparam:faceplate.id,actoptions:{}}];
faceplate.items.fixed = widget('fixed', 'V102');
faceplate.items.manual = widget('manual', 'V101');
delete faceplate.items.manual.property.prefixBinding;
faceplate.items.manual.property.scriptContent.content += '\nwModule_fixture.postValue = function() {};';
faceplate.items.manual.property.varsToBind.filter(v=>v.type==='boolean').forEach((v,i) => {v.variableId=`t_fixture_V101_${i}`;delete v.variableValue;});
faceplate.svgcontent = svg(Object.keys(faceplate.items),1160,210);
const host = {id:'faceplate_host',name:'Faceplate Prefix Fixture',type:'svg',profile:{width:1160,height:480,bkcolor:'#ffffff'},variables:{},items:{}};
for (const [id,prefix,action] of [['d101','V101','ondialog'],['d102','V102','ondialog'],['c101','V101','onwindow'],['c102','V102','onwindow'],
    ['bad_device','V101','ondialog'],['bad_tag','Unknown','ondialog'],['bad_parameter','','ondialog']]) {
    const source = widget(id,prefix);
    source.property.events = [{type:'click',action,actparam:faceplate.id,actoptions:{left:50,top:500,relativeFrom:'window'}}];
    if (id === 'bad_device') source.property.prefixBinding.deviceId = 'absent';
    host.items[id] = source;
}
host.svgcontent = svg(Object.keys(host.items),1160,480);
host.items.no_context = {id:'no_context',type:'svg-ext-shapes',property:{events:[{type:'click',action:'ondialog',actparam:faceplate.id,actoptions:{}}]}};
host.svgcontent = host.svgcontent.slice(0,-6) + '<g id="no_context" type="svg-ext-shapes" transform="translate(900,250)"><rect width="180" height="40" fill="#ddd"/><text y="25">No context</text></g></svg>';
async function main() {
    const project = require('../../server/runtime/project'), storage = require('../../server/runtime/project/prjstorage');
    await project.init({workDir:process.argv[3]}, {info(){},warn(){},error(e){throw Error(e);}}, {checkPermission:()=>({show:true,enabled:true})});
    await project.load();
    if (process.argv[2] === 'seed') {
        await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
        for (const view of [host,faceplate]) await project.setProjectData(project.ProjectDataCmdType.SetView, view);
    }
    const saved = await project.getProject();
    require('node:assert/strict').deepEqual(saved.devices[device.id],device);
    const shared = saved.hmi.views.find(v=>v.id===faceplate.id);
    for (const id of ['feedback','secondary']) {
        require('node:assert/strict').equal(shared.items[id].property.inheritFaceplateBinding,true);
        require('node:assert/strict').equal(shared.items[id].property.prefixBinding,undefined);
    }
    storage.close();
    console.log('SQLite persisted inherited definitions and original Tag identities');
}
module.exports = {device,host,faceplate};
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1;});
