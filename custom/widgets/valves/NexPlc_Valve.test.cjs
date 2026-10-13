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

test('state priority and feedback conflicts', () => {
  const cases = [
    [{}, 'UNKNOWN'],
    [{ extended: true }, 'EXTENDED'],
    [{ retracted: true }, 'RETRACTED'],
    [{ extending: true }, 'EXTENDING'],
    [{ retracting: true }, 'RETRACTING'],
    [{ extended: true, extending: true }, 'EXTENDING'],
    [{ extended: true, retracted: true }, 'CONFLICT'],
    [{ extending: true, retracting: true }, 'CONFLICT'],
    [{ error: true, extended: true, retracted: true }, 'FAULT'],
  ];
  for (const [values, expected] of cases) {
    const widget = makeHarness().addWidget();
    feed(widget, values);
    assert.equal(widget.parts.statusText.textContent, expected, JSON.stringify(values));
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
});

test('development mount follows FUXA widget discovery and binding paths', () => {
  const compose = fs.readFileSync(path.join(repo, 'compose.dev.yml'), 'utf8');
  const resources = fs.readFileSync(path.join(repo, 'server/api/resources/index.js'), 'utf8');
  const image = fs.readFileSync(path.join(repo, 'client/src/app/gauges/controls/html-image/html-image.component.ts'), 'utf8');
  assert.match(compose, /\.\/custom\/widgets:\/usr\/src\/app\/FUXA\/server\/_widgets:ro/);
  assert.match(compose, /1882:1881/);
  assert.match(resources, /runtime\.settings\.widgetsFileDir/);
  assert.match(image, /SvgUtils\.processWidget/);
  assert.match(image, /\['putValue'\]\(widgetVar\.name, sig\.value\)/);
});
