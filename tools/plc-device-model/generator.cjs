'use strict';

const { flatten } = require('./model.cjs');

// ADSclient reads each generated symbol separately. These are declared PLC types;
// neither Preview nor Apply checks the symbol table of a connected PLC.
const primitiveTypes = Object.freeze({
    BOOL: 'boolean', INT: 'number', DINT: 'number', UINT: 'number',
    UDINT: 'number', REAL: 'number', LREAL: 'number', STRING: 'string'
});
const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
const symbol = /^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*$/;
const version = /^\d+\.\d+\.\d+$/;
const maxTags = 500;

function fail(message) { throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function snake(path) {
    return path.split('.').map(part => part.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()).join('_');
}

function flattenGeneric(model) {
    const leaves = [];
    function walk(type, path, active) {
        if (active.includes(type)) fail(`Cyclic PLC structure reference at ${path || type}`);
        const members = model.types[type];
        if (!members) fail(`Unknown PLC structure ${type}`);
        for (const [name, child] of Object.entries(members)) {
            const memberPath = path ? `${path}.${name}` : name;
            if (Object.hasOwn(model.types, child)) walk(child, memberPath, [...active, type]);
            else leaves.push({ path: memberPath, plcType: child, type: primitiveTypes[child] });
            if (leaves.length > maxTags) fail('Structure model exceeds 500 leaves');
        }
    }
    walk(model.rootType, '', []);
    return leaves;
}

function validateModel(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 2 ||
        !identifier.test(input.name || '') || !version.test(input.version || '') ||
        !identifier.test(input.rootType || '') || !input.types || typeof input.types !== 'object' ||
        Array.isArray(input.types) || !Object.keys(input.types).length || Object.keys(input.types).length > 100) fail('Invalid structure model');
    for (const [type, members] of Object.entries(input.types)) {
        if (!identifier.test(type) || !members || typeof members !== 'object' || Array.isArray(members) ||
            !Object.keys(members).length || Object.keys(members).length > 100) fail(`Invalid structure ${type}`);
        for (const [member, child] of Object.entries(members)) {
            if (!identifier.test(member) || typeof child !== 'string' ||
                (!Object.hasOwn(input.types, child) && !Object.hasOwn(primitiveTypes, child))) fail(`Unsupported member ${type}.${member}: ${child}`);
        }
    }
    const leaves = flattenGeneric(input);
    if (!leaves.length || leaves.length > maxTags) fail('Structure model must contain 1–500 primitive leaves');
    const paths = new Set(leaves.map(leaf => leaf.path));
    if (input.profiles !== undefined) {
        if (!input.profiles || typeof input.profiles !== 'object' || Array.isArray(input.profiles)) fail('Invalid profiles');
        for (const [name, selected] of Object.entries(input.profiles)) {
            if (!identifier.test(name) || name === 'Full' || !Array.isArray(selected) || !selected.length ||
                selected.some(path => !paths.has(path)) || new Set(selected).size !== selected.length) fail(`Invalid profile ${name}`);
        }
    }
    return { schemaVersion: 2, name: input.name, version: input.version, rootType: input.rootType,
        types: clone(input.types), profiles: clone(input.profiles || {}) };
}

function indicesFor(array) {
    if (!array || typeof array !== 'object' || Array.isArray(array)) fail('Array configuration required');
    if (array.mode === 'scalar') return [[]];
    if (array.mode === 'element') {
        if (!Array.isArray(array.indices) || array.indices.length < 1 || array.indices.length > 2 ||
            array.indices.some(value => !Number.isSafeInteger(value))) fail('One or two integer element indices required');
        return [array.indices];
    }
    if (array.mode !== 'range' || !Array.isArray(array.dimensions) ||
        array.dimensions.length < 1 || array.dimensions.length > 2) fail('One or two array dimensions required');
    let result = [[]];
    for (const dimension of array.dimensions) {
        const { start, end, step } = dimension || {};
        if (![start, end, step].every(Number.isSafeInteger) || !step ||
            (end - start) * step < 0) fail('Invalid array range or step');
        const count = Math.floor(Math.abs(end - start) / Math.abs(step)) + 1;
        if (count > maxTags || result.length * count > maxTags) fail('Array expansion exceeds 500 elements');
        result = result.flatMap(indices => Array.from({ length: count }, (_, i) => [...indices, start + i * step]));
    }
    return result;
}

