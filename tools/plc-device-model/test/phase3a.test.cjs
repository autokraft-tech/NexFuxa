'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseCsv } = require('../csv.cjs');
const { expand } = require('../model.cjs');
const { mergeDevices } = require('../fuxa.cjs');
const { run } = require('../cli.cjs');
const model = require('../models/valve.v1.json');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/devices.sanitized.json'), 'utf8'));
const config = fs.readFileSync(path.join(__dirname, '../examples/valves.csv'), 'utf8');
const deviceId = 'd_b6ba9d1c-2b054dc3';
const v101 = fixture.find(device => device.id === deviceId);
let nextId = 0;
const newId = () => `t_00000000-${(++nextId).toString(16).padStart(8, '0')}`;

test('CSV accepts Excel quoting and normalizes array index spaces', () => {
    const rows = parseCsv('\uFEFF' + config.replace('"1,2"', '"1, 2"'));
    const tags = expand(model, rows);
    assert.equal(tags.length, 12);
    assert.equal(tags[6].address, 'GVL.g_aValve_HMI[1,2].Sts.Extended');
    assert.ok(tags.every(tag => !/\[\d+,\s+\d+\]/.test(tag.address)));
});

test('model represents the four DUTs and profiles with exact supported ADS types', () => {
    assert.equal(model.source.commit, '04b27f25dce1b1be335c5f51f539496f195e3708');
    assert.deepEqual(model.types.ST_Valve_HMI, { Cmd: 'ST_Valve_Command', Sts: 'ST_Valve_Status', Cfg: 'ST_Valve_Config' });
    assert.equal(model.profiles.Status.length, 6);
    assert.deepEqual(model.profiles.Status.map(path => path.split('.').at(-1)), ['Extended', 'Retracted', 'Extending', 'Retracting', 'Error', 'IsManualMode']);
    assert.ok(model.profiles.Status.every(path => model.types.ST_Valve_Status[path.split('.')[1]] === 'BOOL'));
    assert.equal(model.profiles.Control.length, 4);
    assert.equal(model.profiles.Engineering.length, 16);
    assert.equal(model.profiles.Full.length, 20);
    const rows = parseCsv(config);
    rows[0].Profile = 'Full';
    const tags = expand(model, [rows[0]]);
    assert.equal(tags.find(tag => tag.address.endsWith('.Sts.ExtendTime')).type, 'number');
    assert.equal(tags.find(tag => tag.address.endsWith('.Cfg.MaxLifeTimeCount')).type, 'number');
    assert.equal(tags.find(tag => tag.address.endsWith('.Cmd.Reset')).type, 'boolean');
    const unsupported = structuredClone(model);
    unsupported.types.ST_Valve_Status.ExtendTime = 'TIME';
    assert.throws(() => expand(unsupported, [rows[0]]), /Unsupported PLC primitive TIME/);
    const withString = structuredClone(model);
    withString.types.ST_Valve_Status.Extended = 'STRING';
    assert.equal(expand(withString, [parseCsv(config)[0]])[0].type, 'string');
});

test('safe merge preserves V101 eight tags and all device properties, creates V102, and is idempotent', () => {
    nextId = 0;
    const candidates = expand(model, parseCsv(config));
    const first = mergeDevices(fixture, candidates, newId);
    assert.equal(first.report.reused.length, 6);
    assert.equal(first.report.created.length, 6);
    assert.equal(first.report.conflicts.length, 0);
    assert.equal(first.report.unchanged.length, 3); // Two V101 commands and one FUXA system tag.
    const mergedDevice = first.devices.find(device => device.id === deviceId);
    assert.deepEqual(mergedDevice.property, v101.property);
    assert.deepEqual(first.devices.find(device => device.id === '0'), fixture.find(device => device.id === '0'));
    for (const [id, tag] of Object.entries(v101.tags)) assert.deepEqual(mergedDevice.tags[id], tag);
    assert.equal(Object.keys(mergedDevice.tags).length, 14);
    for (const entry of first.report.created) {
        const tag = mergedDevice.tags[entry.id];
        assert.equal(tag.type, 'boolean');
        assert.equal(tag.address, entry.address);
        assert.deepEqual(tag.daq, { enabled: false, interval: 60, changed: false, restored: false });
        assert.ok(!('value' in tag) && !('timestamp' in tag));
    }
    assert.ok(first.report.created.every(entry => entry.address.startsWith('GVL.g_aValve_HMI[1,2].Sts.')));
    const repeat = mergeDevices(first.devices, candidates, newId);
    assert.equal(repeat.report.created.length, 0);
    assert.equal(repeat.report.reused.length, 12);
    assert.deepEqual(repeat.devices, first.devices);
    assert.deepEqual(fixture.find(device => device.id === deviceId), v101);

    // Same array/dictionary structure consumed by exportDevices/importDevices and Device.tags.
    const roundTrip = JSON.parse(JSON.stringify(first.devices));
    assert.ok(Array.isArray(roundTrip));
    assert.ok(roundTrip.every(device => device.id && device.name && device.type && device.tags && !Array.isArray(device.tags)));
    for (const device of roundTrip) for (const [id, tag] of Object.entries(device.tags)) assert.equal(tag.id, id);
    assert.deepEqual(roundTrip, first.devices);
});

