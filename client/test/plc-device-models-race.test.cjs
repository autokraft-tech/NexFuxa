'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/app/device/plc-device-models/plc-device-models.component.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true
} }).outputText;
const moduleRef = { exports: {} };
const imports = {
    '@angular/core': { Component: () => target => target },
    '../../_helpers/endpointapi': { EndPointApi: { getURL: () => '' } },
    '../../_models/device': { DeviceType: { ADSclient: 'ADSclient' } }
};
const browserWindow = { confirm: () => true };
vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports,
    require: name => imports[name] || {}, JSON, URL, Blob, document: {},
    window: browserWindow });
const Component = moduleRef.exports.PlcDeviceModelsComponent;
const configuration = () => ({ schemaVersion: 2, id: 'cfg_start', name: 'Start', deviceId: 'ads-1',
    tagPrefix: 'Start', adsSymbol: 'GVL.bStart', valueKind: 'primitive', plcType: 'BOOL',
    array: { mode: 'scalar' } });

function setup(savedConfigurations = [configuration()], savedModels = []) {
    const pending = [];
    const gets = [];
    const deferredGets = [];
    const confirmations = [];
    let confirmResult = true;
    let deferConfigurations = false;
    browserWindow.confirm = message => { confirmations.push(message); return confirmResult; };
    let refreshes = 0;
    let closed = false;
    const http = {
        get: url => ({ subscribe: observer => {
            gets.push(url);
            if (deferConfigurations && url.endsWith('/configurations')) { deferredGets.push(observer); return; }
            observer.next(url.endsWith('/models') ? { models: structuredClone(savedModels), hash: 'model-hash' } :
                    url.endsWith('/configurations') ? { configurations: structuredClone(savedConfigurations), hash: 'config-hash' } : []);
        } }),
        post: (url, body) => ({ subscribe: observer => { pending.push({ url, body, observer }); } })
    };
    const project = { getDeviceList: () => [{ id: 'ads-1', type: 'ADSclient', name: 'ADS 1' },
        { id: 'ads-2', type: 'ADSclient', name: 'ADS 2' }], onRefreshProject: () => refreshes++ };
    const component = new Component(http, project, { close: () => { closed = true; } });
    return { component, pending, gets, deferredGets, confirmations,
        confirm: value => { confirmResult = value; },
        deferConfigurationGets: () => { deferConfigurations = true; },
        refreshes: () => refreshes, closed: () => closed };
}

const plain = value => JSON.parse(JSON.stringify(value));
const model = (name = 'Pump', version = '1.0.0') => ({ schemaVersion: 2, name, version,
    rootType: 'ST_Pump', types: { ST_Pump: { Running: 'BOOL' } }, profiles: {} });
const importFile = (component, kind, items) => component.importJson({ target: { value: 'file.json',
    files: [{ size: 100, text: async () => JSON.stringify({ schemaVersion: 2, [kind]: items }) }] } }, kind);

test('a partial Apply refreshes saved state and reports reload failure', () => {
    const context = setup();
    const { component, pending } = context;
    component.selectConfiguration('cfg_start');
    component.previewConfiguration();
    pending[0].observer.next({ token: 'ready', summary: { conflicts: 0, created: 1 } });
    component.apply();
    pending[1].observer.next({ persistence: 'committed', runtime: { status: 'failed', message: 'start failed' } });
    assert.equal(context.refreshes(), 1);
    assert.equal(context.closed(), false);
    assert.match(component.error, /Tags were saved.*start failed/);
    assert.equal(component.previewResult, null);
    assert.equal(component.busy, false);
});

test('v2 Preview ignores a response after editing the saved configuration', () => {
    const { component, pending } = setup();
    component.selectConfiguration('cfg_start');
    component.previewConfiguration();
    assert.equal(component.busy, true);
    component.draft.adsSymbol = 'GVL.bChanged';
    component.invalidateConfiguration();
    pending[0].observer.next({ token: 'old', summary: { conflicts: 0 } });
    assert.equal(component.busy, false);
    assert.equal(component.configSaved, false);
    assert.equal(component.previewResult, null);
    component.apply();
    assert.equal(pending.length, 1);
});

test('v2 Preview accepts only the selected saved task and Apply uses its token', () => {
    const { component, pending } = setup();
    component.selectConfiguration('cfg_start');
    component.previewConfiguration();
    assert.deepEqual(Array.from(pending[0].body.configurationIds), ['cfg_start']);
    pending[0].observer.next({ token: 'fresh', summary: { conflicts: 0, created: 1 } });
    assert.equal(component.previewResult.token, 'fresh');
    component.apply();
    assert.equal(pending[1].body.token, 'fresh');
});

