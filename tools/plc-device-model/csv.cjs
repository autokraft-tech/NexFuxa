'use strict';

const columns = ['Device Name', 'PLC Device ID', 'Device Model', 'Array Symbol', 'Array Indices', 'Profile'];

function parseCsv(input) {
    const records = [];
    let row = [], field = '', quoted = false;
    const csv = input.replace(/^\uFEFF/, '');
    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (ch === '"') {
            if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
            else if (!quoted && field) throw new Error(`Unexpected quote on row ${records.length + 1}`);
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
            row.push(field); field = '';
        } else if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && csv[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(value => value.trim())) records.push(row);
            row = [];
        } else {
            field += ch;
        }
    }
    if (quoted) throw new Error('Unclosed quoted CSV field');
    if (field || row.length) { row.push(field); records.push(row); }
    const header = records.shift()?.map(value => value.trim());
    if (!header || columns.some((name, i) => header[i] !== name) || header.length !== columns.length) {
        throw new Error(`CSV header must be: ${columns.join(',')}`);
    }
    return records.map((values, index) => {
        if (values.length !== columns.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${columns.length}`);
        return Object.fromEntries(columns.map((name, i) => [name, values[i]]));
    });
}

module.exports = { parseCsv, columns };
