import type { Device } from '../_models/device';
import type { WidgetPropertyVariable } from './svg-utils';

export interface WidgetBindingProfile {
    version: 1;
    bindings: { [parameter: string]: string };
}

export interface WidgetPrefixBinding {
    deviceId: string;
    parameters: { [parameter: string]: string };
}

export interface WidgetBindingResult {
    parameter: string;
    tagName: string;
    tagId?: string;
    type?: string;
    error?: string;
}

/** Pure lookup: never creates Tags, changes their definitions or writes values. */
export class WidgetBindingResolver {
    static resolve(profile: WidgetBindingProfile, config: WidgetPrefixBinding,
                   variables: WidgetPropertyVariable[], devices: Device[]): WidgetBindingResult[] {
        const selected = devices.filter(device => device.id === config?.deviceId);
        if (profile?.version !== 1 || !profile.bindings || !Object.keys(profile.bindings).length) {
            return [{ parameter: '', tagName: '', error: 'Missing or unsupported Binding Profile' }];
        }
        return Object.entries(profile.bindings).map(([parameter, expression]) => {
            const result: WidgetBindingResult = { parameter, tagName: '' };
            if (typeof expression !== 'string') return { ...result, error: 'Invalid Tag template' };
            const missing: string[] = [];
            result.tagName = expression.replace(/\{(#[1-9]\d*)\}/g, (token, key) => {
                const value = config?.parameters?.[key];
                if (typeof value !== 'string' || !value.trim()) { missing.push(key); return token; }
                return value;
            });
            const variable = variables?.find(item => item.originalName === parameter);
            if (!variable) result.error = 'Widget parameter does not exist';
            else if (missing.length) result.error = `Missing parameter: ${missing.join(', ')}`;
            else if (/[{}]/.test(result.tagName)) result.error = 'Invalid or unresolved Tag template';
            else if (selected.length !== 1) result.error = selected.length ? 'Ambiguous PLC Device ID' : 'PLC Device does not exist';
            else {
                const tags = Object.values(selected[0].tags || {}).filter(tag => tag.name === result.tagName);
                if (tags.length !== 1) result.error = tags.length ? 'Ambiguous Tag name' : 'Missing Tag';
                else {
                    result.type = tags[0].type;
                    const type = result.type?.toLowerCase();
                    const compatible = variable.type === 'boolean' ? ['bool', 'boolean'].includes(type) :
                        variable.type === 'number' ? ['number', 'byte', 'int', 'word', 'dint', 'dword', 'real', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'].includes(type) :
                        ['string', 'color'].includes(variable.type) && type === 'string';
                    if (!compatible) result.error = `Type Mismatch: expected ${variable.type}, found ${result.type}`;
                    else if (!tags[0].id) result.error = 'Tag has no ID';
                    else result.tagId = tags[0].id;
                }
            }
            return result;
        });
    }

    static apply(property: { bindingProfile?: WidgetBindingProfile; prefixBinding?: WidgetPrefixBinding;
                            varsToBind?: WidgetPropertyVariable[] }, devices: Device[]): WidgetBindingResult[] {
        if (!property.prefixBinding) return [];
        const results = this.resolve(property.bindingProfile, property.prefixBinding, property.varsToBind, devices);
        const validProfile = property.bindingProfile?.version === 1 && Object.keys(property.bindingProfile.bindings || {}).length > 0;
        // Prefix mode owns profile parameters only. Never fall back to a stale manual ID.
        for (const variable of property.varsToBind || []) {
            if (!validProfile || Object.prototype.hasOwnProperty.call(property.bindingProfile.bindings, variable.originalName)) {
                variable.variableId = results.find(result => result.parameter === variable.originalName)?.tagId;
                delete variable.variableValue;
            }
        }
        return results;
    }
}
