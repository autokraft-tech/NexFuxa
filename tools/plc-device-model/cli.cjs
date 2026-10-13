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

function pathIdentity(file) {
    const resolved = path.resolve(file);
    const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved)
        : path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved));
    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    return { path: process.platform === 'win32' ? canonical.toLowerCase() : canonical, stat };
}

function checkPaths(paths) {
    const entries = Object.entries(paths).filter(([, file]) => file).map(([name, file]) => [name, pathIdentity(file)]);
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const [left, a] = entries[i], [right, b] = entries[j];
            if (a.path === b.path || (a.stat && b.stat && a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino)) {
                throw new Error(`${left} and ${right} refer to the same file`);
            }
        }
    }
}

function checkOutput(file, overwrite) {
    if (fs.existsSync(file)) {
        if (!fs.statSync(file).isFile()) throw new Error(`Output path is not a file: ${file}`);
        if (!overwrite) throw new Error(`Output already exists: ${file}; pass --overwrite to replace it`);
    }
}

function stageFile(file, content) {
    const temporary = path.join(path.dirname(path.resolve(file)), `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
    } catch (error) {
        fs.closeSync(fd);
        fs.unlinkSync(temporary);
        throw error;
    }
    fs.closeSync(fd);
    return temporary;
}

function publishFile(temporary, file, overwrite) {
    if (overwrite) fs.renameSync(temporary, file);
    else fs.linkSync(temporary, file); // Exclusive destination creation; cannot race into overwriting a file.
}

function run(args) {
    const input = option(args, '--input');
    const config = option(args, '--config');
    const output = option(args, '--output');
    const reportPath = option(args, '--report');
    const dryRun = args.includes('--dry-run');
    const overwrite = args.includes('--overwrite');
    if (!input || !config || !reportPath || (!dryRun && !output)) {
        throw new Error('Usage: node cli.cjs --input fuxa-devices.json --config instances.csv --report changes.md [--output merged-devices.json | --dry-run] [--overwrite]');
    }
    checkPaths({ input, config, output, report: reportPath });
    checkOutput(reportPath, overwrite);
    if (!dryRun) checkOutput(output, overwrite);
    const model = require('./models/valve.v1.json');
    const devices = JSON.parse(fs.readFileSync(input, 'utf8'));
    const candidates = expand(model, parseCsv(fs.readFileSync(config, 'utf8')));
    const result = mergeDevices(devices, candidates, () => `t_${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`);
    const staged = [];
    try {
        const reportTemporary = stageFile(reportPath, reportMarkdown(result.report));
        staged.push(reportTemporary);
        let outputTemporary;
        if (!dryRun && !result.report.conflicts.length) {
            outputTemporary = stageFile(output, JSON.stringify(result.devices, null, 2) + '\n');
            staged.push(outputTemporary);
        }
        publishFile(reportTemporary, reportPath, overwrite);
        if (outputTemporary) publishFile(outputTemporary, output, overwrite);
    } finally {
        for (const temporary of staged) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
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
