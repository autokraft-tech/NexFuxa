const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '../../..');
const svg = fs.readFileSync(path.join(__dirname, 'NexPlc_Valve.svg'), 'utf8');
const script = svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)?.[1];
const signals = ['extended', 'retracted', 'extending', 'retracting', 'error', 'isManualMode'];

function makeHarness() {
  const elements = new Map();
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id) },
  });
  context.window = context;
  let count = 0;

  function addWidget(label = 'Valve') {
    const suffix = ++count;
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const parts = {};
    for (const id of ids) {
      const part = {
        textContent: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
      };
      elements.set(`${id}_${suffix}`, part);
      parts[id] = part;
    }
    let instanceScript = script.replace("let _ps_label = 'Valve';", `let _ps_label = ${JSON.stringify(label)};`);
    for (const id of ids) {
      instanceScript = instanceScript.replace(new RegExp(`(['"])${id}\\1`, 'g'), `$1${id}_${suffix}$1`);
    }
    const moduleId = `wModule_${suffix}`;
    vm.runInContext(`var ${moduleId} = {}; (function() { ${instanceScript}\n${moduleId}.putValue = putValue; })();`, context);
    return { parts, putValue: context[moduleId].putValue };
  }

  return { addWidget };
}

function feed(widget, values = {}) {
  for (const name of signals) widget.putValue(`_pb_${name}`, values[name] ?? false);
}

test('FUXA exports the expected parameters and exposes no write API', () => {
  assert.ok(script);
  const exported = script.match(/\/\/!export-start([\s\S]*?)\/\/!export-end/)[1];
  const names = [...exported.matchAll(/let\s+(_p[bs]_\w+)\s*=/g)].map(match => match[1]);
  assert.deepEqual(names, ['_ps_label', ...signals.map(name => `_pb_${name}`)]);
  assert.match(script, /function putValue\(id, value\)/);
  assert.doesNotMatch(script, /postValue|\bCmd\b|_pb_state|_ps_state/);
});

