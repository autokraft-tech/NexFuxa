'use strict';

const plcToAds = { BOOL: 'boolean', LREAL: 'number', UDINT: 'number', STRING: 'string' };

function leafType(model, path) {
    let type = model.rootType;
    for (const member of path.split('.')) {
        type = model.types[type]?.[member];
        if (!type) throw new Error(`Unknown PLC member ${path}`);
    }
    if (model.types[type]) throw new Error(`Profile member ${path} is a structure`);
    return type;
}

function expand(model, rows) {
    if (model.schemaVersion !== 1) throw new Error(`Unsupported model schema version ${model.schemaVersion}`);
    const instances = new Set();
    return rows.flatMap(row => {
        const name = row['Device Name'];
        const deviceId = row['PLC Device ID'];
        const symbol = row['Array Symbol'];
        const indices = row['Array Indices'].split(',').map(value => value.trim());
        const profile = row.Profile || 'Status';
        if (row['Device Model'] !== model.name && row['Device Model'] !== `${model.name}@${model.version}`) throw new Error(`Unknown device model ${row['Device Model']}`);
        if (!/^[A-Za-z_][\w]*$/.test(name)) throw new Error(`Invalid Device Name: ${name}`);
        if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(symbol)) throw new Error(`Invalid Array Symbol: ${symbol}`);
        if (!deviceId || deviceId.trim() !== deviceId) throw new Error(`Invalid PLC Device ID for ${name}`);
        if (!indices.length || indices.some(value => !/^(0|[1-9]\d*)$/.test(value))) throw new Error(`Invalid array indices for ${name}`);
        if (!model.profiles[profile]) throw new Error(`Unknown profile ${profile}`);
        if (instances.has(name)) throw new Error(`Duplicate or ambiguous Device Name: ${name}`);
        instances.add(name);
        if (new Set(model.profiles[profile]).size !== model.profiles[profile].length) throw new Error(`Duplicate member in profile ${profile}`);
        return model.profiles[profile].map(path => {
            const plcType = leafType(model, path);
            const type = plcToAds[plcType];
            if (!type) throw new Error(`Unsupported PLC primitive ${plcType} at ${path}`);
            return {
                deviceId,
                name: `${name}_${path.replace(/\./g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`,
                address: `${symbol}[${indices.join(',')}].${path}`,
                type,
                description: `${model.name} ${model.version}: ${path} (${plcType})`
            };
        });
    });
}

module.exports = { expand, leafType, plcToAds };