test('configuration JSON import previews a preserving merge before any write', async () => {
    const original = configuration();
    const keep = { ...configuration(), id: 'cfg_keep', name: 'Keep' };
    const added = { ...configuration(), id: 'cfg_new', name: 'New' };
    const context = setup([original, keep]);
    const { component, pending } = context;
    const reorderedKeep = Object.fromEntries(Object.entries(keep).reverse());
    await importFile(component, 'configurations', [{ ...original, adsSymbol: 'GVL.changed' }, reorderedKeep, added]);
    assert.equal(pending.length, 0);
    assert.deepEqual(plain(component.configurations), [original, keep]);
    const plan = component.jsonImport.plan;
    assert.deepEqual([plan.added, plan.duplicates, plan.conflicts, plan.deleted], [1, 1, 1, 0]);
    assert.equal(component.jsonImport.mode, 'merge');
    component.confirmJsonImport();
    assert.deepEqual(plain(pending[0].body.configurations), [original, keep, added]);
    assert.equal(pending[0].body.expectedHash, 'config-hash');
    pending[0].observer.next({ configurations: [original, keep, added], hash: 'new-hash' });
    assert.equal(component.jsonImport, null);
});

test('model import retains unrelated models and immutable conflicting versions', async () => {
    const original = model();
    const keep = model('Other');
    const added = model('Pump', '2.0.0');
    const { component, pending } = setup(undefined, [original, keep]);
    await importFile(component, 'models', [{ ...original, types: { ST_Pump: { Running: 'REAL' } } }, added]);
    assert.deepEqual([component.jsonImport.plan.added, component.jsonImport.plan.conflicts, component.jsonImport.plan.deleted], [1, 1, 0]);
    component.jsonImport.mode = 'overwrite';
    component.updateJsonImportMode();
    assert.equal(component.jsonImport.plan.blocked, true);
    component.confirmJsonImport();
    assert.equal(pending.length, 0);
    component.jsonImport.mode = 'merge';
    component.updateJsonImportMode();
    component.confirmJsonImport();
    assert.deepEqual(plain(pending[0].body.models), [original, keep, added]);
});

test('overwrite requires confirmation and retains saved configurations absent from the file', async () => {
    const original = configuration();
    const keep = { ...original, id: 'cfg_keep' };
    const imported = { ...original, adsSymbol: 'GVL.changed' };
    const context = setup([original, keep]);
    await importFile(context.component, 'configurations', [imported]);
    context.component.jsonImport.mode = 'overwrite';
    context.component.updateJsonImportMode();
    assert.equal(context.component.jsonImport.plan.deleted, 0);
    context.confirm(false);
    context.component.confirmJsonImport();
    assert.equal(context.pending.length, 0);
    context.confirm(true);
    context.component.confirmJsonImport();
    assert.deepEqual(plain(context.pending[0].body.configurations), [imported, keep]);
    assert.match(context.confirmations.at(-1), /overwrite.*1 conflicts \(overwritten\).*0 deleted/);
});

for (const kind of ['models', 'configurations']) {
    test('an empty default ' + kind + ' import retains the complete saved collection', async () => {
        const context = setup(undefined, [model()]);
        await importFile(context.component, kind, []);
        assert.equal(context.component.jsonImport.plan.deleted, 0);
        context.component.confirmJsonImport();
        assert.deepEqual(plain(context.pending[0].body[kind]), kind === 'models' ? [model()] : [configuration()]);
    });
}

test('replace lists deletions and cannot persist without explicit confirmation', async () => {
    const original = configuration();
    const keep = { ...original, id: 'cfg_keep' };
    const context = setup([original, keep]);
    await importFile(context.component, 'configurations', [original]);
    context.component.jsonImport.mode = 'replace';
    context.component.updateJsonImportMode();
    assert.equal(context.component.jsonImport.plan.deleted, 1);
    assert.ok(context.component.jsonImport.plan.entries.some(entry => entry.key === 'cfg_keep' && entry.operation === 'Deleted'));
    context.confirm(false);
    context.component.confirmJsonImport();
    assert.equal(context.pending.length, 0);
    assert.deepEqual(plain(context.component.configurations), [original, keep]);
    context.confirm(true);
    context.component.confirmJsonImport();
    assert.deepEqual(plain(context.pending[0].body.configurations), [original]);
    assert.match(context.confirmations.at(-1), /replace.*1 deleted/);
});

