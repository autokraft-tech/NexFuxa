'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const valve = require('../models/valve.v1.json');
const { generate, validateModel } = require('../generator.cjs');

const deviceId = 'ads-1';
const devices = { [deviceId]: { id: deviceId, type: 'ADSclient', tags: {} } };
const base = { schemaVersion: 2, id: 'config_1', name: 'Example', deviceId,
    tagPrefix: 'Example', adsSymbol: 'GVL.bStart', valueKind: 'primitive', plcType: 'BOOL',
    array: { mode: 'scalar' } };
const pump = validateModel({ schemaVersion: 2, name: 'Pump', version: '1.0.0', rootType: 'ST_Pump_HMI',
    types: { ST_Pump_HMI: { Cmd: 'ST_Pump_Command', Sts: 'ST_Pump_Status' },
        ST_Pump_Command: { Start: 'BOOL', Stop: 'BOOL' },
        ST_Pump_Status: { Running: 'BOOL', Speed: 'REAL', ErrorCode: 'UDINT' } } });

test('primitive scalar and one dimensional array use individual ADS symbols', () => {
    assert.deepEqual(generate(base, [valve], devices).map(tag => [tag.name, tag.address, tag.type]),
        [['Example', 'GVL.bStart', 'boolean']]);
    const tags = generate({ ...base, adsSymbol: 'GVL.aTemperature', plcType: 'REAL',
        array: { mode: 'range', dimensions: [{ start: 0, end: 9, step: 1 }] } }, [valve], devices);
    assert.equal(tags.length, 10);
    assert.equal(tags[0].address, 'GVL.aTemperature[0]');
    assert.equal(tags[9].name, 'Example_9');
});

test('Valve scalar, array and selected multidimensional elements', () => {
    const structure = { ...base, valueKind: 'structure', model: 'Valve@1.0.0', adsSymbol: 'GVL.stValve' };
    assert.equal(generate(structure, [valve], devices).length, 20);
    const array = { ...structure, adsSymbol: 'GVL.aValve', array: { mode: 'range',
        dimensions: [{ start: 1, end: 2, step: 1 }] } };
    assert.equal(generate(array, [valve], devices).length, 40);
    const two = [1, 2].flatMap(last => generate({ ...structure, adsSymbol: 'GVL.g_aValve_HMI',
        tagPrefix: `V10${last}`, array: { mode: 'element', indices: [1, last] } }, [valve], devices));
    assert.equal(two.length, 40);
    assert.equal(two[0].address, 'GVL.g_aValve_HMI[1,1].Cmd.Extend');
    assert.equal(two[20].address, 'GVL.g_aValve_HMI[1,2].Cmd.Extend');
});

test('custom nested Pump model works as scalar and array', () => {
    const config = { ...base, valueKind: 'structure', model: 'Pump@1.0.0', adsSymbol: 'GVL.stPump' };
    const scalar = generate(config, [valve, pump], devices);
    assert.equal(scalar.length, 5);
    assert.ok(scalar.some(tag => tag.address === 'GVL.stPump.Sts.Running'));
    const array = generate({ ...config, adsSymbol: 'GVL.aPump', array: { mode: 'range',
        dimensions: [{ start: 1, end: 2, step: 1 }] } }, [valve, pump], devices);
    assert.equal(array.length, 10);
    assert.ok(array.some(tag => tag.address === 'GVL.aPump[2].Sts.Running'));
});

test('selected primitive element and two dimensional ranges keep actual indices', () => {
    const element = generate({ ...base, plcType: 'UINT', adsSymbol: 'GVL.aCount',
        array: { mode: 'element', indices: [7] } }, [valve], devices);
    assert.equal(element[0].address, 'GVL.aCount[7]');
    assert.equal(element[0].type, 'number');
    const grid = generate({ ...base, adsSymbol: 'GVL.aaReady', array: { mode: 'range',
        dimensions: [{ start: 1, end: 1, step: 1 }, { start: 1, end: 2, step: 1 }] } }, [valve], devices);
    assert.deepEqual(grid.map(tag => tag.address), ['GVL.aaReady[1,1]', 'GVL.aaReady[1,2]']);
    assert.equal(generate({ ...base, adsSymbol: 'GVL.aReady', array: { mode: 'range',
        dimensions: [{ start: 0, end: 499, step: 1 }] } }, [valve], devices).length, 500);
});

test('invalid type, range, count and duplicate naming are rejected', () => {
    assert.throws(() => generate({ ...base, plcType: 'TIME' }, [valve], devices), /Unsupported/);
    assert.throws(() => generate({ ...base, adsSymbol: 'GVL.' + 'A'.repeat(257) }, [valve], devices), /Invalid ADS Symbol/);
    assert.throws(() => generate({ ...base, array: { mode: 'range', dimensions: [{ start: 1, end: 2, step: 0 }] } }, [valve], devices), /range/);
    assert.throws(() => generate({ ...base, array: { mode: 'range', dimensions: [{ start: 1, end: 501, step: 1 }] } }, [valve], devices), /500/);
    assert.throws(() => generate({ ...base, array: { mode: 'range', dimensions: [{ start: 1, end: 2, step: 1 }] },
        namingTemplate: '{prefix}' }, [valve], devices), /duplicate/);
    assert.throws(() => validateModel({ ...pump, version: '1.0.1', types: {
        ST_Pump_HMI: { Cmd: 'UNKNOWN' } } }), /Unsupported/);
});

test('member defaults and partial configuration overrides preserve native Tag properties', () => {
    const custom = validateModel({ ...pump, memberDefaults: {
        'Sts.Speed': { daq: { enabled: true, interval: 10, changed: true, restored: false },
            description: 'Speed', format: 2, scale: { mode: 'linear', rawLow: 0, rawHigh: 100, scaledLow: 0, scaledHigh: 10 },
            scaleReadFunction: 'script_read', scaleWriteFunction: null, unsPath: 'plant/pump/speed' }
    } });
    const config = { ...base, valueKind: 'structure', model: 'Pump@1.0.0', memberPaths: ['Sts.Speed'],
        memberOverrides: { 'Sts.Speed': { daq: { interval: 5 }, description: 'Override' } } };
    const [tag] = generate(config, [custom], devices);
    assert.deepEqual(tag.daq, { enabled: true, interval: 5, changed: true, restored: false });
    assert.equal(tag.description, 'Override');
    assert.equal(tag.format, 2);
    assert.equal(tag.unsPath, 'plant/pump/speed');
    assert.equal(tag.scaleReadFunction, 'script_read', 'references must remain inert strings');
    assert.deepEqual(custom.memberDefaults['Sts.Speed'].daq.interval, 10);
    assert.equal(generate({ ...config, memberOverrides: {} }, [custom], devices)[0].daq.interval, 10);
});

test('invalid member properties and generated identity overrides are rejected', () => {
    for (const properties of [{ id: 'stolen' }, { type: 'string' }, { daq: { interval: 0 } }, { daq: { interval: 0.5 } },
        { daq: { restored: 'yes' } }, { format: 101 }, { scale: { mode: 'linear', rawLow: 1, rawHigh: 1 } }]) {
        assert.throws(() => validateModel({ ...pump, memberDefaults: { 'Sts.Speed': properties } }));
    }
    assert.throws(() => generate({ ...base, memberOverrides: { Unknown: {} } }, [pump], devices), /Unknown property/);
});