test('conflicting names, addresses, types and duplicate requests are reported without replacing tags', () => {
    const base = expand(model, parseCsv(config))[6];
    const conflicting = structuredClone(fixture);
    const device = conflicting.find(item => item.id === deviceId);
    const existing = Object.values(device.tags)[0];
    const typeConflict = mergeDevices(conflicting, [{ ...base, address: existing.address, type: 'number' }], newId);
    assert.match(typeConflict.report.conflicts[0].reason, /Type conflict/);
    const nameConflict = mergeDevices(conflicting, [{ ...base, name: existing.name }], newId);
    assert.match(nameConflict.report.conflicts[0].reason, /Name conflict/);
    const duplicateAddress = structuredClone(conflicting);
    const duplicateDevice = duplicateAddress.find(item => item.id === deviceId);
    duplicateDevice.tags['t_aaaaaaaa-bbbbbbbb'] = { id: 't_aaaaaaaa-bbbbbbbb', name: 'duplicate', address: existing.address, type: 'boolean' };
    const addressConflict = mergeDevices(duplicateAddress, [{ ...base, address: existing.address }], newId);
    assert.match(addressConflict.report.conflicts[0].reason, /Duplicate existing address/);
    const repeated = mergeDevices(conflicting, [base, base], newId);
    assert.match(repeated.report.conflicts[0].reason, /Duplicate requested address/);
    assert.equal(Object.keys(typeConflict.devices.find(item => item.id === deviceId).tags).length, 8);
    assert.deepEqual(conflicting, fixture);
});

test('CLI dry-run writes a report without writing devices JSON', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-phase3a-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const report = path.join(directory, 'report.md');
    const output = path.join(directory, 'devices.json');
    const summary = run([
        '--input', path.join(__dirname, 'fixtures/devices.sanitized.json'),
        '--config', path.join(__dirname, '../examples/valves.csv'),
        '--output', output, '--report', report, '--dry-run'
    ]);
    assert.equal(summary.created.length, 6);
    assert.ok(fs.readFileSync(report, 'utf8').includes('Newly created Tags (6)'));
    assert.equal(fs.existsSync(output), false);
});

test('CLI rejects every input/output path collision, including hard links', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-phase3a-paths-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const input = path.join(directory, 'input.json');
    const csv = path.join(directory, 'instances.csv');
    const output = path.join(directory, 'output.json');
    const report = path.join(directory, 'report.md');
    fs.copyFileSync(path.join(__dirname, 'fixtures/devices.sanitized.json'), input);
    fs.writeFileSync(csv, config);
    const args = (a, b, c, d) => ['--input', a, '--config', b, '--output', c, '--report', d];
    for (const collision of [args(input, input, output, report), args(input, csv, input, report),
        args(input, csv, output, input), args(input, csv, csv, report),
        args(input, csv, output, csv), args(input, csv, output, output)]) {
        assert.throws(() => run(collision), /refer to the same file/);
    }
    const hardLink = path.join(directory, 'input-link.md');
    fs.linkSync(input, hardLink);
    assert.throws(() => run(args(input, csv, output, hardLink)), /refer to the same file/);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(input, 'utf8')), fixture);
});

