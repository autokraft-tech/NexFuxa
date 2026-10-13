const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('NexPlc Valve widget', () => {
    const svg = fs.readFileSync(path.resolve(__dirname, '../../_widgets/NexPlc/Valve.svg'), 'utf8');
    const script = svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)?.[1];

    it('exports one Boolean input and no write handler', () => {
        assert.match(script, /\/\/!export-start\s+let _pb_extended = false;\s+\/\/!export-end/);
        assert.doesNotMatch(script, /postValue\s*\(/);
    });

    it('distinguishes extended, not extended, and unavailable feedback', () => {
        const elements = {
            nex_valve_indicator: { fill: '', setAttribute(name, value) { this[name] = value; } },
            nex_valve_status: { textContent: '' }
        };
        const context = { document: { getElementById: id => elements[id] } };
        vm.createContext(context);
        vm.runInContext(script, context);

        assert.equal(elements.nex_valve_status.textContent, 'UNKNOWN');
        context.putValue('_pb_extended', true);
        assert.equal(elements.nex_valve_status.textContent, 'EXTENDED');
        context.putValue('_pb_extended', false);
        assert.equal(elements.nex_valve_status.textContent, 'NOT EXTENDED');
        context.putValue('_pb_extended', null);
        assert.equal(elements.nex_valve_status.textContent, 'UNKNOWN');
        context.putValue('other_input', true);
        assert.equal(elements.nex_valve_status.textContent, 'UNKNOWN');
    });
});
