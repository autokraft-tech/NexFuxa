'use strict';

const express = require('express');
const authJwt = require('../jwt-helper');
const { createManager } = require('./manager');

function app(runtime, secure, checkGroups) {
    const router = express.Router();
    const manager = createManager(runtime.project, (cmd, device, options) => runtime.update(cmd, device, options));
    router.use('/api/plc-device-models', secure, (req, res, next) => {
        if (!authJwt.haveAdminPermission(checkGroups(req))) {
            return res.status(401).json({ error: 'unauthorized_error', message: 'Administrator permission required' });
        }
        if (req.method === 'POST' && Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > 100000) {
            return res.status(413).json({ error: 'request_too_large', message: 'Request exceeds 100 KB' });
        }
        next();
    });
    const owner = req => String(req.userId || '');
    const expectedHash = req => {
        if (typeof req.body?.expectedHash !== 'string') {
            const error = new Error('Expected project version is required');
            error.code = 'invalid_input';
            throw error;
        }
        return req.body.expectedHash;
    };
    const handle = (res, action) => Promise.resolve().then(action).then(data =>
        res.status(data?.runtime?.status === 'failed' ? 207 : 200).json(data)).catch(error => {
        const status = error?.code === 'stale_preview' || error?.code === 'tag_conflict' ? 409 :
            error?.code === 'invalid_input' ? 400 : 500;
        res.status(status).json({ error: error?.code || 'storage_error', message: error?.message || 'Project operation failed' });
    });
    router.get('/api/plc-device-models', (req, res) => handle(res, () => manager.catalog()));
    router.get('/api/plc-device-models/models', (req, res) => handle(res, () => manager.models()));
    router.post('/api/plc-device-models/models', (req, res) => handle(res, () => manager.saveModels(req.body?.models, expectedHash(req))));
    router.get('/api/plc-device-models/configurations', (req, res) => handle(res, () => manager.configurations()));
    router.get('/api/plc-device-models/legacy-configurations', (req, res) => handle(res, () => manager.legacyConfigurations()));
    router.post('/api/plc-device-models/configurations', (req, res) => handle(res, () => manager.saveConfigurations(req.body?.configurations, expectedHash(req))));
    router.get('/api/plc-device-models/instances', (req, res) => handle(res, () => ({ rows: manager.instances() })));
    router.post('/api/plc-device-models/instances', (req, res) => handle(res, () => manager.saveInstances(req.body?.rows)));
    router.post('/api/plc-device-models/csv', (req, res) => handle(res, () => ({ rows: manager.parseCsv(req.body?.csv) })));
    router.post('/api/plc-device-models/preview', (req, res) => handle(res, () =>
        req.body?.configurationIds !== undefined ? manager.previewConfigurations(req.body.configurationIds, owner(req), req.body.expectedHash) :
            manager.preview(req.body?.rows, owner(req))));
    router.post('/api/plc-device-models/apply', (req, res) => handle(res, () => {
        if (req.body?.confirmed !== true || typeof req.body?.token !== 'string') {
            const error = new Error('Explicit confirmation required');
            error.code = 'invalid_input';
            throw error;
        }
        return manager.apply(req.body.token, owner(req));
    }));
    return router;
}

module.exports = { app };
