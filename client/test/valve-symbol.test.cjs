const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const svg = fs.readFileSync(path.join(root, 'custom/widgets/valves/NexFuxa_ValveSymbol.svg'), 'utf8');
const definition = JSON.parse(svg.match(/data-nexfuxa-valve-symbol="1"><!\[CDATA\[([\s\S]*?)\]\]>/)[1]);
function load(relative, imports = {}, globals = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'client/src/app', relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true }
    }).outputText;
    const ref = { exports: {} };
    vm.runInNewContext(compiled, { module: ref, exports: ref.exports, require: name => imports[name] || {}, console, ...globals });
    return ref.exports;
}
const { reduceValve } = load('_helpers/valve-state.ts');
const samples = inputs => Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, { value, quality: value === null ? 'missing' : 'good' }]));
for (const file of ['valve-states.json', 'valve-partial-data.json']) {
    const vectors = JSON.parse(fs.readFileSync(path.join(root, 'docs/component-ui/fixtures', file))).cases;
    test(`${file}: all ${vectors.length} frozen vectors executed`, () => {
        for (const vector of vectors) {
            const result = reduceValve(definition, samples(vector.inputs), { connected: vector.connected });
            assert.equal(result.primary, vector.expected.primary, vector.name || JSON.stringify(vector.inputs));
            for (const field of ['position', 'motion', 'fault', 'hmiControl']) {
                if (Object.hasOwn(vector.expected, field)) assert.equal(result.semantic[field], vector.expected[field]);
            }
            if (vector.expected.quality) assert.equal(result.quality.status, vector.expected.quality);
            if (vector.expected.symbolControlLabel) assert.equal(result.icons.find(i => i.id === 'hmiControl').label, vector.expected.symbolControlLabel);
        }
    });
}
test('bad, uncertain, invalid BOOL and stale affect only dependent dimensions', () => {
    const input = Object.fromEntries(Object.values(definition.semantics.inputs).map(key => [key, false]));
    input['Sts.Extended'] = true;
    for (const quality of ['bad', 'uncertain', 'missing', 'stale']) {
        const s = samples(input); s['Sts.Extending'].quality = quality;
        const result = reduceValve(definition, s);
        assert.equal(result.primary, 'EXTENDED'); assert.equal(result.semantic.motion, 'unknown');
        assert.equal(result.quality.status, 'partial'); assert.equal(result.icons[0].id, 'quality');
    }
    for (const value of ['', 'yes', 2, NaN, {}, null]) {
        const s = samples(input); s['Sts.Error'].value = value;
        assert.equal(reduceValve(definition, s).semantic.fault, null);
    }
    const s = samples(input); s['Sts.Extended'].quality = 'stale';
    assert.equal(reduceValve(definition, s).primary, 'STALE');
    assert.equal(reduceValve(definition, s, { bindingErrors: { 'Sts.Extended': 'Missing Tag' } }).primary, 'BINDING_ERROR');
    assert.equal(reduceValve(definition, s, { connected: false }).primary, 'COMM_LOST');
});
test('the packaged read-only definition exactly matches frozen specs and real model', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/component-ui/examples/valve.json')));
    for (const key of ['contractVersion', 'templateId', 'templateVersion', 'semantics', 'stateDisplay', 'layouts']) assert.deepEqual(definition[key], spec[key]);
    assert.deepEqual(definition.tokens, JSON.parse(fs.readFileSync(path.join(root, 'docs/component-ui/tokens.json'))));
    const model = require('../../tools/plc-device-model/models/valve.v1.json');
    for (const member of Object.values(definition.bindings)) assert.equal(model.types.ST_Valve_Status[member.split('.')[1]], 'BOOL');
    assert.doesNotMatch(svg, /postValue|"commands"|"writeAdapter"|setInterval|@keyframes|aria-labelledby/);
    const previous = fs.readFileSync(path.join(root, 'custom/widgets/valves/NexPlc_Valve.svg'), 'utf8');
    const paths = text => [...text.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(paths(svg), paths(previous));
    assert.match(svg, /Copyright \(c\) 2019-2025 frangoteam/);
    assert.match(svg, /Permission is hereby granted/);
});
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('new Symbol layout, metadata, pinned profile, script and license persist across SQLite process restart', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-valve-symbol-'));
    try {
        for (const mode of ['seed', 'verify']) {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'valve-symbol-fixture.cjs'), mode, directory], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr || result.stdout);
        }
    } finally {
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(directory, {recursive:true,force:true});
    }
});
test('pinned versions and invalid layout/direction fail before registering runtime listeners', () => {
    let listeners = 0;
    const { ValveSymbolRuntime } = load('_helpers/valve-symbol.ts', { './valve-state': { reduceValve } }, {
        window: { matchMedia: () => ({addEventListener(){listeners++;}}) },
        document: {addEventListener(){listeners++;}}
    });
    const root = {setAttribute(){},addEventListener(){listeners++;}};
    for (const field of ['contractVersion','templateVersion']) {
        assert.throws(() => new ValveSymbolRuntime(root, {...definition,[field]:'2.0.0'},{}), /Unsupported/);
    }
    assert.throws(() => new ValveSymbolRuntime(root, definition,{layout:{symbolVariant:'unknown'}}), /Invalid.*layout/);
    assert.throws(() => new ValveSymbolRuntime(root, definition,{componentUi:{metadata:{direction:45}}}), /Invalid.*direction/);
    assert.equal(listeners,0);
});
test('quality callback is opt-in and cannot shadow an old Widget function named putSample', () => {
    const calls = [];
    const browser = {fixture:{putValue:(...args)=>calls.push(['legacy',...args]),putSample:(...args)=>calls.push(['native',...args])}};
    const { HtmlImageComponent: Image } = load('gauges/controls/html-image/html-image.component.ts', {
        '@angular/core': {Component:()=>target=>target},
        '../../gauge-base/gauge-base.component': {GaugeBaseComponent:class {static checkBitmask(_,value){return value;}}},
        '../../../_models/hmi': {GaugeActionsType:{},GaugePropertyColor:class{}},
        '../../../_helpers/endpointapi': {EndPointApi:{getURL:()=>''}},
        '../../../_models/device': {DeviceType:{WebCam:'WebCam'}}
    },{window:browser});
    const property = {type:'widget',svgContent:'<svg/>',scriptContent:{moduleId:'fixture'},varsToBind:[{name:'_pb_extended',variableId:'tag'}]};
    Image.processValue({property},{node:{}},{id:'tag',value:true,quality:'stale'},{});
    assert.deepEqual(calls,[['legacy','_pb_extended',true]]);
    property.svgContent = '<svg><metadata data-nexfuxa-valve-symbol="1"/></svg>';
    Image.processValue({property},{node:{}},{id:'tag',value:true,quality:'stale'},{});
    assert.deepEqual(calls[1],['native','_pb_extended',true,'stale']);
});
