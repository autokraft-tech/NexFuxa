import type { ComponentUiTemplate, RuntimeSnapshot, Sample, SymbolLayout } from '../../../../docs/component-ui/contract';
import type { WidgetProperty } from '../_models/hmi';
import { reduceValve } from './valve-state';

export type ValveSymbolDefinition = Pick<ComponentUiTemplate, 'contractVersion' | 'templateId' | 'templateVersion' | 'semantics' | 'stateDisplay' | 'layouts'> & {
    tokens: { color: Record<string, string>; font: { family: string }; motion: { transitionPeriodMs: number } };
    bindings: Record<string, string>;
};

/** Attached to the existing per-Widget module, never to a template singleton. */
export class ValveSymbolRuntime {
    private samples: Record<string, Sample> = {};
    private connected: boolean;
    private bindingErrors: Record<string, string> = {};
    private animation?: Animation;
    private disposed = false;
    private label: string;
    private snapshot: RuntimeSnapshot;
    private media = window.matchMedia('(prefers-reduced-motion: reduce)');
    private visibility = () => this.render();
    private keyboard = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    };

    constructor(private root: SVGSVGElement, private definition: ValveSymbolDefinition,
                private property: WidgetProperty, private viewInstanceId = '') {
        this.label = property.componentUi?.metadata?.label ?? property.varsToBind?.find(v => v.originalName === '_ps_label')?.variableValue ?? 'Valve';
        const d = definition;
        if (d.contractVersion !== '1.0.0' || d.templateId !== 'NexFuxa.Valve.NexPlc' || d.templateVersion !== '1.0.0' ||
            d.semantics.profileId !== 'NexPlc.Valve.sixBool.hmiControl' || d.semantics.profileVersion !== '1.0.0') {
            throw Error('Unsupported Valve Symbol version');
        }
        this.root.setAttribute('tabindex', '0');
        this.root.setAttribute('role', 'button');
        this.render();
        this.root.addEventListener('keydown', this.keyboard);
        this.media.addEventListener('change', this.visibility);
        document.addEventListener('visibilitychange', this.visibility);
    }

    putValue(name: string, value: unknown, quality?: string) {
        if (this.disposed) return;
        const variable = this.property.varsToBind?.find(v => v.name === name || v.originalName === name);
        const originalName = variable?.originalName || name;
        if (originalName === '_ps_label') this.label = String(value ?? '').slice(0, 64);
        const key = this.definition.bindings[originalName];
        if (key) this.samples[key] = { value: value as Sample['value'], quality: value === null || value === undefined ? 'missing' :
            quality === undefined || quality === 'good' ? 'good' : quality === 'stale' ? 'stale' : quality === 'uncertain' ? 'uncertain' : 'bad' };
        this.render();
    }

    setContext(context: { connected?: boolean; viewInstanceId?: string }) {
        if (this.disposed) return;
        if (context.connected === false) this.samples = {};
        this.connected = context.connected;
        this.viewInstanceId = context.viewInstanceId || this.viewInstanceId;
        this.bindingErrors = {};
        for (const [parameter, key] of Object.entries(this.definition.bindings)) {
            const variable = this.property.varsToBind?.find(v => v.originalName === parameter);
            if (!variable?.variableId && (this.property.prefixBinding || this.property.inheritFaceplateBinding || variable?.variableValue === undefined)) {
                this.bindingErrors[key] = 'Missing or invalid binding';
            }
        }
        this.render();
    }

    getSnapshot(): RuntimeSnapshot { return this.snapshot; }

    private part<T extends SVGElement>(name: string): T { return this.root.querySelector(`[data-part="${name}"]`) as T; }

    private render() {
        if (this.disposed) return;
        const d = this.definition;
        const variant = this.property.layout?.symbolVariant ?? this.property.componentUi?.layout?.symbolVariant ?? d.layouts.defaultVariant;
        const layout: SymbolLayout = d.layouts.variants[variant];
        if (!layout) throw Error(`Invalid Valve Symbol layout: ${variant}`);
        const direction = this.property.componentUi?.metadata?.direction ?? 0;
        if (![0, 90, 180, 270].includes(direction)) throw Error('Invalid Valve Symbol direction');
        const binding = this.property.prefixBinding;
        const instanceKey = binding ? JSON.stringify([binding.deviceId, Object.entries(binding.parameters || {}).sort(([a], [b]) => a.localeCompare(b))]) : '';
        const snapshot = this.snapshot = reduceValve(d, { ...this.samples }, {
            connected: this.connected, bindingErrors: this.bindingErrors, instanceKey, viewInstanceId: this.viewInstanceId
        });
        this.root.setAttribute('viewBox', layout.viewBox.join(' '));
        this.root.setAttribute('font-family', d.tokens.font.family);
        this.root.setAttribute('fill', d.tokens.color.text);
        const box = (element: SVGElement, values: number[]) => ['x', 'y', 'width', 'height'].forEach((key, index) => element.setAttribute(key, String(values[index])));
        box(this.part('hit'), layout.viewBox);
        const [gx, gy, gw, gh] = layout.geometryBox;
        const scale = Math.min(gw / 101, gh / 101);
        this.part('geometry').setAttribute('transform', `translate(${gx + gw / 2} ${gy + gh / 2}) rotate(${direction}) scale(${scale}) translate(-50.5 -50.5)`);
        this.part('body').setAttribute('fill', d.tokens.color[snapshot.display.fillToken]);
        box(this.part('fault'), layout.alarmBox);
        this.part('fault').setAttribute('visibility', snapshot.semantic.fault === true ? 'visible' : 'hidden');
        const text = this.part<SVGTextElement>('status');
        text.textContent = layout.statusText === 'short' ? snapshot.display.shortText : snapshot.display.text;
        text.setAttribute('x', String(layout.statusBox[0] + layout.statusBox[2] / 2));
        text.setAttribute('y', String(layout.statusBox[1] + 15));
        text.setAttribute('font-size', variant === 'compact' ? '12' : '14');
        // The marker is separate from the persistent state text. Only it pulses.
        const marker = this.part('marker');
        marker.textContent = snapshot.semantic.motion === 'retracting' ? '←' : '→';
        marker.setAttribute('x', String(gx + gw - 8));
        marker.setAttribute('y', String(gy + gh));
        const moving = snapshot.display.motion === 'directionPulse';
        marker.setAttribute('visibility', moving ? 'visible' : 'hidden');
        const animate = moving && !this.media.matches && !document.hidden;
        if (!animate) { this.animation?.cancel(); this.animation = undefined; }
        else if (!this.animation) this.animation = marker.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: d.tokens.motion.transitionPeriodMs, iterations: Infinity });
        const icons = this.part('icons');
        icons.replaceChildren();
        const visible = snapshot.icons.length > layout.iconSlots ? [...snapshot.icons.slice(0, layout.iconSlots - 1),
            { label: `+${snapshot.icons.length - layout.iconSlots + 1}` }] : snapshot.icons;
        visible.forEach((icon, index) => {
            const x = layout.iconBox[0] + index * (layout.slotWidth + layout.slotGap);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            box(rect, [x, layout.iconBox[1], layout.slotWidth, layout.iconSize]);
            rect.setAttribute('fill', d.tokens.color.surfaceInset);
            rect.setAttribute('rx', '3');
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', String(x + layout.slotWidth / 2));
            label.setAttribute('y', String(layout.iconBox[1] + layout.iconSize / 2 + 4));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('font-size', '12');
            label.textContent = icon.label;
            icons.append(rect, label);
        });
        const label = this.part<SVGTextElement>('label');
        const fullLabel = (this.property.componentUi?.metadata?.label ?? this.label).slice(0, 64);
        label.setAttribute('x', String(layout.labelBox[0] + layout.labelBox[2] / 2));
        label.setAttribute('y', String(layout.labelBaseline));
        label.textContent = fullLabel;
        while (label.getComputedTextLength() > layout.labelBox[2] && label.textContent.length > 1) {
            label.textContent = label.textContent.replace(/…$/, '').slice(0, -1) + '…';
        }
        const description = (this.property.componentUi?.metadata?.description || '').slice(0, 256);
        const hmiReason = snapshot.semantic.hmiControl === 'unknown' ?
            `HMI Control unknown: ${this.bindingErrors[d.semantics.inputs.hmiControlAvailable] || 'missing/invalid HMI feedback'}.` : '';
        const diagnostics = `${fullLabel}. ${description}. ${snapshot.display.text}. Position: ${snapshot.semantic.position}; motion: ${snapshot.semantic.motion}; fault: ${snapshot.semantic.fault ?? '?'}. ${snapshot.icons.map(i => i.label).join(', ')}. ${snapshot.quality.reason}. ${hmiReason}`;
        this.part('title').textContent = diagnostics;
        this.root.setAttribute('aria-label', diagnostics);
    }

    destroy() {
        this.disposed = true;
        this.animation?.cancel();
        this.animation = undefined;
        this.root.removeEventListener('keydown', this.keyboard);
        this.media.removeEventListener('change', this.visibility);
        document.removeEventListener('visibilitychange', this.visibility);
    }
}
