'use strict';

const crypto = require('crypto');
const model = require('../../../tools/plc-device-model/models/valve.v1.json');
const { expand, flatten } = require('../../../tools/plc-device-model/model.cjs');
const { mergeDevices } = require('../../../tools/plc-device-model/fuxa.cjs');
const { parseCsv, columns } = require('../../../tools/plc-device-model/csv.cjs');
const generator = require('../../../tools/plc-device-model/generator.cjs');

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
    if (singleDevice && candidates.length > generator.maxTags) throw invalid('Tag generation exceeds 500 candidates');
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

function reportRows(candidates, report, target) {
    return candidates.map(candidate => {
        const match = item => item.name === candidate.name && item.address === candidate.address && item.deviceId === candidate.deviceId;
        const conflict = report.conflicts.find(match);
        const reused = report.reused.find(match);
        const actual = reused ? target?.tags?.[reused.id] : candidate;
        const path = candidate.address.slice(candidate.address.lastIndexOf('].') + 2);
        return {
            name: candidate.name, address: candidate.address, plcType: candidate.plcType || plcTypes.get(path),
            actualName: reused ? actual?.name : candidate.name,
            actualType: reused ? actual?.type : candidate.type,
            type: candidate.type, deviceId: candidate.deviceId,
            sourceConfiguration: candidate.sourceConfiguration || null,
            model: candidate.model || null,
            propertiesScope: reused ? 'Existing properties preserved' : 'New Tag properties',
            ...Object.fromEntries(['daq', 'description', 'format', 'scale', 'scaleReadFunction', 'scaleWriteFunction', 'unsPath']
                .filter(key => Object.hasOwn(actual || {}, key)).map(key => [key, actual[key]])),
            operation: conflict ? 'Conflict' : reused ? 'Reused' : 'Created',
            existingName: reused?.existingName || null,
            reason: conflict?.reason || null
        };
    });
}

function generatorModels(project) {
    return [model, ...(project.getTagGeneratorModels?.() || [])];
}

function requireSavedConfigurations(configurations, project) {
    const saved = new Map((project.getTagGeneratorConfigurations?.() || []).map(item => [item.id, item]));
    for (const configuration of configurations) {
        if (JSON.stringify(saved.get(configuration.id)) !== JSON.stringify(configuration)) {
            throw invalid('Generator configuration changed. Save and Preview again.', 'stale_preview');
        }
    }
}

function generateConfigurations(configurations, project) {
    if (!Array.isArray(configurations) || !configurations.length || configurations.length > maxRows) {
        throw invalid(`Provide 1–${maxRows} saved configurations`);
    }
    const candidates = [];
    const ids = new Set();
    for (const configuration of configurations) {
        try { candidates.push(...generator.generate(configuration, generatorModels(project), project.getDevices())); }
        catch (error) { throw invalid(error.message); }
        ids.add(configuration.deviceId);
        if (candidates.length > generator.maxTags) throw invalid('Tag generation exceeds 500 candidates');
    }
    if (ids.size !== 1) throw invalid('One Apply batch must use one ADS device.');
    return { candidates, deviceId: [...ids][0] };
}

function requireSavedRows(rows, project) {
    const saved = new Map();
    const key = row => JSON.stringify(columns.map(column => row[column]));
    for (const row of project.getModelInstances()) {
        const value = key(row);
        saved.set(value, (saved.get(value) || 0) + 1);
    }
    for (const row of rows) {
        const value = key(row);
        if (!saved.get(value)) throw invalid('Instance configuration is not saved. Save and Preview again.', 'stale_preview');
        saved.set(value, saved.get(value) - 1);
    }
}

