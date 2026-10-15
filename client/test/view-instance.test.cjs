const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, extra = '') {
    const source = fs.readFileSync(`${__dirname}/../src/app/${file}`, 'utf8') + extra;
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    const decorator = () => () => {};
    vm.runInNewContext(code, { module, exports: module.exports, console: { ...console, error: e => { throw e; } }, setTimeout: () => 0, clearTimeout() {},
        require: name => name.includes('view-runtime-context') ? load('_helpers/view-runtime-context.ts') :
            new Proxy({}, { get: (_, key) => key === 'EndPointApi' ? { getURL() {} } : decorator }) });
    return module.exports;
}
const { FuxaViewComponent: Component } = load('fuxa-view/fuxa-view.component.ts');
const { HmiService } = load('_services/hmi.service.ts');
test('singleCard replacement drops ownership references to closed cards', () => {
    const component = Object.create(Component.prototype);
    const card = { owner: component };
    component.cards = [card]; component.ownedCards = new Set([card]);
    component.closeAllCards();
    assert.equal(component.cards.length, 0);
    assert.equal(component.ownedCards.size, 0);
});
const { GaugesManager } = load('gauges/gauges.component.ts');
test('script object names resolve only inside the originating instance, including after close', () => {
    const manager = Object.create(GaugesManager.prototype), a = {name:'shared'}, b = {name:'shared'};
    Object.assign(manager, { instanceGauges: new Map([['A',new Set(['a'])],['B',new Set(['b'])]]),
        mapGauges:{a,b}, mapGaugeView:{a:{A:{name:'shared'}},b:{B:{name:'shared'}}} });
    assert.equal(manager.getGaugeFromName('shared', 'A'), a);
    assert.equal(manager.getGaugeFromName('shared', 'B'), b);
    manager.instanceGauges.delete('A');
    assert.equal(manager.getGaugeFromName('shared', 'A'), undefined);
    assert.equal(manager.getGaugeFromName('shared', 'B'), b);
});
test('Gauge teardown releases charts, tables, events and signal-free controls once, preserving B', () => {
    const manager = Object.create(GaugesManager.prototype), destroyed = [];
    Object.assign(manager, { hmiService: { removeSignalGaugeFromMap() {} },
        instanceGauges: new Map([['A', new Set(['a', 'no-signal'])], ['B', new Set(['b'])]]),
        memorySigGauges: { shared: { a: {}, b: {} } }, eventGauge: { input_a: {id:'a'}, input_b: {id:'b'} },
        mapGaugeView: { a: {}, b: {} }, mapChart: {a:{}, b:{}}, mapTable: {a:{}, b:{}},
        mapGauges: Object.fromEntries(['a', 'b', 'no-signal'].map(id => [id, {myComRef:{destroy: () => destroyed.push(id)}}])) });
    manager.unbindGauge('A');
    manager.unbindGauge('A');
    assert.deepEqual(destroyed, ['a', 'no-signal']);
    for (const cache of ['mapChart', 'mapTable', 'mapGauges', 'mapGaugeView']) assert.deepEqual(Object.keys(manager[cache]), ['b']);
    assert.deepEqual(Object.keys(manager.eventGauge), ['input_b']);
    assert.deepEqual(Object.keys(manager.memorySigGauges.shared), ['b']);
    manager.unbindGauge('B');
    assert.equal(manager.instanceGauges.size, 0);
    assert.deepEqual(Object.keys(manager.memorySigGauges), []);
});
test('subscription owners union with Home, release independently and replay on reconnect', () => {
    const service = Object.create(HmiService.prototype), messages = [];
    Object.assign(service, { viewsTagsSubscription: new Map(), homeTagsSubscription: [],
        deviceAdapaterService: { resolveAdapterTagsId: ids => ids }, socket: { emit: (_, msg) => messages.push(msg) } });
    const tags = () => [...messages.at(-1).tagsId].sort();
    service.homeTagsSubscribe(['home']);
    service.viewsTagsSubscribe(['t1', 'shared'], true, 'A');
    service.viewsTagsSubscribe(['t2', 'shared'], true, 'B');
    assert.deepEqual(tags(), ['home', 'shared', 't1', 't2']);
    service.releaseViewTags('A');
    assert.deepEqual(tags(), ['home', 'shared', 't2']);
    service.tagsSubscribe(); // same path as the Socket.IO connect handler
    assert.deepEqual(tags(), ['home', 'shared', 't2']);
    service.releaseViewTags('B');
    assert.deepEqual(tags(), ['home']);
    for (let i = 0; i < 20; i++) {
        service.viewsTagsSubscribe(['t1'], true, 'reopen');
        service.releaseViewTags('reopen');
    }
    assert.equal(service.viewsTagsSubscription.size, 0);
    assert.deepEqual(tags(), ['home']);
});

test('late lazy load cannot resurrect a destroyed or superseded view', async () => {
    const component = Object.create(Component.prototype);
    const pending = [];
    Object.assign(component, { loadGeneration: 0, projectService: { isViewLazy: () => true },
        resolveView: () => new Promise(resolve => pending.push(resolve)), loadResolvedHmi() { throw Error('stale load'); } });
    component.loadHmi({ id: 'old' });
    component.loadHmi({ id: 'new' });
    pending[0]({ id: 'old' });
    await Promise.resolve();
    component.destroyed = true;
    pending[1]({ id: 'new' });
    await Promise.resolve();
});

test('page navigation accepts only the latest asynchronous request', async () => {
    const component = Object.create(Component.prototype), pending = [];
    Object.assign(component, { loadGeneration: 0, getView: () => new Promise(resolve => pending.push(resolve)),
        closeAllCards() {}, loadVariableMapping() {}, loadHmi(view) { this.loaded = view.id; } });
    const first = component.loadPage(null, 'old', {}), second = component.loadPage(null, 'new', {});
    pending[1]({ id: 'new' }); await second;
    pending[0]({ id: 'old' }); await first;
    assert.equal(component.loaded, 'new');
});
test('closing A must preserve B registry for the same definition', () => {
    const registry = new Map();
    function instance() {
        const c = Object.create(Component.prototype);
        Object.assign(c, { inputDialog: {}, projectService: { getHmi: () => ({}) }, hmi: {},
            gaugesManager: { unbindGauge: id => registry.delete(id) },
            dataContainer: { nativeElement: { innerHTML: '', style: {}, querySelectorAll: () => [] } },
            viewContainerRef: { clear() {} }, changeDetector: { detectChanges() {} },
            clearGaugeStatus() {}, onResize() {}, onRunScript() {},
            loadWatch() { registry.set(this.viewInstanceId || this.id, this); } });
        c.loadResolvedHmi({ id: 'shared', type: 'svg', svgcontent: '<svg/>', items: {}, profile: {} });
        return c;
    }
    const a = instance(), b = instance();
    a.gaugesManager.unbindGauge(a.viewInstanceId || a.id);
    assert.equal(registry.get(b.viewInstanceId || b.id), b);
});
