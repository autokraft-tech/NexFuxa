'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
    const drivers = [], timers = new Map(), writes = [], events = [];
    let sequence = 0;
    const filename = require.resolve('../../runtime/devices/device');
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const factory = { create: (data, logger, emitter) => {
        const driver = { connected: false, attempts: [], disconnects: 0, polls: 0,
            connect() { return new Promise((resolve, reject) => this.attempts.push({
                resolve: () => { this.connected = true; emitter.emit('device-status:changed', { status: 'connect-ok' }); resolve(); }, reject })); },
            async disconnect() { this.disconnects++; this.connected = false; emitter.emit('device-status:changed', { status: 'connect-off' }); },
            isConnected() { return this.connected; }, polling() { this.polls++; },
            load(next) { this.data = next; }, lastReadTimestamp: () => Date.now(),
            getStatus() { return this.connected ? 'connect-ok' : 'connect-off'; },
            getValue: () => null, getValues: () => ({}), getTagProperty: () => ({}),
            bindAddDaq(fn) { this.daq = fn; },
            async setValue(id, value) { writes.push({ id, value }); return true; }
        };
        drivers.push(driver);
        return driver;
    } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module,
        require: id => id === './adsclient' ? factory : localRequire(id),
        setInterval: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
        clearInterval: id => timers.delete(id),
        setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id), console, Buffer });
    const device = module.exports.create({ id: 'session', name: 'ADS', type: 'ADSclient', enabled: true, polling: 10, tags: {} }, {
        logger: { info() {}, warn() {}, error() {} }, events: { emit: (...args) => events.push(args) },
        plugins: { manager: {} }, project: { getDeviceProperty() {} }, settings: {}
    });
    let restoreReads = 0;
    device.bindSaveDaqValue(() => {});
    device.bindGetDaqValueToRestore(async () => { restoreReads++; return [{ id: 'ordinary', value: true }]; });
    function managed() {
        const filename = require.resolve('../../runtime/devices');
        const loaded = { exports: {} };
        const requireHere = createRequire(filename);
        let active;
        const realDevice = { ...module.exports, create(data, runtime) {
            active = module.exports.create(data, runtime); return active;
        } };
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module: loaded, require: id => id === './device' ? realDevice : requireHere(id), console
        });
        const data = { id: 'managed', name: 'ADS', type: 'ADSclient', enabled: true, polling: 10, tags: {} };
        loaded.exports.init({ logger: { info() {}, warn() {}, error() {} }, events: { emit: (...args) => events.push(args) },
            plugins: { manager: {} }, settings: { daqEnabled: true },
            project: { getDevices: () => ({ managed: data }), getServer: () => null, getDeviceProperty() {} },
            daqStorage: { reset() {}, addDaqNode: () => () => {}, getCurrentStorageFnc: () => async () => {
                restoreReads++; return [{ id: 'ordinary', value: true }];
            } }
        });
        loaded.exports.load();
        return { manager: loaded.exports, data, active: () => active };
    }
    return { device, drivers, timers, writes, events, managed, reads: () => restoreReads,
        pending: () => drivers.flatMap(d => d.attempts),
        tick: () => [...timers.values()].forEach(t => t.fn()) };
}

