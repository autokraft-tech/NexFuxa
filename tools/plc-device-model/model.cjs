'use strict';

const plcToAds = { BOOL: 'boolean', LREAL: 'number', UDINT: 'number', STRING: 'string' };

function flatten(model) {
    const leaves = [];
    function walk(type, path, active) {
        if (active.includes(type)) throw new Error(`Cyclic PLC structure reference at ${path || model.rootType}: ${[...active, type].join(' -> ')}`);
        const members = model.types[type];
        if (!members || typeof members !== 'object' || Array.isArray(members)) throw new Error(`Unknown PLC structure ${type}`);
        for (const [member, childType] of Object.entries(members)) {
            const memberPath = path ? `${path}.${member}` : member;
            if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(member) || typeof childType !== 'string') throw new Error(`Invalid PLC member definition at ${memberPath}`);
            if (Object.hasOwn(model.types, childType)) walk(childType, memberPath, [...active, type]);
            else {
                const adsType = Object.hasOwn(plcToAds, childType) ? plcToAds[childType] : null;
                if (!adsType) throw new Error(`Unsupported PLC primitive ${childType} at ${memberPath}`);
                leaves.push({ path: memberPath, plcType: childType, type: adsType });
            }
        }
    }
    walk(model.rootType, '', []);
    return leaves;
}

function leafType(model, path) {
    const leaf = flatten(model).find(item => item.path === path);
    if (!leaf) throw new Error(`Unknown PLC leaf ${path}`);
    return leaf.plcType;
}

function snakeCase(path) {
    return path.split('.').map(member => member
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()).join('_');
}

function expand(model, rows) {
    if (model.schemaVersion !== 1) throw new Error(`Unsupported model schema version ${model.schemaVersion}`);
    const leaves = flatten(model);
    const byPath = new Map(leaves.map(leaf => [leaf.path, leaf]));
    const instances = new Set();
    const names = new Set();
    return rows.flatMap(row => {
        const name = row['Device Name'];
        const deviceId = row['PLC Device ID'];
        const symbol = row['Array Symbol'];
        const indices = row['Array Indices'].split(',').map(value => value.trim());
        const profile = row.Profile || 'Full';
        if (row['Device Model'] !== model.name && row['Device Model'] !== `${model.name}@${model.version}`) throw new Error(`Unknown device model ${row['Device Model']}`);
        if (!/^[A-Za-z_][\w]*$/.test(name)) throw new Error(`Invalid Device Name: ${name}`);
        if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(symbol)) throw new Error(`Invalid Array Symbol: ${symbol}`);
        if (!deviceId || deviceId.trim() !== deviceId) throw new Error(`Invalid PLC Device ID for ${name}`);
        if (!indices.length || indices.some(value => !/^(0|[1-9]\d*)$/.test(value))) throw new Error(`Invalid array indices for ${name}`);
        if (profile !== 'Full' && !Object.hasOwn(model.profiles, profile)) throw new Error(`Unknown profile ${profile}`);
        if (instances.has(name)) throw new Error(`Duplicate or ambiguous Device Name: ${name}`);
        instances.add(name);
        const selected = profile === 'Full' ? leaves : model.profiles[profile].map(path => {
            const leaf = byPath.get(path);
            if (!leaf) throw new Error(`Unknown PLC leaf ${path} in profile ${profile}`);
            return leaf;
        });
        return selected.map(({ path, plcType, type }) => {
            const tagName = `${name}_${snakeCase(path)}`;
            if (names.has(tagName)) throw new Error(`Duplicate generated Tag Name ${tagName}`);
            names.add(tagName);
            return {
                deviceId,
                name: tagName,
                address: `${symbol}[${indices.join(',')}].${path}`,
                type,
                description: `${model.name} ${model.version}: ${path} (${plcType})`
            };
        });
    });
}

module.exports = { expand, flatten, leafType, plcToAds };