test('canceling the preview or confirmation leaves saved data and draft untouched', async () => {
    const context = setup();
    context.component.selectConfiguration('cfg_start');
    const draft = plain(context.component.draft);
    await importFile(context.component, 'configurations', []);
    context.confirm(false);
    context.component.confirmJsonImport();
    assert.equal(context.pending.length, 0);
    assert.deepEqual(plain(context.component.draft), draft);
    context.component.cancelJsonImport();
    assert.equal(context.component.jsonImport, null);
    assert.deepEqual(plain(context.component.configurations), [configuration()]);
});

test('duplicate file identities and built-in model imports are rejected without writes', async () => {
    const { component, pending } = setup();
    await importFile(component, 'configurations', [configuration(), { ...configuration(), name: 'Ambiguous' }]);
    assert.match(component.error, /Duplicate key/);
    assert.equal(component.jsonImport, null);
    await importFile(component, 'models', [model('Valve')]);
    assert.match(component.error, /read-only/);
    assert.equal(component.jsonImport, null);
    assert.equal(pending.length, 0);
});

test('stale import previews cannot overwrite a newer saved list or project hash', async () => {
    const { component, pending } = setup();
    await importFile(component, 'configurations', []);
    component.configurationHash = 'newer';
    component.confirmJsonImport();
    assert.match(component.error, /changed after the import preview/);
    assert.equal(pending.length, 0);
    component.configurationHash = 'config-hash';
    component.configurations.push({ ...configuration(), id: 'new_saved' });
    component.confirmJsonImport();
    assert.equal(pending.length, 0);
});

test('failed import persistence preserves saved data and retains the preview for review', async () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    await importFile(c, 'configurations', [{ ...configuration(), id: 'cfg_new' }]);
    c.confirmJsonImport();
    context.pending[0].observer.error({ error: { message: 'Validation rejected' } });
    assert.deepEqual(plain(c.configurations), [configuration()]);
    assert.deepEqual(plain(c.draft), configuration());
    assert.ok(c.jsonImport);
    assert.equal(c.busy, false);
    assert.equal(c.error, 'Validation rejected');
});

test('model import success preserves unsaved configuration edits during background refresh', async () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Unsaved configuration';
    c.invalidateConfiguration();
    await importFile(c, 'models', [model()]);
    c.confirmJsonImport();
    context.pending[0].observer.next({ models: [model()], hash: 'models-imported' });
    assert.equal(c.jsonImport, null);
    assert.equal(c.draft.name, 'Unsaved configuration');
    assert.equal(c.configSaved, false);
    assert.equal(context.confirmations.length, 1);
});

for (const action of ['selectConfiguration', 'newConfiguration', 'copyConfiguration', 'refreshConfigurations']) {
    test('canceling ' + action + ' preserves unsaved edits', () => {
        const other = { ...configuration(), id: 'cfg_other' };
        const context = setup([configuration(), other]);
        context.component.selectConfiguration('cfg_start');
        context.component.draft.name = 'Unsaved';
        context.component.invalidateConfiguration();
        const before = plain(context.component.draft);
        const getCount = context.gets.length;
        context.confirm(false);
        context.component[action]('cfg_other');
        assert.equal(context.confirmations.length, 1);
        assert.match(context.confirmations[0], /unsaved changes/);
        assert.deepEqual(plain(context.component.draft), before);
        assert.equal(context.component.selectedConfigurationId, 'cfg_start');
        assert.equal(context.component.configSaved, false);
        assert.equal(context.gets.length, getCount);
    });
}

test('confirmed transitions switch, create, copy, and refresh deliberately', () => {
    const other = { ...configuration(), id: 'cfg_other', name: 'Other' };
    const context = setup([configuration(), other]);
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Unsaved';
    c.invalidateConfiguration();
    c.selectConfiguration('cfg_other');
    assert.equal(c.draft.name, 'Other');
    c.invalidateConfiguration();
    c.newConfiguration();
    assert.notEqual(c.draft.id, 'cfg_other');
    c.draft.name = 'Copy source';
    c.copyConfiguration();
    assert.equal(c.draft.name, 'Copy source copy');
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Unsaved refresh';
    c.invalidateConfiguration();
    c.refreshConfigurations();
    assert.deepEqual(plain(c.draft), configuration());
    assert.equal(c.configSaved, true);
});

