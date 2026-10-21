'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const Device = require('../../runtime/devices/device');
const devices = require('../../runtime/devices');
const { createManager } = require('../../api/plc-device-models/manager');

function loadModule(filename, overrides, extra = '') {
    const localRequire = createRequire(filename);
    const context = { module: { exports: {} }, require: id => overrides[id] || localRequire(id),
        setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout, console, Buffer };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + extra, context, { filename });
    return context.module.exports;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('Generator reload Restore safety (real runtime and Device state machine)', function () {
    const originalCreate = Device.create;
    let driver, active, data, runtime, manager, project, configurations, restoreReads, connectResolve, failConnect, restoreProvider;

    beforeEach(function () {
        data = { id: 'restore-device', name: 'ADS', type: 'ADSclient', enabled: true, tags: {
            existing: { id: 'existing', name: 'Existing', type: 'boolean', address: 'GVL.bExisting',
                daq: { enabled: true, interval: 60, changed: true, restored: true }, value: true }
        } };
        configurations = [{ schemaVersion: 2, id: 'new', name: 'New', deviceId: data.id,
            tagPrefix: 'New', adsSymbol: 'GVL.bNew', valueKind: 'primitive', plcType: 'BOOL', array: { mode: 'scalar' } }];
        restoreReads = 0;
        failConnect = false;
        restoreProvider = () => Promise.resolve([{ id: 'existing', value: false }]);
        driver = {
            connected: false, writes: [], loaded: [],
            load: next => { driver.loaded.push(structuredClone(next)); },
            connect: () => new Promise((resolve, reject) => {
                connectResolve = () => {
                    if (failConnect) reject(new Error('offline'));
                    else { driver.connected = true; resolve(); }
                };
            }),
            disconnect: async () => { driver.connected = false; },
            isConnected: () => driver.connected, lastReadTimestamp: () => Date.now(),
            polling: () => {}, bindAddDaq: () => {}, getTagProperty: () => {}, getValue: () => null,
            setValue: async (id, value) => { driver.writes.push({ id, value }); return true; }
        };
        const realDevice = loadModule(require.resolve('../../runtime/devices/device'), {
            './adsclient': { create: () => driver }
        });
        Device.create = (next, resource) => { active = realDevice.create(next, resource); return active; };
        project = {
            getDevices: () => ({ [data.id]: data }), getServer: () => null, getDeviceProperty: () => {},
            getTagGeneratorModels: () => [], getTagGeneratorConfigurations: () => configurations,
            getDevicesHash: () => JSON.stringify([data, configurations]),
            commitDeviceTags: async (id, hash, build) => {
                assert.equal(id, data.id);
                assert.equal(hash, project.getDevicesHash());
                const result = build(structuredClone(data));
                data = result.device;
                return result;
            }
        };
        runtime = loadModule(require.resolve('../../runtime'), { './devices': devices },
            '\nalarmsMgr = { reset() {} }; logger = { error() {} };');
        devices.init({ project, plugins: { manager: {} }, events: { emit() {} },
            settings: { daqEnabled: true }, logger: { info() {}, warn() {}, error() {} },
            daqStorage: { reset() {}, addDaqNode: () => () => {}, getCurrentStorageFnc: () => () => {
                restoreReads++;
                return restoreProvider();
            } } });
        devices.load();
        manager = createManager(project, runtime.update);
    });

    afterEach(async function () {
        await active.stop();
        Device.create = originalCreate;
    });

    async function apply() {
        const preview = manager.previewConfigurations(['new'], 'admin', manager.configurations().hash);
        return manager.apply(preview.token, 'admin');
    }

    it('reproduces normal delayed-start Restore writes to an existing restored Tag', async function () {
        active.start();
        assert.equal(driver.writes.length, 0);
        connectResolve();
        await settle();
        assert.deepEqual(driver.writes, [{ id: 'existing', value: false }]);
        driver.connected = false;
        active.checkStatus();
        active.checkStatus();
        connectResolve();
        await settle();
        assert.equal(driver.writes.length, 2, 'ordinary reconnect retains native Restore');
    });

    it('reproduces the unsafe Apply chain when a runtime adapter drops suppression', async function () {
        const unsafeManager = createManager(project, (cmd, next) => runtime.update(cmd, next));
        const preview = unsafeManager.previewConfigurations(['new'], 'admin', unsafeManager.configurations().hash);
        await unsafeManager.apply(preview.token, 'admin');
        connectResolve();
        await settle();
        assert.deepEqual(driver.writes, [{ id: 'existing', value: false }]);
    });

    it('does not overlap delayed connection attempts or replay ordinary Restore twice', async function () {
        active.start();
        const firstConnect = connectResolve;
        active.checkStatus();
        active.checkStatus();
        assert.equal(connectResolve, firstConnect, 'status checks must reuse the pending connection');
        firstConnect();
        await settle();
        assert.equal(restoreReads, 1);
        assert.deepEqual(driver.writes, [{ id: 'existing', value: false }]);
    });

    it('Apply refreshes Tags but suppresses all Restore writes after delayed connection and repeated Apply', async function () {
        const original = structuredClone(data.tags.existing);
        for (let i = 0; i < 2; i++) {
            const result = await apply();
            assert.equal(result.persistence, 'committed');
            assert.equal(result.runtime.status, 'updated');
            assert.equal(result.created, i === 0 ? 1 : 0);
            assert.equal(driver.writes.length, 0);
            connectResolve();
            await settle();
            active.restoreValues();
            await settle();
            assert.equal(restoreReads, 0);
            assert.deepEqual(driver.writes, []);
            assert.deepEqual(data.tags.existing, original);
            assert.deepEqual(driver.loaded.at(-1).tags, data.tags);
            assert.equal(Object.values(data.tags).find(tag => tag.name === 'New').daq.restored, false);
        }
    });

    it('suppression survives failed connection retries and subsequent reconnects in this session', async function () {
        await apply();
        failConnect = true;
        connectResolve();
        await settle();
        active.checkStatus();
        failConnect = false;
        connectResolve();
        await settle();
        driver.connected = false;
        active.checkStatus();
        active.checkStatus();
        connectResolve();
        await settle();
        assert.equal(restoreReads, 0);
        assert.deepEqual(driver.writes, []);
    });

    it('a later ordinary device reload restores normally without persisting the suppression flag', async function () {
        await apply();
        connectResolve();
        await settle();
        await runtime.update('set-device', data);
        connectResolve();
        await settle();
        assert.deepEqual(driver.writes, [{ id: 'existing', value: false }]);
        assert.equal(Object.hasOwn(data, 'suppressRestore'), false);
    });

    it('invalidates a pre-reload asynchronous Restore lookup before its values can be written', async function () {
        let releaseRestore;
        restoreProvider = () => new Promise(resolve => { releaseRestore = resolve; });
        active.start();
        connectResolve();
        await settle();
        assert.equal(restoreReads, 1);
        await apply();
        releaseRestore([{ id: 'existing', value: false }]);
        connectResolve();
        await settle();
        assert.deepEqual(driver.writes, []);
    });

    it('ignores a pre-reload connection completion after the Generator session starts', async function () {
        active.start();
        const oldConnect = connectResolve;
        await apply();
        oldConnect();
        await settle();
        connectResolve();
        await settle();
        assert.equal(restoreReads, 0);
        assert.deepEqual(driver.writes, []);
    });
});
