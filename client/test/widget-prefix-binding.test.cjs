const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, imports = {}, globals = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/app', relative), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true
    } }).outputText;
    const ref = { exports: {} };
    vm.runInNewContext(compiled, { module: ref, exports: ref.exports, console,
        require: name => imports[name] || {}, ...globals });
    return ref.exports;
}
const { WidgetBindingResolver: Resolver } = load('_helpers/widget-binding.ts');
const svg = fs.readFileSync(path.join(__dirname, '../../custom/widgets/valves/NexPlc_Valve.svg'), 'utf8');
const profile = JSON.parse(svg.match(/<metadata[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]);
const variables = () => Object.keys(profile.bindings).map(name => ({ originalName: name, name, type: 'boolean' }));
const config = prefix => ({ deviceId: 'ads', parameters: { '#1': prefix } });
const devices = () => [{ id: 'ads', enabled: true, tags: Object.fromEntries(['V101', 'V102', 'V105_1_5'].flatMap(prefix =>
    Object.values(profile.bindings).map((template, i) => [`id-${prefix}-${i}`, { id: `id-${prefix}-${i}`,
        name: template.replace('{#1}', prefix), type: 'Boolean', address: `GVL.${prefix}.${i}`, daq: { enabled: true } }]))) }];
const property = prefix => ({ bindingProfile: structuredClone(profile), prefixBinding: config(prefix), varsToBind: variables() });
const plain = value => JSON.parse(JSON.stringify(value));

test('all profile expressions resolve exact device/name to existing IDs without mutating Tags', () => {
    const tags = devices();
    const before = structuredClone(tags);
    const results = Resolver.apply(property('V101'), tags);
    assert.equal(results.length, 6);
    results.forEach((r, i) => { assert.equal(r.tagId, `id-V101-${i}`); assert.equal(r.error, undefined); });
    assert.deepEqual(tags, before);
});
test('supports full multidimensional prefixes and multiple numbered parameters', () => {
    assert.equal(Resolver.apply(property('V105_1_5'), devices())[0].tagId, 'id-V105_1_5-0');
    const p = property('V101');
    p.bindingProfile.bindings._pb_extended = '{#1}_{#2}';
    p.prefixBinding.parameters['#2'] = 'sts_extended';
    assert.equal(Resolver.apply(p, devices())[0].tagId, 'id-V101-0');
});
test('missing parameters and malformed templates have explicit errors', () => {
    assert.match(Resolver.apply(property(''), devices())[0].error, /Missing parameter/);
    const p = property('V101');
    p.bindingProfile.bindings._pb_extended = '{#0}_sts_extended';
    assert.match(Resolver.apply(p, devices())[0].error, /Invalid or unresolved/);
});
test('missing devices never fall back to a different PLC', () => {
    const p = property('V101'); p.prefixBinding.deviceId = 'absent';
    assert.match(Resolver.apply(p, devices())[0].error, /PLC Device does not exist/);
});
test('exact, case sensitive name lookup never uses addresses or other devices', () => {
    const tags = devices();
    tags.push({ id: 'other', tags: structuredClone(tags[0].tags) });
    tags[0].tags['id-V101-0'].name = 'v101_sts_extended';
    assert.match(Resolver.apply(property('V101'), tags)[0].error, /Missing Tag/);
});
test('duplicate names and duplicate device IDs are ambiguous', () => {
    const tags = devices();
    tags[0].tags.duplicate = { ...tags[0].tags['id-V101-0'], id: 'duplicate' };
    assert.match(Resolver.apply(property('V101'), tags)[0].error, /Ambiguous Tag/);
    assert.match(Resolver.apply(property('V101'), [...tags, tags[0]])[0].error, /Ambiguous PLC/);
});
test('BOOL variants accepted, numeric and unknown types rejected for boolean parameters', () => {
    for (const type of ['BOOL', 'Bool', 'Boolean', 'boolean', 'number', 'INT', undefined]) {
        const tags = devices(); tags[0].tags['id-V101-0'].type = type;
        const result = Resolver.apply(property('V101'), tags)[0];
        assert.equal(!!result.tagId, ['BOOL', 'Bool', 'Boolean', 'boolean'].includes(type));
        if (!result.tagId) assert.match(result.error, /Type Mismatch/);
    }
});
test('offline device is a communication condition and does not invalidate configuration', () => {
    const tags = devices(); tags[0].enabled = false;
    assert.equal(Resolver.apply(property('V101'), tags)[0].tagId, 'id-V101-0');
});
test('manual bindings remain unchanged; prefix errors clear stale IDs and static defaults', () => {
    const manual = { varsToBind: [{ originalName: '_pb_extended', variableId: 'old-id', variableValue: 'true' }] };
    const before = structuredClone(manual);
    Resolver.apply(manual, devices());
    assert.deepEqual(manual, before);
    const p = property('absent'); p.varsToBind[0].variableId = 'old-id'; p.varsToBind[0].variableValue = 'true';
    Resolver.apply(p, devices());
    assert.equal(p.varsToBind[0].variableId, undefined);
    assert.equal(p.varsToBind[0].variableValue, undefined);
});
test('missing profile, unsupported versions and unknown Widget parameters fail explicitly', () => {
    const p = property('V101');
    p.bindingProfile.version = 2;
    p.varsToBind[0].variableId = 'stale';
    assert.match(Resolver.apply(p, devices())[0].error, /unsupported/);
    assert.equal(p.varsToBind[0].variableId, undefined);
    delete p.bindingProfile;
    assert.match(Resolver.apply(p, devices())[0].error, /Missing/);
    p.bindingProfile = { version: 1, bindings: { unknown: '{#1}' } };
    assert.match(Resolver.apply(p, devices())[0].error, /parameter does not exist/);
});
test('two instances survive JSON save/reload, re-resolve IDs, and delete independently', () => {
    const project = { view: { items: { a: property('V101'), b: property('V102') } }, devices: devices() };
    Object.values(project.view.items).forEach(p => Resolver.apply(p, project.devices));
    const restored = JSON.parse(JSON.stringify(project));
    Object.values(restored.view.items).forEach(p => Resolver.apply(p, restored.devices));
    assert.deepEqual(plain(restored), plain(project));
    assert.equal(restored.view.items.a.varsToBind[0].variableId, 'id-V101-0');
    delete restored.view.items.a;
    assert.equal(restored.view.items.b.varsToBind[0].variableId, 'id-V102-0');
});

const decorators = { Component: () => target => target, Injectable: () => target => target, Input: () => () => {} };
const utils = { isNullOrUndefined: value => value == null, isNumeric: value => !isNaN(Number(value)) };
const { SvgUtils } = load('_helpers/svg-utils.ts', { '@angular/core': decorators, './utils': { Utils: utils } });
const { FlexWidgetPropertyComponent: Editor } = load('gauges/gauge-property/flex-widget-property/flex-widget-property.component.ts', {
    '@angular/core': decorators, '../../../_helpers/svg-utils': { SvgUtils }, '../../../_helpers/widget-binding': { WidgetBindingResolver: Resolver }
});
test('property editor restores original manual IDs and static label when toggling modes', () => {
    const p = property('V101'); delete p.prefixBinding;
    p.varsToBind[0].variableId = 'manual';
    p.varsToBind.push({ originalName: '_ps_label', name: '_ps_label', type: 'string', variableValue: 'Inlet' });
    const before = structuredClone(p.varsToBind);
    const editor = new Editor({ getDevices: devices }, { askDeviceStatus() {} }); editor.property = p;
    editor.setMode(true); p.prefixBinding = config('V102'); editor.validateBindings();
    assert.equal(p.varsToBind[0].variableId, 'id-V102-0');
    editor.setMode(false);
    assert.deepEqual(plain(p.varsToBind), before);
});

test('actual SVG compiler and HtmlImage runtime route V101/V102 independently and fan out shared Tags', () => {
    const parts = new Map();
    const browser = { window: null, document: { getElementById: id => parts.get(id) } }; browser.window = browser;
    const context = vm.createContext(browser);
    const { HtmlImageComponent: Image } = load('gauges/controls/html-image/html-image.component.ts', {
        '@angular/core': decorators, '../../gauge-base/gauge-base.component': { GaugeBaseComponent: class { static checkBitmask(b, v) { return v; } } },
        '../../../_models/hmi': { GaugeActionsType: {}, GaugePropertyColor: class {} },
        '../../../_helpers/endpointapi': { EndPointApi: { getURL: () => '' } },
        '../../../_models/device': { DeviceType: { WebCam: 'WebCam' } }
    }, { window: browser });
    function instance(prefix) {
        const p = property(prefix);
        const ids = {};
        for (const match of svg.matchAll(/\bid="([^"]+)"/g)) {
            ids[match[1]] = `${match[1]}_${prefix}`;
            parts.set(ids[match[1]], { textContent: '', setAttribute(key, value) { this[key] = value; } });
        }
        const moduleId = `wModule_${prefix}`;
        const compiled = SvgUtils.processWidget(svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)[1], moduleId, ids);
        p.varsToBind = compiled.vars; p.type = 'widget'; p.scriptContent = { moduleId, content: compiled.content };
        Resolver.apply(p, devices());
        vm.runInContext(SvgUtils.initWidget(compiled.content, p.varsToBind), context);
        return { property: p };
    }
    const a = instance('V101'); const b = instance('V102');
    const route = (id, value) => [a, b].filter(ga => Image.getSignals(ga.property).includes(id)).forEach(ga =>
        Image.processValue(ga, { node: {} }, { id, value }, {}));
    for (const ga of [a, b]) ga.property.varsToBind.filter(v => v.variableId).forEach(v => route(v.variableId, false));
    route('id-V101-0', true); route('id-V102-1', true);
    assert.equal(parts.get('statusText_V101').textContent, 'EXTENDED');
    assert.equal(parts.get('statusText_V102').textContent, 'RETRACTED');
    route('id-V101-4', true);
    assert.equal(parts.get('statusText_V101').textContent, 'FAULT');
    assert.equal(parts.get('statusText_V102').textContent, 'RETRACTED');
    route('id-V102-0', null);
    assert.equal(parts.get('statusText_V102').textContent, 'WAITING FOR DATA');
    // More than one exported parameter may intentionally use the same Tag.
    b.property.varsToBind.find(v => v.originalName === '_pb_extended').variableId = 'id-V102-1';
    route('id-V102-1', true);
    assert.equal(parts.get('statusText_V102').textContent, 'CONFLICT');
    let writes = 0;
    const originalPost = () => writes++;
    browser[b.property.scriptContent.moduleId].postValue = originalPost;
    Image.bindEvents(b, () => writes++);
    assert.equal(writes, 0);
    assert.equal(browser[b.property.scriptContent.moduleId].postValue, originalPost);
});