test('equipment preserves the reused double-acting valve geometry and license', () => {
  const equipment = svg.split('<g id="valveSymbol"')[1]?.split('<rect id="statusBand"')[0];
  assert.ok(equipment);
  assert.match(equipment, /transform="translate\(99\.6 39\) scale\(0\.8\)"/);
  assert.match(equipment, /transform="translate\(0,-30\)"/);
  assert.match(equipment, /transform="translate\(0\.5,0\.5\)"/);
  assert.match(equipment, /<rect x="35" y="30" width="29\.9" height="32\.200001"/);
  const paths = [...equipment.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(paths, [
    'M 49.95,62.2 V 100 M 64.9,38.05 H 100 m -14.95,-5.6 -5.2,11.2 m 8.45,-11.2 -5.2,11.2 M 64.9,54.15 H 100 m -14.95,-5.6 -5.2,11.2 m 8.45,-11.2 -5.2,11.2',
    'm 0,70 50,30 -50,30 z m 100,0 -50,30 50,30 z',
    'M 49.95,46.1 V 62.2 M 35,46.1 h 29.9',
  ]);
  assert.doesNotMatch(equipment.match(/<path[^>]*id="valveBody"[^>]*>/)[0], /style="fill:none"/);
  assert.match(svg, /25_Gate Valve \(Double Acting Cylinder\)\.svg/);
  assert.match(svg, /Copyright \(c\) 2019-2025 frangoteam info@frangoteam\.org/);
  assert.match(svg, /Permission is hereby granted/);
});

test('state priority and feedback conflicts', () => {
  const cases = [
    [{}, 'UNKNOWN', '#64748b'],
    [{ extended: true }, 'EXTENDED', '#15803d'],
    [{ retracted: true }, 'RETRACTED', '#2563eb'],
    [{ extending: true }, 'EXTENDING', '#d97706'],
    [{ retracting: true }, 'RETRACTING', '#d97706'],
    [{ extended: true, extending: true }, 'EXTENDING', '#d97706'],
    [{ extended: true, retracted: true }, 'CONFLICT', '#b91c1c'],
    [{ extending: true, retracting: true }, 'CONFLICT', '#b91c1c'],
    [{ error: true, extended: true, retracted: true }, 'FAULT', '#b91c1c'],
  ];
  for (const [values, expected, color] of cases) {
    const widget = makeHarness().addWidget();
    feed(widget, values);
    assert.equal(widget.parts.statusText.textContent, expected, JSON.stringify(values));
    assert.equal(widget.parts.valveBody.attributes.fill, color);
    assert.equal(widget.parts.statusBand.attributes.fill, color);
  }
});

test('waits for valid values, then updates label and mode', () => {
  const widget = makeHarness().addWidget('V101');
  assert.equal(widget.parts.valveLabel.textContent, 'V101');
  assert.equal(widget.parts.statusText.textContent, 'WAITING FOR DATA');
  assert.equal(widget.parts.manualText.textContent, 'MODE ?');
  widget.putValue('_pb_extended', 'invalid');
  for (const name of signals.filter(name => name !== 'extended')) widget.putValue(`_pb_${name}`, '0');
  assert.equal(widget.parts.statusText.textContent, 'WAITING FOR DATA');
  widget.putValue('_pb_extended', '1');
  widget.putValue('_pb_isManualMode', 'true');
  widget.putValue('_ps_label', 'V101 inlet');
  assert.equal(widget.parts.statusText.textContent, 'EXTENDED');
  assert.equal(widget.parts.manualText.textContent, 'MANUAL');
  assert.equal(widget.parts.valveLabel.textContent, 'V101 inlet');
});

test('two FUXA-style instances keep their elements and values separate', () => {
  const harness = makeHarness();
  const first = harness.addWidget('V101');
  const second = harness.addWidget('V102');
  feed(first, { extended: true });
  feed(second, { retracted: true, isManualMode: true });
  assert.equal(first.parts.statusText.textContent, 'EXTENDED');
  assert.equal(second.parts.statusText.textContent, 'RETRACTED');
  assert.equal(first.parts.manualText.textContent, 'AUTO');
  assert.equal(second.parts.manualText.textContent, 'MANUAL');
  first.putValue('_pb_error', true);
  assert.equal(first.parts.statusText.textContent, 'FAULT');
  assert.equal(second.parts.statusText.textContent, 'RETRACTED');
  assert.equal(first.parts.valveBody.attributes.fill, '#b91c1c');
  assert.equal(second.parts.valveBody.attributes.fill, '#2563eb');
});

for (const [state, values] of [
  ['EXTENDED', { extended: true }],
  ['FAULT', { error: true, extended: true, retracted: true }],
  ['CONFLICT', { extended: true, retracted: true }],
]) {
  test(`${state} loses validity on disconnect and recovers identical BOOL feedback only when complete`, () => {
    const harness = makeHarness();
    const first = harness.addWidget('V101');
    const second = harness.addWidget('V102');
    feed(first, values);
    feed(second, { retracted: true, isManualMode: true });
    assert.equal(first.parts.statusText.textContent, state);
    for (const name of signals) {
      first.putValue(`_pb_${name}`, null);
      assert.equal(first.parts.statusText.textContent, 'WAITING FOR DATA');
      assert.equal(first.parts.valveBody.attributes.fill, '#64748b');
      assert.equal(first.parts.statusBand.attributes.fill, '#64748b');
      assert.equal(second.parts.statusText.textContent, 'RETRACTED');
      assert.equal(second.parts.manualText.textContent, 'MANUAL');
    }
    assert.equal(first.parts.manualText.textContent, 'MODE ?');
    for (const name of signals.slice(0, -1)) {
      first.putValue(`_pb_${name}`, values[name] ?? false);
      assert.equal(first.parts.statusText.textContent, 'WAITING FOR DATA');
      assert.equal(second.parts.statusText.textContent, 'RETRACTED');
    }
    first.putValue('_pb_isManualMode', false);
    assert.equal(first.parts.statusText.textContent, state);
    assert.equal(second.parts.statusText.textContent, 'RETRACTED');
    feed(first, { extending: true });
    assert.equal(first.parts.statusText.textContent, 'EXTENDING');
    assert.equal(second.parts.valveBody.attributes.fill, '#2563eb');
  });
}

test('development mount follows FUXA widget discovery and binding paths', () => {
  const compose = fs.readFileSync(path.join(repo, 'compose.dev.yml'), 'utf8');
  const resources = fs.readFileSync(path.join(repo, 'server/api/resources/index.js'), 'utf8');
  const image = fs.readFileSync(path.join(repo, 'client/src/app/gauges/controls/html-image/html-image.component.ts'), 'utf8');
  assert.match(compose, /\.\/custom\/widgets:\/usr\/src\/app\/FUXA\/server\/_widgets:ro/);
  assert.match(compose, /1882:1881/);
  assert.match(resources, /runtime\.settings\.widgetsFileDir/);
  assert.match(image, /SvgUtils\.processWidget/);
  assert.match(image, /\['putValue'\]\(widgetVar\.name, sig\.value\)/);
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  for (const member of ['Extended', 'Retracted', 'Extending', 'Retracting', 'Error', 'IsManualMode']) {
    assert.ok(readme.includes(`GVL.g_aValve_HMI[1,1].Sts.${member}`));
  }
});