describe('Device session connection ownership', function () {
    it('recovers stop/start without waiting for an abandoned connection and cleans only its old driver', async function () {
        const f = fixture();
        f.device.start();
        const old = f.pending()[0];
        await f.device.stop();
        f.device.start();
        assert.equal(f.pending().length, 2, 'new session must connect while old Promise remains pending');
        const current = f.drivers.at(-1);
        f.pending()[1].resolve(); await settle();
        assert.equal(f.reads(), 1);
        const emissions = f.events.length;
        old.resolve(); await settle();
        assert.equal(f.events.length, emissions, 'retired driver cannot publish stale status');
        assert.equal(typeof current.daq, 'function', 'replacement driver keeps DAQ binding');
        assert.equal(current.connected, true, 'late old cleanup must not disconnect current session');
        assert.equal(f.drivers[0].connected, false);
        assert.equal(f.reads(), 1, 'old success must not Restore again');
        assert.equal(f.timers.size, 2, 'one status and one polling timer');
        await f.device.stop(); assert.equal(f.timers.size, 0);
    });

    it('old completion cannot unlock the new pending attempt or restore Generator values', async function () {
        const f = fixture();
        f.device.start(); const old = f.pending()[0];
        await f.device.stop(); f.device.start({ suppressRestore: true });
        assert.equal(f.pending().length, 2);
        old.resolve(); await settle(); f.device.checkStatus();
        assert.equal(f.pending().length, 2, 'old finally must not clear the new connection lock');
        f.pending()[1].resolve(); await settle();
        assert.equal(f.drivers.at(-1).connected, true);
        assert.equal(f.reads(), 0); assert.equal(f.writes.length, 0);
        await f.device.stop();
    });

    it('ignores a retired connection rejection while the replacement is pending', async function () {
        const f = fixture();
        f.device.start(); const old = f.pending()[0];
        await f.device.stop(); f.device.start();
        old.reject(new Error('late old failure')); await settle();
        f.device.checkStatus();
        assert.equal(f.pending().length, 2);
        f.pending()[1].resolve(); await settle();
        assert.equal(f.reads(), 1);
        assert.equal(f.drivers.at(-1).connected, true);
        await f.device.stop();
    });

    it('serializes real manager reloads while retiring pending sessions and preserves ordinary Restore', async function () {
        const f = fixture();
        const { manager, data, active } = f.managed();
        await manager.updateDevice(data, { suppressRestore: true });
        await Promise.all([
            manager.updateDevice(data, { suppressRestore: true }),
            manager.updateDevice(data, { suppressRestore: true }),
            manager.updateDevice(data)
        ]);
        assert.equal(f.pending().length, 4);
        assert.equal(f.timers.size, 1);
        f.pending()[3].resolve(); await settle();
        assert.equal(f.reads(), 1);
        for (const attempt of f.pending().slice(0, 3)) attempt.resolve();
        await settle();
        assert.equal(active().getComm().connected, true);
        assert.equal(f.reads(), 1);
        assert.equal(f.timers.size, 2);
        await manager.updateDevice(data, { suppressRestore: true });
        f.pending().at(-1).resolve(); await settle();
        assert.equal(f.reads(), 1, 'Generator reload must not Restore after ordinary reload');
        await manager.stop(); assert.equal(f.timers.size, 0);
    });

    it('global stop/start does not publish late status from the replaced Device wrapper', async function () {
        const f = fixture();
        const { manager } = f.managed();
        await manager.start(); const old = f.pending()[0];
        await manager.stop(); await manager.start();
        f.pending()[1].resolve(); await settle();
        const emissions = f.events.length;
        old.resolve(); await settle();
        assert.equal(f.events.length, emissions);
        assert.equal(f.reads(), 1);
        await manager.stop(); assert.equal(f.timers.size, 0);
    });

    it('bounds pending-driver teardown and queues immediate start behind that boundary', async function () {
        const f = fixture();
        f.device.start();
        f.drivers[0].disconnect = () => new Promise(() => {});
        const stopped = f.device.stop();
        const restarted = f.device.start({ suppressRestore: true });
        assert.equal(f.pending().length, 1);
        const deadline = [...f.timers.values()].find(timer => timer.ms === 1000);
        assert.ok(deadline, 'abandoned teardown must have a bounded recovery deadline');
        deadline.fn();
        await stopped; await restarted;
        assert.equal(f.pending().length, 2);
        f.pending()[1].resolve(); await settle();
        assert.equal(f.drivers.at(-1).connected, true);
        assert.equal(f.reads(), 0);
        await f.device.stop(); assert.equal(f.timers.size, 0);
    });

    it('a newer stop cancels a start queued behind old driver teardown', async function () {
        const f = fixture();
        f.device.start();
        f.drivers[0].disconnect = () => new Promise(() => {});
        const stopped = f.device.stop();
        const restart = f.device.start();
        const stoppedAgain = f.device.stop();
        [...f.timers.values()].find(timer => timer.ms === 1000).fn();
        await Promise.all([stopped, restart, stoppedAgain]);
        assert.equal(f.pending().length, 1, 'superseded start must not revive a stopped Device');
        assert.equal(f.timers.size, 0);
        assert.equal(f.writes.length, 0);
    });

    it('repeated start and reload cycles have one connection, Restore and polling owner', async function () {
        const f = fixture();
        for (let i = 0; i < 6; i++) {
            f.device.start(); f.device.start();
            assert.equal(f.timers.size, 1, 'repeated start cannot leak status intervals');
            f.pending().at(-1).resolve(); await settle();
            f.device.start(); f.tick(); await settle();
            assert.equal(f.reads(), i + 1);
            assert.equal(f.timers.size, 2);
            await f.device.stop(); assert.equal(f.timers.size, 0);
        }
    });
});
