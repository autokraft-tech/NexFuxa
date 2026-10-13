#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { parseCsv } = require('./csv.cjs');
const { expand } = require('./model.cjs');
const { mergeDevices } = require('./fuxa.cjs');

function reportMarkdown(report) {
    const sections = [
        ['Reused Tags', report.reused], ['Newly created Tags', report.created],
        ['Conflicts', report.conflicts], ['Unchanged Tags', report.unchanged]
    ];
    return '# Phase 3A tag change report\n\n' + sections.map(([heading, entries]) =>
        `## ${heading} (${entries.length})\n\n` + (entries.length
            ? entries.map(entry => {
                const detail = [entry.reason, entry.existingType && `existing type: ${entry.existingType}`,
                    entry.existingIds && `existing IDs: ${entry.existingIds.join(', ')}`,
                    entry.existingName && entry.existingName !== entry.name && `existing name: ${entry.existingName}`].filter(Boolean);
                return `- ${entry.deviceId} | ${entry.name} | ${entry.address || '—'} | ${entry.id || entry.existingId || '—'}${detail.length ? ` | ${detail.join('; ')}` : ''}`;
            }).join('\n') + '\n'
            : 'None\n')
    ).join('\n');
}

function option(args, name) {
    const index = args.indexOf(name);
    return index < 0 ? null : args[index + 1];
}

function run(args) {
    const input = option(args, '--input');
    const config = option(args, '--config');
    const output = option(args, '--output');
    const reportPath = option(args, '--report');
    const dryRun = args.includes('--dry-run');
    if (!input || !config || !reportPath || (!dryRun && !output)) {
        throw new Error('Usage: node cli.cjs --input fuxa-devices.json --config instances.csv --report changes.md [--output merged-devices.json | --dry-run]');
    }
    if (output && path.resolve(input) === path.resolve(output)) throw new Error('Output path must differ from input export');
    const model = require('./models/valve.v1.json');
    const devices = JSON.parse(fs.readFileSync(input, 'utf8'));
    const candidates = expand(model, parseCsv(fs.readFileSync(config, 'utf8')));
    const result = mergeDevices(devices, candidates, () => `t_${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(reportPath, reportMarkdown(result.report));
    if (result.report.conflicts.length) {
        throw new Error(`${result.report.conflicts.length} conflict(s); see ${reportPath}. No devices JSON was written.`);
    }
    if (!dryRun) fs.writeFileSync(output, JSON.stringify(result.devices, null, 2) + '\n');
    return result.report;
}

if (require.main === module) {
    try {
        const report = run(process.argv.slice(2));
        process.stdout.write(`Reused ${report.reused.length}, created ${report.created.length}, unchanged ${report.unchanged.length}, conflicts ${report.conflicts.length}\n`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { run, reportMarkdown };