function createManager(project, update) {
    return {
        catalog() {
            return generatorModels(project).map(item => ({ name: item.name, version: item.version,
                rootType: item.rootType, types: item.types, profileDefinitions: item.profiles, memberDefaults: item.memberDefaults || {},
                readOnly: item.schemaVersion === 1,
                profiles: ['Full', ...Object.keys(item.profiles || {})],
                leaves: item.schemaVersion === 1 ? leaves : generator.flattenGeneric(item) }));
        },
        models() { return { schemaVersion: 2, models: project.getTagGeneratorModels?.() || [], hash: project.getDevicesHash() }; },
        async saveModels(input, expectedHash) {
            if (!Array.isArray(input) || input.length > 100) throw invalid('Provide at most 100 custom models');
            const hash = project.getDevicesHash();
            if (expectedHash !== undefined && expectedHash !== hash) throw invalid('Structure models changed. Reload and save again.', 'stale_preview');
            const previous = project.getTagGeneratorModels?.() || [];
            let next;
            try { next = input.map(generator.validateModel); }
            catch (error) { throw invalid(error.message); }
            const keys = next.map(item => `${item.name}@${item.version}`);
            if (new Set(keys).size !== keys.length || keys.includes('Valve@1.0.0')) throw invalid('Duplicate or built-in model version');
            for (const item of previous) {
                const saved = next.find(entry => entry.name === item.name && entry.version === item.version);
                if (saved && JSON.stringify(saved) !== JSON.stringify(item)) throw invalid(`Model ${item.name}@${item.version} is immutable; save a new version`);
                if (!saved && (project.getTagGeneratorConfigurations?.() || []).some(config => config.model === `${item.name}@${item.version}`)) {
                    const references = project.getTagGeneratorConfigurations().filter(config => config.model === `${item.name}@${item.version}`).map(config => config.name);
                    throw invalid(`Model ${item.name}@${item.version} is referenced by: ${references.join(', ')}`);
                }
            }
            await project.saveTagGeneratorModels(next, hash);
            return this.models();
        },
        configurations() { return { schemaVersion: 2, configurations: project.getTagGeneratorConfigurations?.() || [], hash: project.getDevicesHash() }; },
        legacyConfigurations() {
            const rows = project.getModelInstances();
            validateRows(rows, project, false);
            const existing = project.getTagGeneratorConfigurations?.() || [];
            const configurations = rows.map(row => {
                const source = crypto.createHash('sha256').update(JSON.stringify(columns.map(key => row[key]))).digest('hex').slice(0, 24);
                return { schemaVersion: 2, id: 'legacy_' + source, legacySource: source,
                    name: row['Device Name'], deviceId: row['PLC Device ID'], tagPrefix: row['Device Name'],
                    adsSymbol: row['Array Symbol'], valueKind: 'structure', model: 'Valve@1.0.0',
                    profile: row.Profile || 'Full', array: { mode: 'element', indices: row['Array Indices'].split(',').map(Number) },
                    namingTemplate: '{prefix}_{member}' };
            }).filter(config => !existing.some(saved => saved.id === config.id || saved.legacySource === config.legacySource));
            for (const configuration of configurations) {
                try { generator.generate(configuration, generatorModels(project), project.getDevices()); }
                catch (error) { throw invalid(error.message); }
            }
            return { schemaVersion: 2, configurations, hash: project.getDevicesHash() };
        },
        async saveConfigurations(input, expectedHash) {
            if (!Array.isArray(input) || input.length > maxRows) throw invalid(`Provide at most ${maxRows} configurations`);
            const hash = project.getDevicesHash();
            if (expectedHash !== undefined && expectedHash !== hash) throw invalid('Generator configurations changed. Reload and save again.', 'stale_preview');
            const ids = new Set();
            for (const configuration of input) {
                try { generator.generate(configuration, generatorModels(project), project.getDevices()); }
                catch (error) { throw invalid(error.message); }
                if (ids.has(configuration.id)) throw invalid(`Duplicate configuration ID ${configuration.id}`);
                ids.add(configuration.id);
            }
            await project.saveTagGeneratorConfigurations(input, hash);
            return this.configurations();
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
            requireSavedRows(rows, project);
            const result = merge(project, project.getDevices()[deviceId], candidates);
            const token = crypto.randomBytes(24).toString('hex');
            if (previews.size >= 100) previews.delete(previews.keys().next().value);
            previews.set(token, { owner, rows: JSON.parse(JSON.stringify(rows)),
                hash: project.getDevicesHash(), expires: Date.now() + 10 * 60 * 1000 });
            return { token, rows: reportRows(candidates, result.report, project.getDevices()[deviceId]),
                summary: { candidates: candidates.length, created: result.report.created.length,
                    reused: result.report.reused.length, conflicts: result.report.conflicts.length,
                    unchanged: result.report.unchanged.length } };
        },
        previewConfigurations(configurationIds, owner, expectedHash) {
            if (typeof expectedHash !== 'string' || expectedHash !== project.getDevicesHash()) {
                throw invalid('Project or saved configurations changed. Reload and Preview again.', 'stale_preview');
            }
            if (!Array.isArray(configurationIds) || !configurationIds.length || configurationIds.length > maxRows ||
                configurationIds.some(id => typeof id !== 'string') || new Set(configurationIds).size !== configurationIds.length) {
                throw invalid('Select unique saved configurations');
            }
            const saved = new Map((project.getTagGeneratorConfigurations?.() || []).map(item => [item.id, item]));
            const configurations = configurationIds.map(id => {
                const item = saved.get(id);
                if (!item) throw invalid(`Configuration ${id} is not saved`, 'stale_preview');
                return item;
            });
            const { candidates, deviceId } = generateConfigurations(configurations, project);
            const result = merge(project, project.getDevices()[deviceId], candidates);
            const token = crypto.randomBytes(24).toString('hex');
            if (previews.size >= 100) previews.delete(previews.keys().next().value);
            previews.set(token, { owner, configurations: JSON.parse(JSON.stringify(configurations)),
                hash: project.getDevicesHash(), expires: Date.now() + 10 * 60 * 1000 });
            return { token, rows: reportRows(candidates, result.report, project.getDevices()[deviceId]),
                summary: { candidates: candidates.length, created: result.report.created.length,
                    reused: result.report.reused.length, conflicts: result.report.conflicts.length,
                    unchanged: result.report.unchanged.length } };
        },
        async apply(token, owner) {
            const preview = previews.get(token);
            if (!preview || preview.owner !== owner || preview.expires < Date.now()) throw invalid('Preview expired. Preview again.', 'stale_preview');
            previews.delete(token);
            const generated = preview.configurations ? generateConfigurations(preview.configurations, project) :
                validateRows(preview.rows, project);
            const { candidates, deviceId } = generated;
            const result = await project.commitDeviceTags(deviceId, preview.hash, current => {
                if (preview.configurations) requireSavedConfigurations(preview.configurations, project);
                else requireSavedRows(preview.rows, project);
                // Revalidate every candidate against the current server-side device.
                const merged = merge(project, current, candidates);
                if (merged.report.conflicts.length) throw invalid('Tag conflicts. Preview again.', 'tag_conflict');
                return { device: merged.devices[0], report: merged.report };
            });
            const response = { created: result.report.created.length, reused: result.report.reused.length,
                persistence: 'committed', runtime: { status: 'updated' } };
            try {
                await update('set-device', result.device, { suppressRestore: true });
            } catch (error) {
                response.runtime = { status: 'failed', message: error?.message || String(error) };
            }
            return response;
        }
    };
}

module.exports = { createManager };
