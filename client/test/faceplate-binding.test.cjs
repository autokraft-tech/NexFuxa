const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
    const code = ts.transpileModule(fs.readFileSync(`${__dirname}/../src/app/${file}`, 'utf8'), {
        compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, experimentalDecorators:true}
    }).outputText;
    const module = {exports:{}};
    vm.runInNewContext(code, {module, exports:module.exports, console, require: name => imports[name] || {}});
    return module.exports;
}
const { WidgetBindingResolver: Resolver } = load('_helpers/widget-binding.ts');
const devices = [{id:'ads',tags:{t1:{id:'t1',name:'V101_sts_extended',type:'BOOL'},t2:{id:'t2',name:'V102_sts_extended',type:'BOOL'}}}];
const context = prefix => ({deviceId:'ads',parameters:{'#1':prefix}});
const inherited = () => ({inheritFaceplateBinding:true, bindingProfile:{version:1,bindings:{_pb_extended:'{#1}_sts_extended'}},
    varsToBind:[{originalName:'_pb_extended',name:'_pb_extended',type:'boolean',variableId:'stale',variableValue:'true'}]});
test('an inherited Widget resolves its instance context without Variables Mapping', () => {
    const a = inherited(), b = inherited();
    Resolver.apply(a, devices, context('V101'));
    Resolver.apply(b, devices, context('V102'));
    assert.equal(a.varsToBind[0].variableId, 't1');
    assert.equal(b.varsToBind[0].variableId, 't2');
});

