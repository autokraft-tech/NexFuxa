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
vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports,
    require: name => imports[name] || {}, JSON, URL, Blob, document: {},
    window: { confirm: () => true } });
const Component = moduleRef.exports.PlcDeviceModelsComponent;
const row = () => ({ 'Device Name': 'V101', 'PLC Device ID': 'ads-1',
    'Device Model': 'Valve@1.0.0', 'Array Symbol': 'GVL.a', 'Array Indices': '1,1', Profile: 'Full' });

function setup() {
    const pending = [];
    let refreshes = 0;
    let closed = false;
    const http = {
        get: url => ({ subscribe: observer => observer.next(url.endsWith('/instances') ? { rows: [row()] } : []) }),
        post: (url, body) => ({ subscribe: observer => { pending.push({ url, body, observer }); } })
    };
    const project = { getDeviceList: () => [{ id: 'ads-1', type: 'ADSclient', name: 'ADS 1' },
        { id: 'ads-2', type: 'ADSclient', name: 'ADS 2' }], onRefreshProject: () => refreshes++ };
    const component = new Component(http, project, { close: () => { closed = true; } });
    return { component, pending, refreshes: () => refreshes, closed: () => closed };
}

test('an edit during Preview invalidates the response and keeps Apply unavailable', () => {
    const { component, pending } = setup();
    component.preview();
    assert.equal(component.busy, true);
    component.rows[0]['Array Indices'] = '2,2';
    component.invalidate();
    pending[0].observer.next({ token: 'old', summary: { conflicts: 0 } });
    assert.equal(component.busy, false);
    assert.equal(component.saved, false);
    assert.equal(component.previewResult, null);
    component.apply();
    assert.equal(pending.length, 1);
});

test('switching devices rejects the old Preview and a new Preview uses the selected device', () => {
    const { component, pending } = setup();
    component.preview();
    component.previewDeviceId = 'ads-2';
    component.changePreviewDevice();
    pending[0].observer.next({ token: 'old', summary: { conflicts: 0 } });
    assert.equal(component.previewResult, null);
    assert.equal(component.busy, false);
    component.preview();
    assert.deepEqual(Array.from(pending[1].body.rows), []);
    pending[1].observer.next({ token: 'new', summary: { conflicts: 0 } });
    assert.equal(component.previewResult.token, 'new');
});

test('a partial Apply refreshes saved project state and shows the runtime failure', () => {
    const context = setup();
    const { component, pending } = context;
    component.preview();
    pending[0].observer.next({ token: 'ready', summary: { conflicts: 0, created: 20 } });
    component.apply();
    pending[1].observer.next({ persistence: 'committed', runtime: { status: 'failed', message: 'start failed' } });
    assert.equal(context.refreshes(), 1);
    assert.equal(context.closed(), false);
    assert.match(component.error, /Tags were saved.*start failed/);
    assert.equal(component.previewResult, null);
    assert.equal(component.busy, false);
});