function validateConfiguration(input, models, devices) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 2 ||
        !identifier.test(input.id || '') || input.id.length > 100 ||
        typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 ||
        !identifier.test(input.tagPrefix || '') || input.tagPrefix.length > 100 ||
        !symbol.test(input.adsSymbol || '') || input.adsSymbol.length > 256 ||
        typeof input.deviceId !== 'string' || input.deviceId.length > 128 ||
        devices[input.deviceId]?.type !== 'ADSclient') fail('Invalid generator configuration or ADS device');
    if (input.valueKind !== 'primitive' && input.valueKind !== 'structure') fail('Invalid value kind');
    const indexes = indicesFor(input.array);
    let model;
    let leaves;
    if (input.valueKind === 'primitive') {
        if (!Object.hasOwn(primitiveTypes, input.plcType)) fail(`Unsupported PLC primitive ${input.plcType}`);
        leaves = [{ path: '', plcType: input.plcType, type: primitiveTypes[input.plcType] }];
    } else {
        model = models.find(item => `${item.name}@${item.version}` === input.model);
        if (!model) fail(`Unknown structure model ${input.model}`);
        // The bundled v1 model retains its established flatten() contract.
        leaves = model.schemaVersion === 1 ? flatten(model) : flattenGeneric(model);
        const byPath = new Map(leaves.map(leaf => [leaf.path, leaf]));
        const profile = input.profile || 'Full';
        if (profile !== 'Full') {
            if (!Array.isArray(model.profiles?.[profile])) fail(`Unknown profile ${profile}`);
            leaves = model.profiles[profile].map(path => byPath.get(path));
            if (leaves.some(leaf => !leaf)) fail(`Invalid profile ${profile}`);
        }
        if (input.memberPaths !== undefined) {
            if (!Array.isArray(input.memberPaths) || !input.memberPaths.length ||
                new Set(input.memberPaths).size !== input.memberPaths.length ||
                input.memberPaths.some(path => !byPath.has(path))) fail('Invalid selected structure members');
            const selected = new Set(input.memberPaths);
            leaves = leaves.filter(leaf => selected.has(leaf.path));
            if (!leaves.length) fail('No structure members selected');
        }
    }
    if (input.namingTemplate !== undefined && (typeof input.namingTemplate !== 'string' ||
        !input.namingTemplate.length || input.namingTemplate.length > 128 ||
        input.namingTemplate.replace(/\{(?:prefix|index|member)\}/g, '').includes('{') ||
        input.namingTemplate.replace(/\{(?:prefix|index|member)\}/g, '').includes('}'))) fail('Invalid naming template fields');
    if (indexes.length * leaves.length > maxTags) fail('Tag generation exceeds 500 candidates');
    return { indexes, leaves, model };
}

function generate(input, models, devices) {
    const { indexes, leaves, model } = validateConfiguration(input, models, devices);
    const names = new Set();
    const candidates = [];
    for (const indices of indexes) for (const leaf of leaves) {
        const index = indices.join('_');
        const member = snake(leaf.path);
        const defaultName = [input.tagPrefix, index, member].filter(Boolean).join('_');
        const name = input.namingTemplate ? input.namingTemplate.replace(/\{(prefix|index|member)\}/g,
            (_, field) => ({ prefix: input.tagPrefix, index, member })[field]) : defaultName;
        if (!identifier.test(name) || name.length > 128 || names.has(name)) fail(`Invalid or duplicate generated Tag name: ${name}`);
        names.add(name);
        const address = input.adsSymbol + (indices.length ? `[${indices.join(',')}]` : '') + (leaf.path ? `.${leaf.path}` : '');
        candidates.push({ deviceId: input.deviceId, name, address, type: leaf.type,
            plcType: leaf.plcType, sourceConfiguration: input.name,
            description: `${model ? `${model.name}@${model.version}` : leaf.plcType}: ${leaf.path || input.adsSymbol}` });
    }
    return candidates;
}

module.exports = { primitiveTypes, maxTags, flattenGeneric, validateModel, validateConfiguration, indicesFor, generate };
