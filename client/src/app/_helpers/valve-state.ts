import type { ComponentUiTemplate, RuntimeSnapshot, Sample } from '../../../../docs/component-ui/contract';

export type ValveProfile = Pick<ComponentUiTemplate, 'semantics' | 'stateDisplay'>;

/** The only Valve state calculation. Renderers consume this snapshot unchanged. */
export function reduceValve(profile: ValveProfile, signals: Record<string, Sample>,
                            context: { connected?: boolean; bindingErrors?: Record<string, string>;
                                instanceKey?: string; viewInstanceId?: string } = {}): RuntimeSnapshot {
    const missing: string[] = [];
    const read = (key: string): boolean | null => {
        const sample = signals[key];
        if (context.connected === false || context.bindingErrors?.[key] || sample?.quality !== 'good') return null;
        const value = typeof sample.value === 'string' ? sample.value.toLowerCase() : sample.value;
        if ([true, 1, '1', 'true'].includes(value)) return true;
        if ([false, 0, '0', 'false'].includes(value)) return false;
        return null;
    };
    const i = profile.semantics.inputs;
    const [e, r, eg, rg, f, h] = [i.extended, i.retracted, i.extending, i.retracting, i.fault, i.hmiControlAvailable].map(read);
    const position = e === null || r === null ? 'unknown' : e && r ? 'conflict' : e ? 'extended' : r ? 'retracted' : 'unknown';
    const motion = eg === null || rg === null ? 'unknown' : eg && rg ? 'conflict' : eg ? 'extending' : rg ? 'retracting' : 'stopped';
    const conflict = position === 'conflict' || motion === 'conflict' ? true :
        e === null || r === null || eg === null || rg === null ? null : false;
    profile.semantics.required.forEach(key => { if (read(key) === null) missing.push(key); });
    const incomplete = missing.length > 0;
    const binding = missing.some(key => context.bindingErrors?.[key]);
    const stale = missing.some(key => signals[key]?.quality === 'stale');
    const primary = context.connected === false ? 'COMM_LOST' : f === true ? 'FAULT' : conflict === true ? 'CONFLICT' :
        motion === 'extending' ? 'EXTENDING' : motion === 'retracting' ? 'RETRACTING' :
        position === 'extended' ? 'EXTENDED' : position === 'retracted' ? 'RETRACTED' :
        incomplete ? binding ? 'BINDING_ERROR' : stale ? 'STALE' : 'WAITING' : 'UNKNOWN';
    const quality: RuntimeSnapshot['quality'] = {
        status: context.connected === false ? 'commLost' : incomplete ?
            missing.length < profile.semantics.required.length ? 'partial' : binding ? 'bindingError' : stale ? 'stale' : 'waiting' : 'good',
        reason: context.connected === false ? 'Device or server disconnected' : missing.map(key =>
            `${key}: ${context.bindingErrors?.[key] || (signals[key]?.quality === 'good' ? 'invalid BOOL' : signals[key]?.quality) || 'missing'}`).join('; ')
    };
    const hmiControl = h === null ? 'unknown' : h ? 'available' : 'locked';
    const icons: RuntimeSnapshot['icons'] = [];
    if (quality.status !== 'good') icons.push({ id: 'quality', label: primary === 'COMM_LOST' ? 'COM' : binding ? 'TAG ?' : stale ? 'STALE' : 'DATA ?', state: 'unknown', priority: 0 });
    icons.push({ id: 'hmiControl', label: hmiControl === 'available' ? 'MAN' : hmiControl === 'locked' ? 'LOCK' : 'HMI ?', state: h === null ? 'unknown' : 'normal', priority: 6 });
    return { instanceKey: context.instanceKey || '', viewInstanceId: context.viewInstanceId || '', signals,
        semantic: { position, motion, fault: f, conflict, hmiControl }, primary, quality, icons,
        display: { ...profile.stateDisplay[primary] } };
}
