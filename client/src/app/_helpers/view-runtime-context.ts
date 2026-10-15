import { View } from '../_models/hmi';
import type { WidgetPrefixBinding } from './widget-binding';

/** One rendered view. Never write this clone back to the project. */
export class ViewRuntimeContext {
    private static sequence = 0;
    static createInstanceId(): string { return `view_instance_${++ViewRuntimeContext.sequence}`; }
    readonly viewInstanceId = ViewRuntimeContext.createInstanceId();
    readonly viewDefinitionId: string;
    readonly view: View;
    readonly faceplateBinding?: WidgetPrefixBinding;
    readonly ids: Record<string, string> = {};
    readonly cleanups: (() => void)[] = [];
    private timers = new Set<ReturnType<typeof setTimeout>>();

    schedule(callback: () => void, delay: number) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            callback();
        }, delay);
        this.timers.add(timer);
    }

    static snapshotBinding(binding?: WidgetPrefixBinding): WidgetPrefixBinding | undefined {
        return binding ? Object.freeze({deviceId: binding.deviceId, parameters: Object.freeze({...binding.parameters})}) : undefined;
    }

    constructor(definition: View, root: HTMLElement, faceplateBinding?: WidgetPrefixBinding) {
        this.viewDefinitionId = definition.id;
        this.faceplateBinding = ViewRuntimeContext.snapshotBinding(faceplateBinding);
        this.view = JSON.parse(JSON.stringify(definition));
        root.querySelectorAll('[id]').forEach(node => {
            this.ids[node.id] = `${node.id}__${this.viewInstanceId}`;
        });
        root.querySelectorAll('*').forEach(node => {
            for (const attribute of Array.from(node.attributes)) {
                let value = attribute.value;
                if (attribute.name === 'id') value = this.ids[value];
                else {
                    value = value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
                        (match, quote, id) => this.ids[id] ? `url(#${this.ids[id]})` : match);
                    if (['href', 'xlink:href'].includes(attribute.name) && value.startsWith('#') && this.ids[value.slice(1)]) {
                        value = '#' + this.ids[value.slice(1)];
                    }
                    if (['for', 'aria-labelledby', 'aria-describedby'].includes(attribute.name)) {
                        value = value.split(' ').map(id => this.ids[id] || id).join(' ');
                    }
                }
                if (value !== attribute.value) node.setAttribute(attribute.name, value);
            }
            if (node.tagName.toLowerCase() === 'style') {
                // Parse CSS so a color literal matching an element ID is never renamed.
                const rewrite = (rules: CSSRuleList) => Array.from(rules).forEach(rule => {
                    if (rule instanceof CSSStyleRule) {
                        rule.selectorText = rule.selectorText.replace(/#([\w-]+)/g,
                            (match, id) => this.ids[id] ? '#' + this.ids[id] : match);
                        for (const property of Array.from(rule.style)) {
                            const value = rule.style.getPropertyValue(property).replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
                                (match, quote, id) => this.ids[id] ? `url(#${this.ids[id]})` : match);
                            rule.style.setProperty(property, value, rule.style.getPropertyPriority(property));
                        }
                    } else if ('cssRules' in rule) rewrite((rule as CSSGroupingRule).cssRules);
                });
                const sheet = (node as SVGStyleElement).sheet;
                if (sheet) rewrite(sheet.cssRules);
            }
        });
        const items = {};
        Object.entries(this.view.items || {}).forEach(([id, gauge]) => {
            gauge.id = this.ids[gauge.id] || `${gauge.id}__${this.viewInstanceId}`;
            gauge.property?.events?.forEach(event => {
                if (event.actoptions?.panelId) event.actoptions.panelId = this.ids[event.actoptions.panelId] || event.actoptions.panelId;
                // onSetInput takes a gauge ID; other actparam values can be view/tag/script IDs.
                if (event.action === 'onSetInput') event.actparam = this.ids[event.actparam] || event.actparam;
            });
            items[this.ids[id] || gauge.id] = gauge;
        });
        this.view.items = items;
    }

    destroy(root: HTMLElement) {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.cleanups.splice(0).forEach(cleanup => cleanup());
        root.querySelectorAll('[data-fuxa-module]').forEach(node => {
            const id = node.getAttribute('data-fuxa-module');
            try { window[id]?.destroy?.(); } catch (err) { console.error('Widget destroy', err); }
            finally { window[id] = undefined; delete window[id]; }
        });
    }
}
