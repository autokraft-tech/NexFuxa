'use strict';

const assert = require('node:assert/strict');
const Device = require('../../runtime/devices/device');
const devices = require('../../runtime/devices');

describe('PLC device reload', function () {
    const originalCreate = Device.create;
    const id = 'phase3b-test-device';
    let active;
    let operations;

    beforeEach(function () {
        operations = [];
        active = {
            stop: async () => { operations.push('stop'); },
            load: data => { operations.push(`load:${data.name}`); },
            start: async () => { operations.push('start'); },
            bindGetProperty: () => {},
            bindUpdateConnectionStatus: () => {}
        };
        Device.create = () => active;
        devices.init({ project: { getDevices: () => ({ [id]: { id, name: 'initial', enabled: true } }),
            getServer: () => null, getDeviceProperty: () => {} },
            daqStorage: { reset: () => {} }, settings: { daqEnabled: false },
            logger: { info: () => {}, warn: () => {}, error: () => {} } });
        devices.load();
    });

    afterEach(function () { Device.create = originalCreate; });

    it('waits for stop and reports a stop failure without loading or starting', async function () {
        active.stop = async () => { operations.push('stop'); throw new Error('stop failed'); };
        await assert.rejects(devices.updateDevice({ id, name: 'new', enabled: true }), /stop failed/);
        assert.deepEqual(operations, ['stop']);
    });

    it('waits for start and reports a start failure', async function () {
        active.start = async () => { operations.push('start'); throw new Error('start failed'); };
        await assert.rejects(devices.updateDevice({ id, name: 'new', enabled: true }), /start failed/);
        assert.deepEqual(operations, ['stop', 'load:new', 'start']);
    });

    it('serializes consecutive reloads and ends with the newest device', async function () {
        let releaseStop;
        active.stop = () => new Promise(resolve => {
            operations.push('stop');
            if (!releaseStop) releaseStop = resolve;
            else resolve();
        });
        const first = devices.updateDevice({ id, name: 'first', enabled: true });
        const second = devices.updateDevice({ id, name: 'second', enabled: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(operations, ['stop']);
        releaseStop();
        await Promise.all([first, second]);
        assert.deepEqual(operations, ['stop', 'load:first', 'start', 'stop', 'load:second', 'start']);
    });

    it('allows a later reload after a failed stop', async function () {
        let attempts = 0;
        active.stop = async () => {
            operations.push('stop');
            if (++attempts === 1) throw new Error('stop failed');
        };
        const first = devices.updateDevice({ id, name: 'first', enabled: true });
        const second = devices.updateDevice({ id, name: 'second', enabled: true });
        await assert.rejects(first, /stop failed/);
        await second;
        assert.deepEqual(operations, ['stop', 'stop', 'load:second', 'start']);
    });
});