test('background reload preserves an unsaved draft and does not silently refresh the editor', () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Unsaved';
    c.invalidateConfiguration();
    c.reloadConfigurations();
    assert.equal(c.draft.name, 'Unsaved');
    assert.equal(c.configSaved, false);
    assert.equal(context.confirmations.length, 0);
});

test('an edit after requesting refresh survives its old response', () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    context.deferConfigurationGets();
    c.refreshConfigurations();
    c.draft.name = 'Edited during refresh';
    c.invalidateConfiguration();
    context.deferredGets[0].next({ configurations: [configuration()], hash: 'refreshed' });
    assert.equal(c.draft.name, 'Edited during refresh');
    assert.equal(c.configSaved, false);
});

test('a reload requested before a Save cannot replace the newer saved collection', () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    context.deferConfigurationGets();
    c.reloadConfigurations();
    c.draft.name = 'Saved update';
    c.invalidateConfiguration();
    c.saveConfiguration();
    const saved = plain(context.pending[0].body.configurations);
    context.pending[0].observer.next({ configurations: saved, hash: 'saved-update' });
    context.deferredGets[0].next({ configurations: [configuration()], hash: 'old' });
    assert.deepEqual(plain(c.configurations), saved);
    assert.equal(c.configurationHash, 'saved-update');
    assert.equal(c.configSaved, true);
});

test('configuration import cancellation preserves unsaved edits', async () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Unsaved';
    c.invalidateConfiguration();
    await importFile(c, 'configurations', []);
    context.confirm(false);
    c.confirmJsonImport();
    assert.equal(context.pending.length, 0);
    assert.equal(c.draft.name, 'Unsaved');
    assert.ok(c.jsonImport);
});

test('a background refresh invalidates Preview eligibility if saved content changed', () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.previewResult = { token: 'old', summary: { conflicts: 0 } };
    context.deferConfigurationGets();
    c.reloadConfigurations();
    context.deferredGets[0].next({ configurations: [{ ...configuration(), adsSymbol: 'GVL.changed' }], hash: 'newer' });
    assert.equal(c.draft.adsSymbol, 'GVL.bStart');
    assert.equal(c.configSaved, false);
    assert.equal(c.previewResult, null);
});

test('configuration and custom model deletions require confirmation', () => {
    const context = setup(undefined, [model()]);
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.editModel('Pump@1.0.0');
    context.confirm(false);
    c.deleteConfiguration();
    c.deleteModel();
    assert.equal(context.pending.length, 0);
    assert.equal(c.draft.id, 'cfg_start');
    assert.match(context.confirmations[0], /Delete configuration.*Widget bindings will be kept/);
    assert.match(context.confirmations[1], /Delete custom model/);
    context.confirm(true);
    c.deleteConfiguration();
    assert.deepEqual(plain(context.pending[0].body.configurations), []);
    context.pending[0].observer.next({ configurations: [], hash: 'deleted' });
    c.deleteModel();
    assert.deepEqual(plain(context.pending[1].body.models), []);
});

test('online nested member editing saves versioned model definitions and DAQ defaults', () => {
    const { component: c, pending } = setup();
    c.newModel();
    c.modelDraft.name = 'OnlinePump';
    c.modelRows[0].name = 'Speed';
    c.modelRows[0].plcType = 'REAL';
    c.addModelGroup();
    c.switchModelType('ST_Group1');
    c.modelRows[0].name = 'Running';
    c.setModelProperties('Speed', { daq: { enabled: true, interval: 10, changed: true, restored: false }, description: 'Speed' });
    c.previewResult = { token: 'old-model-preview' };
    c.setModelProperties('Speed', { daq: { enabled: true, interval: 10, changed: true, restored: false }, description: 'Speed' });
    assert.equal(c.previewResult, null);
    c.saveModel();
    const saved = pending[0].body.models[0];
    assert.equal(saved.types.ST_NewModel.Speed, 'REAL');
    assert.equal(saved.types.ST_Group1.Running, 'BOOL');
    assert.equal(saved.memberDefaults.Speed.daq.interval, 10);
    pending[0].observer.next({ models: [saved], hash: 'saved-model' });
    assert.equal(c.modelDirty, false);
    assert.equal(c.modelEditing, false);
    c.editModel('OnlinePump@1.0.0');
    c.beginModelEdit();
    assert.equal(c.modelDraft.version, '1.0.1');
    assert.equal(c.customModels[0].version, '1.0.0');
});