test('CLI refuses existing outputs, and explicit overwrite publishes complete files', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexfuxa-phase3a-output-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const input = path.join(directory, 'input.json');
    const csv = path.join(directory, 'instances.csv');
    const output = path.join(directory, 'output.json');
    const report = path.join(directory, 'report.md');
    fs.copyFileSync(path.join(__dirname, 'fixtures/devices.sanitized.json'), input);
    fs.writeFileSync(csv, config);
    const args = ['--input', input, '--config', csv, '--output', output, '--report', report];
    fs.writeFileSync(output, 'old JSON');
    assert.throws(() => run(args), /Output already exists/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'old JSON');
    assert.equal(fs.existsSync(report), false);
    fs.writeFileSync(report, 'old report');
    assert.throws(() => run(args), /Output already exists/);
    assert.equal(fs.readFileSync(report, 'utf8'), 'old report');
    assert.equal(fs.readFileSync(output, 'utf8'), 'old JSON');
    run([...args, '--overwrite']);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(output, 'utf8')).find(device => device.id === deviceId).tags).length, 14);
    assert.match(fs.readFileSync(report, 'utf8'), /Newly created Tags \(6\)/);
    assert.deepEqual(JSON.parse(fs.readFileSync(input, 'utf8')), fixture);
    assert.ok(fs.readdirSync(directory).every(name => !name.endsWith('.tmp')));
});

test('duplicate device IDs and ambiguous instances fail before tag generation', () => {
    assert.throws(() => mergeDevices([fixture[0], fixture[0]], [], newId), /Duplicate device ID 0/);
    const rows = parseCsv(config);
    assert.throws(() => expand(model, [rows[0], rows[0]]), /Duplicate or ambiguous Device Name/);
    assert.throws(() => expand(model, [{ ...rows[1], 'Device Name': 'V101' }, rows[0]]), /Duplicate or ambiguous Device Name/);
    assert.throws(() => expand(model, [{ ...rows[0], 'Array Symbol': ' GVL.g_aValve_HMI' }]), /Invalid Array Symbol/);
    assert.throws(() => expand(model, [{ ...rows[0], 'Array Symbol': 'GVL.g_aValve_HMI ' }]), /Invalid Array Symbol/);
    assert.throws(() => expand(model, [{ ...rows[0], 'Array Symbol': 'GVL.bad-symbol' }]), /Invalid Array Symbol/);
    assert.throws(() => expand(model, parseCsv(config.replace('GVL.g_aValve_HMI', ' GVL.g_aValve_HMI'))), /Invalid Array Symbol/);
    assert.throws(() => expand(model, [{ ...rows[0], 'Device Model': 'Valve@2.0.0' }]), /Unknown device model/);
    assert.throws(() => expand(model, [{ ...rows[0], Profile: 'Unknown' }]), /Unknown profile/);
    assert.throws(() => expand(model, [{ ...rows[0], 'Array Indices': '1,01' }]), /Invalid array indices/);
});

test('ADS types agree with current editor/runtime; legacy types and IDs remain unchanged', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../../../client/src/app/_models/device.ts'), 'utf8');
    const runtime = fs.readFileSync(path.join(__dirname, '../../../server/runtime/devices/adsclient/index.js'), 'utf8');
    for (const [name, type] of [['Boolean', 'boolean'], ['Number', 'number'], ['String', 'string']]) {
        assert.match(editor, new RegExp(`${name} = '${type}'`));
        assert.match(runtime, new RegExp(`${type}: '${type}'`));
    }
    const candidate = expand(model, [parseCsv(config)[1]])[0];
    for (const [legacy, current] of [['Boolean', 'boolean'], ['Number', 'number'], ['String', 'string']]) {
        const original = structuredClone(fixture);
        const device = original.find(item => item.id === deviceId);
        const tag = Object.values(device.tags)[0];
        tag.address = candidate.address;
        tag.type = legacy;
        const merged = mergeDevices(original, [{ ...candidate, type: current }], newId);
        assert.equal(merged.report.reused[0].id, tag.id);
        assert.equal(merged.report.created.length, 0);
        assert.deepEqual(merged.devices.find(item => item.id === deviceId).tags[tag.id], tag);
    }
});