test('saved SVG IDs are replaced without growing suffixes on repeated initialization', () => {
    const child = { id: 'status_old', children: [] };
    const root = { id: 'root_old', children: [child] };
    const map = SvgUtils.renameIdsInSvg(root, 'new', 'old');
    assert.equal(child.id, 'status_new');
    assert.equal(SvgUtils.replaceIdsInScript("document.getElementById('status_old')", map), "document.getElementById('status_new')");
    SvgUtils.renameIdsInSvg(root, 'third', 'new');
    assert.equal(child.id, 'status_third');
});

test('SVG gradient and use references follow renamed IDs', () => {
    const child = { id: 'gradient_old', children: [] };
    const root = { id: 'root_old', children: [child], attributes: [
        { name: 'fill', value: 'url(#gradient_old)' }, { name: 'href', value: '#gradient_old' }
    ], setAttribute(name, value) { this.attributes.find(a => a.name === name).value = value; } };
    SvgUtils.renameIdsInSvg(root, 'new', 'old');
    assert.equal(root.attributes[0].value, 'url(#gradient_new)');
    assert.equal(root.attributes[1].value, '#gradient_new');
});

test('existing View ID map reproduces cross-View-instance teardown limitation', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/app/_services/hmi.service.ts'), 'utf8');
    const mapSource = source.slice(source.indexOf('class ViewSignalGaugeMap {'), source.indexOf('export enum IoEventTypes'));
    const compiled = ts.transpileModule(mapSource + '\nmodule.exports = ViewSignalGaugeMap;', {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const ref = { exports: {} }; vm.runInNewContext(compiled, { module: ref });
    const map = new ref.exports();
    map.add('same-view', 'tag', { id: 'a' }); map.add('same-view', 'tag', { id: 'b' });
    assert.equal(map.signalsGauges('same-view', 'tag').length, 2);
    map.remove('same-view');
    assert.equal(map.getSignalIds('same-view').length, 0);
});

test('real project SQLite storage survives a separate-process restart', () => {
    const os = require('node:os'); const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-prefix-'));
    try {
        for (const mode of ['seed', 'reopen']) {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'widget-prefix-fixture.cjs'), mode, dir], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stdout + result.stderr);
        }
    } finally { fs.rmSync(dir, { recursive: true }); }
});

test('View disconnection clears received values and the change filter so identical feedback can recover', () => {
    const window = { module_fixture: { putValue: (name, value) => received.push([name, value]) } };
    const received = [];
    const decorator = () => () => {};
    const { FuxaViewComponent: View } = load('fuxa-view/fuxa-view.component.ts', {
        '@angular/core': { ...decorators, ViewChild: decorator, Output: decorator, HostListener: decorator }
    }, { window });
    const p = property('V101'); Resolver.apply(p, devices()); p.scriptContent = { moduleId: 'module_fixture' };
    const view = Object.create(View.prototype);
    view.prefixWidgets = [{ id: 'a', property: p }];
    view.mapGaugeStatus = { a: { variablesValue: { 'id-V101-0': true } } };
    view.hmiService = { variables: { 'id-V101-0': { value: true } } };
    view.invalidatePrefixWidgets('other'); assert.equal(received.length, 0);
    view.invalidatePrefixWidgets('ads');
    assert.equal(received.length, 6);
    assert.equal(view.hmiService.variables['id-V101-0'].value, null);
    assert.equal(view.mapGaugeStatus.a.variablesValue['id-V101-0'], undefined);
});