test('member property overrides and Reset invalidate Preview without mutating model defaults', () => {
    const { component: c } = setup();
    c.selectConfiguration('cfg_start');
    c.previewResult = { token: 'old' };
    c.setConfigurationProperties('$value', { daq: { enabled: true, interval: 5 } });
    assert.equal(c.previewResult, null);
    assert.equal(c.configSaved, false);
    c.resetMemberDefaults('$value');
    assert.deepEqual(plain(c.draft.memberOverrides), {});
});

test('model cycles and duplicate members are rejected before any API write', () => {
    const { component: c, pending } = setup();
    c.newModel();
    c.modelRows.push({ name: 'Running', plcType: 'REAL' });
    c.saveModel();
    assert.match(c.error, /unique/);
    assert.equal(pending.length, 0);
    c.modelRows = [{ name: 'Cycle', plcType: 'ST_NewModel' }];
    c.saveModel();
    assert.match(c.error, /cyclic/);
    assert.equal(pending.length, 0);
});

test('referenced model deletion shows configuration names without writing', () => {
    const configurationWithModel = { ...configuration(), model: 'Pump@1.0.0' };
    const { component: c, pending } = setup([configurationWithModel], [model()]);
    c.editModel('Pump@1.0.0');
    c.deleteModel();
    assert.match(c.error, /referenced by: Start/);
    assert.equal(pending.length, 0);
});

test('current draft and selected configurations export the same edited Schema data', () => {
    const { component: c } = setup();
    let exported;
    c.download = data => { exported = plain(data); };
    c.selectConfiguration('cfg_start');
    c.draft.name = 'Draft';
    c.setConfigurationProperties('$value', { daq: { interval: 10 } });
    c.exportConfigurations('current');
    assert.equal(exported.draft, true);
    assert.deepEqual(exported.configurations[0], plain(c.draft));
    c.stageJsonImport(exported, 'configurations');
    assert.equal(c.jsonImport.plan.conflicts, 1);
    c.selectedTasks.cfg_start = true;
    c.exportConfigurations('selected');
    assert.deepEqual(exported.configurations, [configuration()]);
});

test('batch DAQ edits affect only selected model leaves', () => {
    const { component: c } = setup();
    c.newModel();
    c.modelRows.push({ name: 'Speed', plcType: 'REAL' });
    c.memberSelection.Speed = true;
    c.bulkDaq = { enabled: true, interval: 5, changed: true, restored: false };
    c.bulkSetModelDaq();
    assert.deepEqual(plain(c.modelDraft.memberDefaults.Speed.daq), c.bulkDaq);
    assert.equal(c.modelDraft.memberDefaults.Running, undefined);
});

test('draft export assigns a missing identity once and import rejects invalid IDs', async () => {
    const { component: c, pending } = setup();
    c.newConfiguration();
    delete c.draft.id;
    let data;
    c.download = value => { data = plain(value); };
    c.exportConfigurations('current');
    const id = data.configurations[0].id;
    c.exportConfigurations('current');
    assert.equal(data.configurations[0].id, id);
    await importFile(c, 'configurations', [{ ...configuration(), id: 'bad-id' }]);
    assert.match(c.error, /Invalid configuration ID/);
    assert.equal(pending.length, 0);
});

test('structure type rename updates its root and nested references', () => {
    const { component: c } = setup();
    c.newModel();
    c.addModelGroup();
    c.switchModelType('ST_Group1');
    c.renameModelType('ST_Status');
    assert.equal(c.modelDraft.types.ST_NewModel.Group1, 'ST_Status');
    c.switchModelType('ST_NewModel');
    c.renameModelType('ST_Pump_HMI');
    assert.equal(c.modelDraft.rootType, 'ST_Pump_HMI');
    assert.equal(c.modelDraft.types.ST_NewModel, undefined);
    assert.equal(c.expandedModelLeaves().length, 2);
});

test('successful Apply keeps an unsaved model draft open', () => {
    const context = setup();
    const c = context.component;
    c.selectConfiguration('cfg_start');
    c.newModel();
    c.previewConfiguration();
    context.pending[0].observer.next({ token: 'ready', summary: { conflicts: 0, created: 1 } });
    c.apply();
    context.pending[1].observer.next({ persistence: 'committed', runtime: { status: 'updated' } });
    assert.equal(context.closed(), false);
    assert.equal(c.modelDirty, true);
    assert.equal(c.modelDraft.name, 'NewModel');
    assert.match(c.notice, /Tags committed.*unsaved model draft/);
    assert.equal(c.busy, false);
});
