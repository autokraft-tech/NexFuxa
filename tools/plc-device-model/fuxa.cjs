'use strict';

function comparableAdsType(type) {
    return ['Boolean', 'Number', 'String'].includes(type) ? type.toLowerCase() : type;
}

function mergeDevices(devices, candidates, newId) {
    if (!Array.isArray(devices)) throw new Error('FUXA devices export must be a JSON array');
    const merged = JSON.parse(JSON.stringify(devices));
    const report = { reused: [], created: [], conflicts: [], unchanged: [] };
    const allIds = new Set();
    const deviceIds = new Set();
    for (const device of merged) {
        if (!device || !device.id || !device.tags || typeof device.tags !== 'object' || Array.isArray(device.tags)) throw new Error('Invalid FUXA device or tag dictionary');
        if (deviceIds.has(device.id)) throw new Error(`Duplicate device ID ${device.id}`);
        deviceIds.add(device.id);
        for (const [key, tag] of Object.entries(device.tags)) {
            if (key !== tag.id || allIds.has(key)) throw new Error(`Duplicate or inconsistent tag ID ${key}`);
            allIds.add(key);
        }
    }
    const touched = new Set();
    const requested = new Set();
    for (const candidate of candidates) {
        const device = merged.find(item => item.id === candidate.deviceId);
        const reference = { deviceId: candidate.deviceId, name: candidate.name, address: candidate.address, type: candidate.type };
        const requestKey = `${candidate.deviceId}\0${candidate.address}`;
        if (requested.has(requestKey)) {
            report.conflicts.push({ ...reference, reason: 'Duplicate requested address' });
            continue;
        }
        requested.add(requestKey);
        if (!device || device.type !== 'ADSclient') {
            report.conflicts.push({ ...reference, reason: 'PLC device ID does not identify an ADSclient device' });
            continue;
        }
        const tags = Object.values(device.tags);
        const atAddress = tags.filter(tag => tag.address === candidate.address);
        const atName = tags.filter(tag => tag.name === candidate.name);
        if (atAddress.length > 1) {
            report.conflicts.push({ ...reference, reason: 'Duplicate existing address', existingIds: atAddress.map(tag => tag.id) });
        } else if (atAddress.length === 1) {
            const tag = atAddress[0];
            if (comparableAdsType(tag.type) !== candidate.type) report.conflicts.push({ ...reference, reason: 'Type conflict', existingId: tag.id, existingType: tag.type });
            else if (atName.some(other => other.id !== tag.id)) report.conflicts.push({ ...reference, reason: 'Name conflict', existingIds: atName.map(other => other.id) });
            else { report.reused.push({ ...reference, id: tag.id, existingName: tag.name }); touched.add(tag.id); }
        } else if (atName.length) {
            report.conflicts.push({ ...reference, reason: 'Name conflict', existingIds: atName.map(tag => tag.id) });
        } else {
            let id;
            do { id = newId(); } while (allIds.has(id));
            if (!/^t_[a-f0-9]{8}-[a-f0-9]{8}$/.test(id)) throw new Error(`Invalid generated tag ID ${id}`);
            allIds.add(id);
            device.tags[id] = {
                id, name: candidate.name, type: candidate.type, address: candidate.address,
                daq: { enabled: false, interval: 60, changed: false, restored: false },
                description: candidate.description
            };
            report.created.push({ ...reference, id });
            touched.add(id);
        }
    }
    for (const device of merged) {
        for (const tag of Object.values(device.tags)) {
            if (!touched.has(tag.id)) report.unchanged.push({ deviceId: device.id, id: tag.id, name: tag.name, address: tag.address || null });
        }
    }
    return { devices: merged, report };
}

module.exports = { mergeDevices };
