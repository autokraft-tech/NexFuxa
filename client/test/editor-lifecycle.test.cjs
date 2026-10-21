const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
    const filename = path.join(__dirname, '../src/app/editor/editor.component.ts');
    const timers = new Map(), views = [], saved = [], components = [];
    let callbacks, nextTimer = 0;
    const decorator = () => () => {};
    const noop = () => {};
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true }
    }).outputText;
    const module = { exports: {} };
    const core = Object.fromEntries(['Component', 'Inject', 'ViewChild'].map(key => [key, decorator]));
    const root = {};
    vm.runInNewContext(source, { module, exports: module.exports,
        require: name => name === '@angular/core' ? core : name.includes('html-image.component') ? {
            HtmlImageComponent: { destroyValveSymbols: noop }
        } : {}, console,
        document: { getElementById: () => root },
        MutationObserver: class { observe() {} disconnect() {} }, localStorage: { setItem: noop },
        setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
        $: noop, initContextmenu: {},
        mypathseg: { initPathSeg: noop }, mybrowser: { initBrowser: noop }, mysvgutils: { initSvgutils: noop },
        myselect: { initSelect: noop }, mydraw: { initDraw: noop }, mysvgcanvas: { initSvgCanvas: noop },
        mysvgeditor: { initSvgEditor: (...args) => { callbacks = args; } }
    }, { filename });
    const editor = Object.create(module.exports.EditorComponent.prototype);
    editor.gaugesRef = {}; editor.removedGaugeSettings = {};
    editor.currentView = { name: 'A', items: {}, svgcontent: '<svg/>' };
    editor.hmi = { views: [editor.currentView] };
    editor.setFillColor = noop; editor.checkSvgElementsMap = noop;
    editor.getGaugeSettings = value => value;
    editor.setGaugeSettings = ga => { editor.currentView.items[ga.id] = ga; };
    editor.getContent = () => '<svg/>';
    editor.saveView = value => saved.push(JSON.parse(JSON.stringify(value)));
    editor.projectService = { cleanView: noop };
    editor.winRef = { nativeWindow: { svgEditor: {
        init: noop, setMoveStep: noop, clickClearAll: noop, setSvgString: noop,
        setDocProperty: noop, refreshCanvas: noop, resetUndoStack: noop
    } } };
    editor.destroy$ = { next: noop, complete: noop };
    editor.viewContainerRef = {
        get length() { return views.length; }, get: i => views[i], indexOf: v => views.indexOf(v),
        remove(i) { views.splice(i, 1)[0].destroy(); }
    };
    editor.gaugesManager = { mapGauges: {}, mapChart: {}, mapTable: {}, mapGaugeView: {},
        chackSetModeParamToAddedGauge: noop,
        initElementAdded(ga) {
            const component = { active: true, destroyed: 0, ngOnDestroy() { this.destroyed++; this.active = false; } };
            const view = { destroyed: false, destroy() { assert.equal(this.destroyed, false); this.destroyed = true; component.ngOnDestroy(); } };
            views.push(view); components.push(component); editor.gaugesManager.mapGauges[ga.id] = component;
            return component;
        }
    };
    editor.myInit();
    const settings = { id: 'dynamic', type: 'widget', property: { prefixBinding: { parameters: { '#1': 'V101' } }, layout: { symbolVariant: 'detailed' } } };
    editor.checkGaugeAdded(settings);
    return { editor, settings, views, components, timers, saved,
        add: () => callbacks[4]({ id: 'new', type: 'widget', property: {} }),
        remove: () => callbacks[5]([{ id: 'dynamic' }]),
        undo: () => callbacks[4]({ id: 'dynamic', restoreFromHistory: true }) };
}

test('Delete destroys the Angular host view and manager references, retaining only Undo configuration', () => {
    const f = fixture(); f.remove();
    assert.equal(f.components[0].active, false);
    assert.equal(f.components[0].destroyed, 1);
    assert.equal(f.views.length, 0);
    assert.equal(f.editor.gaugesManager.mapGauges.dynamic, undefined);
    assert.equal(f.editor.gaugesRef.dynamic, undefined);
    assert.equal(f.editor.removedGaugeSettings.dynamic, f.settings);
});

test('Undo/Redo recreates behavior from the original configuration without duplicating live resources', () => {
    const f = fixture();
    for (let i = 0; i < 8; i++) {
        f.remove(); f.undo();
        assert.equal(f.views.length, 1);
        assert.equal(f.components.filter(c => c.active).length, 1);
        assert.equal(f.editor.currentView.items.dynamic, f.settings);
        assert.equal(f.settings.property.prefixBinding.parameters['#1'], 'V101');
    }
    f.editor.ngOnDestroy();
    assert.equal(f.views.length, 0);
    assert.ok(f.components.every(c => c.destroyed === 1));
});

test('Save while deleted persists no gauge but retains undoable settings without live resources', () => {
    const f = fixture(); f.remove(); f.editor.onSaveProject();
    assert.equal(f.saved[0].items.dynamic, undefined);
    assert.equal(f.views.length, 0);
    f.undo(); assert.equal(f.views.length, 1);
    f.editor.onSaveProject();
    assert.deepEqual(f.saved[1].items.dynamic, f.settings);
});

test('View switch and Editor Destroy dispose active and removed views and cancel delayed View initialization', () => {
    const f = fixture();
    f.editor.clearEditor();
    assert.equal(f.views.length, 0);
    assert.equal(Object.keys(f.editor.removedGaugeSettings).length, 0);
    const second = { name: 'B', items: {}, svgcontent: '<svg/>', profile: { width: 100, height: 100 } };
    f.editor.getView = () => second; f.editor.isSvgEditMode = () => true;
    f.editor.loadView(second);
    assert.equal(f.timers.size, 1);
    f.editor.ngOnDestroy();
    assert.equal(f.timers.size, 0);
    assert.equal(f.views.length, 0);
});

test('Editor Destroy cancels a newly added gauge selection timer as well as its host view', () => {
    const f = fixture(); f.add();
    assert.equal(f.timers.size, 1);
    f.editor.ngOnDestroy();
    assert.equal(f.timers.size, 0);
    assert.equal(f.views.length, 0);
    assert.ok(f.components.every(c => c.destroyed === 1));
});
