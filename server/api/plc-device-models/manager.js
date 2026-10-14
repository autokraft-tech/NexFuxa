'use strict';

const crypto = require('crypto');
const model = require('../../../tools/plc-device-model/models/valve.v1.json');
const { expand, flatten } = require('../../../tools/plc-device-model/model.cjs');
const { mergeDevices } = require('../../../tools/plc-device-model/fuxa.cjs');
const { parseCsv, columns } = require('../../../tools/plc-device-model/csv.cjs');

const leaves = flatten(model);
const plcTypes = new Map(leaves.map(leaf => [leaf.path, leaf.plcType]));
const previews = new Map();
const maxRows = 100;

function invalid(message, code = 'invalid_input') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validateRows(rows, project, singleDevice = true) {
    if (!Array.isArray(rows) || (singleDevice && !rows.length) || rows.length > maxRows) throw invalid(`Provide ${singleDevice ? '1–' : '0–'}${maxRows} instances`);
    const ids = new Set();
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row) ||
            Object.keys(row).some(key => !columns.includes(key)) ||
            columns.some(key => typeof row[key] !== 'string' || row[key].length > 256)) {
            throw invalid('Invalid instance fields');
        }
        const id = row['PLC Device ID'];
        if (!project.getDevices()[id] || project.getDevices()[id].type !== 'ADSclient') throw invalid(`Unknown ADS device ID: ${id}`);
        ids.add(id);
    }
    if (singleDevice && ids.size !== 1) throw invalid('One Apply batch must use one ADS device. Preview each ADS device separately.');
    let candidates;
    try { candidates = expand(model, rows); }
    catch (error) { throw invalid(error.message); }
    return { candidates, deviceId: [...ids][0] };
}

function merge(project, target, candidates) {
    const used = new Set(Object.values(project.getDevices()).flatMap(device => Object.keys(device.tags || {})));
    const newId = () => {
        let id;
        do { id = `t_${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`; }
        while (used.has(id));
        used.add(id);
        return id;
    };
    return mergeDevices([target], candidates, newId);
}

function reportRows(candidates, report) {
    return candidates.map(candidate => {
        const match = item => item.name === candidate.name && item.address === candidate.address && item.deviceId === candidate.deviceId;
        const conflict = report.conflicts.find(match);
        const reused = report.reused.find(match);
        const path = candidate.address.slice(candidate.address.lastIndexOf('].') + 2);
        return {
            name: candidate.name, address: candidate.address, plcType: plcTypes.get(path),
            type: candidate.type, deviceId: candidate.deviceId,
            operation: conflict ? 'Conflict' : reused ? 'Reused' : 'Created',
            existingName: reused?.existingName || null,
            reason: conflict?.reason || null
        };
    });
}

function createManager(project, update) {
    return {
        catalog() {
            return [{ name: model.name, version: model.version, rootType: model.rootType,
                profiles: ['Full', ...Object.keys(model.profiles)], leaves }];
        },
        instances() { return project.getModelInstances(); },
        async saveInstances(rows) {
            validateRows(rows, project, false);
            await project.saveModelInstances(rows);
            return { rows: project.getModelInstances() };
        },
        parseCsv(input) {
            if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 65536) throw invalid('CSV exceeds 64 KB');
            let rows;
            try { rows = parseCsv(input); }
            catch (error) { throw invalid(error.message); }
            validateRows(rows, project, false);
            return rows.map(row => ({ ...row, 'Device Model': `${model.name}@${model.version}`,
                Profile: row.Profile || 'Full' }));
        },
        preview(rows, owner) {
            const { candidates, deviceId } = validateRows(rows, project);
            const result = merge(project, project.getDevices()[deviceId], candidates);
            const token = crypto.randomBytes(24).toString('hex');
            if (previews.size >= 100) previews.delete(previews.keys().next().value);
            previews.set(token, { owner, rows: JSON.parse(JSON.stringify(rows)),
                hash: project.getDevicesHash(), expires: Date.now() + 10 * 60 * 1000 });
            return { token, rows: reportRows(candidates, result.report),
                summary: { candidates: candidates.length, created: result.report.created.length,
                    reused: result.report.reused.length, conflicts: result.report.conflicts.length,
                    unchanged: result.report.unchanged.length } };
        },
        async apply(token, owner) {
            const preview = previews.get(token);
            if (!preview || preview.owner !== owner || preview.expires < Date.now()) throw invalid('Preview expired. Preview again.', 'stale_preview');
            previews.delete(token);
            const { candidates, deviceId } = validateRows(preview.rows, project);
            const result = await project.commitDeviceTags(deviceId, preview.hash, current => {
                // Revalidate every candidate against the current server-side device.
                const merged = merge(project, current, candidates);
                if (merged.report.conflicts.length) throw invalid('Tag conflicts. Preview again.', 'tag_conflict');
                return { device: merged.devices[0], report: merged.report };
            });
            await update('set-device', result.device);
            return { created: result.report.created.length, reused: result.report.reused.length };
        }
    };
}

module.exports = { createManager };