test('missing context clears stale IDs/defaults and never uses a fixed config accidentally', () => {
    const p = inherited(); p.prefixBinding = context('V102');
    const result = Resolver.apply(p, devices);
    assert.match(result[0].error, /Missing Faceplate Binding Context/);
    assert.equal(p.varsToBind[0].variableId, undefined);
    assert.equal(p.varsToBind[0].variableValue, undefined);
});
for (const [name, config, pattern] of [
    ['parameter', {deviceId:'ads',parameters:{}}, /Missing parameter/],
    ['device', {deviceId:'absent',parameters:{'#1':'V101'}}, /PLC Device does not exist/],
    ['Tag', context('Unknown'), /Missing Tag/]
]) test(`missing ${name} fails closed per instance`, () => {
    const p = inherited();
    assert.match(Resolver.apply(p, devices, config)[0].error, pattern);
    assert.equal(p.varsToBind[0].variableId, undefined);
    assert.equal(p.varsToBind[0].variableValue, undefined);
});
test('fixed Prefix ignores the parent, Manual stays unchanged, and type checks are reused', () => {
    const fixed = inherited(); delete fixed.inheritFaceplateBinding; fixed.prefixBinding = context('V101');
    Resolver.apply(fixed, devices, context('V102'));
    assert.equal(fixed.varsToBind[0].variableId, 't1');
    const manual = inherited(); delete manual.inheritFaceplateBinding;
    Resolver.apply(manual, devices, context('V102'));
    assert.equal(manual.varsToBind[0].variableId, 'stale');
    const p = inherited(), wrong = structuredClone(devices); wrong[0].tags.t1.type = 'INT';
    assert.match(Resolver.apply(p, wrong, context('V101'))[0].error, /Type Mismatch/);
    assert.equal(p.varsToBind[0].variableId, undefined);
});
test('context, devices and shared definition are not mutated by resolving runtime clones', () => {
    const definition = inherited(), binding = context('V101');
    const before = JSON.stringify({definition,binding,devices});
    Resolver.apply(structuredClone(definition), devices, binding);
    assert.equal(JSON.stringify({definition,binding,devices}), before);
});
const decorators = {Component:()=>x=>x, Input:()=>()=>{}};
const { FlexWidgetPropertyComponent: Editor } = load('gauges/gauge-property/flex-widget-property/flex-widget-property.component.ts', {
    '@angular/core':decorators, '../../../_helpers/widget-binding':{WidgetBindingResolver:Resolver}
});
test('Manual → fixed Prefix → Inherit → Manual preserves manual settings and clears inherited IDs', () => {
    const p = inherited(); delete p.inheritFaceplateBinding;
    p.varsToBind.push({originalName:'_ps_label',name:'_ps_label',type:'string',variableValue:'Status'});
    const original = JSON.stringify(p.varsToBind);
    const editor = new Editor({getDevices:()=>devices}, {}); editor.property = p;
    editor.setMode(true); p.prefixBinding = context('V102'); editor.validateBindings();
    assert.equal(p.varsToBind[0].variableId, 't2');
    editor.setMode('inherit');
    assert.equal(p.inheritFaceplateBinding, true);
    assert.equal(p.prefixBinding, undefined);
    assert.equal(p.varsToBind[0].variableId, undefined);
    assert.equal(p.varsToBind[1].variableValue, 'Status');
    editor.setMode(false);
    assert.equal(JSON.stringify(p.varsToBind), original);
});
const { ViewRuntimeContext: Context } = load('_helpers/view-runtime-context.ts');
test('runtime context takes an immutable, independent snapshot', () => {
    const binding = context('V101'), definition = {id:'faceplate',items:{}};
    const root = {querySelectorAll:()=>[]};
    const a = new Context(definition, root, binding), b = new Context(definition, root, context('V102'));
    binding.parameters['#1'] = 'changed';
    assert.equal(a.faceplateBinding.parameters['#1'], 'V101');
    assert.equal(b.faceplateBinding.parameters['#1'], 'V102');
    assert.ok(Object.isFrozen(a.faceplateBinding.parameters));
    assert.equal(definition.faceplateBinding, undefined);
    assert.notEqual(a.viewInstanceId, b.viewInstanceId);
});
const models = load('_models/hmi.ts', {'./device':{Tag:class {}}});
const { FuxaViewComponent: Component } = load('fuxa-view/fuxa-view.component.ts', {
    '@angular/core':new Proxy({}, {get:()=>()=>()=>{}}), '../_models/hmi':models,
    'rxjs':{takeUntil:()=>{}},
    '../_helpers/view-runtime-context':{ViewRuntimeContext:Context}, '../_helpers/endpointapi':{EndPointApi:{getURL(){}}}
});
test('Dialog and Card events copy their source config without mutating saved event options', () => {
    const component = Object.create(Component.prototype), received = [];
    component.openDialog = (_, id, options) => received.push(options);
    component.onOpenCard = (_, event, id, options) => received.push(options);
    const config = context('V101'), options = {hideClose:true};
    const gauge = {id:'source',property:{prefixBinding:config}};
    component.runEvents(component, gauge, null, ['ondialog','onwindow'].map(action=>({action,actparam:'shared',actoptions:options})));
    config.parameters['#1'] = 'V102';
    assert.equal(received.length, 2);
    assert.equal(received[0].faceplateBinding.parameters['#1'], 'V101');
    assert.equal(received[1].faceplateBinding.parameters['#1'], 'V101');
    assert.equal(options.faceplateBinding, undefined);
});
test('inherited profiles support multiple numbered parameters and preserve static labels', () => {
    const p = inherited();
    p.bindingProfile.bindings._pb_extended = '{#1}_{#2}';
    p.varsToBind.push({originalName:'_ps_label',name:'_ps_label',type:'string',variableValue:'Feedback'});
    const binding = context('V101'); binding.parameters['#2'] = 'sts_extended';
    Resolver.apply(p, devices, binding);
    assert.equal(p.varsToBind[0].variableId, 't1');
    assert.equal(p.varsToBind[1].variableValue, 'Feedback');
    delete binding.parameters['#2'];
    assert.match(Resolver.apply(p, devices, binding)[0].error, /Missing parameter: #2/);
    assert.equal(p.varsToBind[0].variableId, undefined);
});
test('an unbound source never picks up a context from saved event options or another instance', () => {
    const component = Object.create(Component.prototype);
    const options = {faceplateBinding:context('V102'),variablesMapping:[]};
    const result = component.faceplateOptions({property:{}}, options);
    assert.equal(result.faceplateBinding, undefined);
    assert.equal(options.faceplateBinding.parameters['#1'], 'V102');
});
test('a lazy Dialog captures parameters before awaiting its View', async () => {
    const component = Object.create(Component.prototype), binding = context('V101');
    let finish, data;
    Object.assign(component, {loadGeneration:0, ownedDialogs:new Set(),
        getView:()=>new Promise(resolve=>{finish=resolve;}),
        fuxaDialog:{open:(_, options)=>{data=options.data;return {afterClosed:()=>({pipe:()=>({subscribe(){}})})};}}});
    const pending = component.openDialog(null, 'shared', {faceplateBinding:binding});
    binding.parameters['#1'] = 'V102';
    finish({id:'shared'}); await pending;
    assert.equal(data.faceplateBinding.parameters['#1'], 'V101');
});
const { FlexEventComponent: EventEditor } = load('gauges/gauge-property/flex-event/flex-event.component.ts', {'@angular/core':decorators,'../../../_models/hmi':models});
test('the event editor exposes Faceplate actions only for Prefix or Inherit Widgets', () => {
    const editor = Object.create(EventEditor.prototype);
    editor.property = {prefixBinding:context('V101')};
    assert.equal(editor.faceplateActionLabel('ondialog'), 'Open Faceplate (Dialog)');
    editor.property = {inheritFaceplateBinding:true};
    assert.equal(editor.faceplateActionLabel('onwindow'), 'Open Faceplate (Card)');
    editor.property = {};
    assert.equal(editor.faceplateActionLabel('ondialog'), '');
});
