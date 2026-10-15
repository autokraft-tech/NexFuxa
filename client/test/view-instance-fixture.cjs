// Existing permitted valve asset; disposable SQLite only, disabled ADS fixture.
const { device, view: prefixView } = require('./widget-prefix-fixture.cjs');
const widget = structuredClone(prefixView.items.widget_V101);
delete widget.property.prefixBinding;
widget.property.scriptContent.content += '\nwModule_fixture.postValue = function() {};';
widget.id = 'valve';
widget.property.varsToBind.filter(v => v.type === 'boolean').forEach((v, i) => {
    v.variableId = `@status_${i}`;
    delete v.variableValue;
});
const shared = { ...structuredClone(prefixView), id: 'faceplate', name: 'Valve.Faceplate.Test',
    profile: { width: 300, height: 210, bkcolor: '#ffffff' }, items: { valve: widget },
    svgcontent: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="210"><defs><linearGradient id="paint"><stop stop-color="blue"/></linearGradient></defs><rect id="decor" width="10" height="10" fill="url(#paint)"/><g id="valve" type="svg-ext-own_ctrl-image"><svg width="280" height="160"><svg id="D-OXC_valve" width="280" height="160"/></svg></g></svg>' };
shared.items.close = { id: 'close', type: 'svg-ext-shapes', property: { events: [{ type: 'click', action: 'onclose' }] } };
shared.svgcontent = shared.svgcontent.replace('</g></svg>', '</g><g id="close" type="svg-ext-shapes" transform="translate(10,170)"><rect width="80" height="30" fill="#ccc"/><text y="20">Close</text></g></svg>');
shared.svgcontent = shared.svgcontent.replace('<defs>', '<style>#decor {stroke:#ffffff;fill:url("#paint");}</style><rect id="ffffff" width="0" height="0"/><defs>');
shared.profile.height = 430;
shared.svgcontent = shared.svgcontent.replace('height="210"', 'height="430"');
shared.items.input = { id: 'input', type: 'svg-ext-html_input', property: { variableId: '@status_0', options: {type:'number', updated:true} } };
shared.items.chart = { id: 'chart', name:'FixtureChart', type: 'svg-ext-html_chart', property: { id:'fixture-chart', type:'realtime1', options:{} } };
shared.items.script = { id:'script', type:'svg-ext-shapes', property:{ events:[{type:'click',action:'onRunScript',actparam:'local-script',actoptions:{params:[]}}] } };
shared.items.table = { id: 'table', type: 'svg-ext-own_ctrl-table', property: { type:'data', options: {
    header:{show:true,height:30}, row:{height:30}, columns:[{id:'value',type:'label',label:'Feedback'}],
    rows:[{cells:[{id:'value',type:'variable',variableId:'@status_0'}]}], selection:{},
    paginator:{show:false}, filter:{show:false}, daterange:{show:false}
} } };
shared.svgcontent = shared.svgcontent.replace('</g></svg>', '</g>' +
    '<g id="script" type="svg-ext-shapes" transform="translate(210,170)"><rect width="70" height="30" fill="#ccc"/><text y="20">Script</text></g>' +
    '<g id="input" type="svg-ext-html_input"><rect x="100" y="170" width="100" height="30"/><foreignObject x="100" y="170" width="100" height="30"><input xmlns="http://www.w3.org/1999/xhtml" id="I-HXI_value"/></foreignObject></g>' +
    '<g id="chart" type="svg-ext-html_chart"><foreignObject id="D-HXC_chart" x="0" y="210" width="280" height="120"/></g>' +
    '<g id="table" type="svg-ext-own_ctrl-table"><foreignObject id="D-OXC_table" x="0" y="340" width="280" height="80"/></g></svg>');
const host = { id: 'host', name: 'Instance Fixture', type: 'svg', profile: { width: 1100, height: 650, bkcolor: '#ffffff' }, items: {}, variables: {} };
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="650">';
for (const [i, [id, action, prefix]] of [['da','ondialog','V101'], ['db','ondialog','V102'], ['ca','onwindow','V101'], ['cb','onwindow','V102'], ['same','ondialog','V101'], ['slow','ondialog','V101'], ['nav','onpage','V101'], ['single','onwindow','V101']].entries()) {
    host.items[id] = { id, type: 'svg-ext-shapes', property: { events: [{ type: 'click', action, actparam: 'faceplate',
        actoptions: { left: i % 2 ? 500 : 160, top: 300, relativeFrom: 'window', variablesMapping:
            Array.from({length:6}, (_, n) => ({ from: { variableId: `@status_${n}` }, to: { variableId: `t_fixture_${prefix}_${n}` } })) } }] } };
    svg += `<g id="${id}" type="svg-ext-shapes" transform="translate(${i*150},20)"><rect width="130" height="50" fill="#385a84"/><text y="30" x="15" fill="white">${id}</text></g>`;
}
host.items.slow.property.events[0].actparam = 'slowface';
host.items.single.property.events[0].actoptions.singleCard = true;
host.items.panel = { id: 'panel', type: 'svg-ext-own_ctrl-panel', property: { viewName: shared.name } };
svg += '<g id="panel" type="svg-ext-own_ctrl-panel" transform="translate(20,100)"><svg width="300" height="210"><foreignObject id="D-OXC_panel" width="300" height="210"/></svg></g></svg>';
host.svgcontent = svg;
async function main() {
    const project = require('../../server/runtime/project');
    const storage = require('../../server/runtime/project/prjstorage');
    await project.init({ workDir: process.argv[3] }, { info(){}, warn(){}, error(e){ throw Error(e); } }, { checkPermission: () => ({show:true, enabled:true}) });
    await project.load();
    await project.setProjectData(project.ProjectDataCmdType.SetDevice, device);
    await project.setProjectData(project.ProjectDataCmdType.Charts, [{id:'fixture-chart',name:'Fixture Trend',
        lines:[{id:'@status_0',device:'@',name:'Feedback',yaxis:1,color:'#228844',lineWidth:1}]}]);
    await project.setProjectData(project.ProjectDataCmdType.SetScript, {id:'local-script',name:'LocalScript',mode:'CLIENT',sync:false,parameters:[],
        code:'await Promise.resolve(); $invokeObject("FixtureChart", "setOptions", {title:"Local script executed"});'});
    for (const view of [shared, host, {...structuredClone(shared), id:'slowface', name:'Slow Faceplate'}]) await project.setProjectData(project.ProjectDataCmdType.SetView, view);
    storage.close();
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
