/** NexFuxa Component UI v1.0: frozen design types; runtime implementation pending. */
export type PlcType = 'BOOL' | 'INT' | 'UINT' | 'DINT' | 'UDINT' | 'REAL' | 'LREAL' | 'ENUM' | 'STRING';
export type Scalar = boolean | number | string;
export type Capability = 'supported' | 'unsupported' | 'unverified';
export type LayoutVariant = 'compact' | 'standard' | 'detailed';
export type Box = [number, number, number, number];
export type PrimaryState = 'BINDING_ERROR' | 'COMM_LOST' | 'WAITING' | 'STALE' | 'FAULT' | 'CONFLICT' | 'EXTENDING' | 'RETRACTING' | 'EXTENDED' | 'RETRACTED' | 'UNKNOWN';
export interface Signal {
    member: string;
    tagNameTemplate: string;
    plcType: PlcType;
    runtimeType: 'boolean' | 'number' | 'string';
    access: 'read' | 'write' | 'readWrite';
    requiredForStatus: boolean;
}
export interface Permission {
    source: 'existingProject'; // use existing control permission/permissionRoles
}
export interface Command {
    signal: string;
    label: string;
    capability: Capability;
    permission: Permission;
    write: { kind: 'constant'; value: true; delivery: 'onlineOnceNoRestore' };
    requiresHmiControl: boolean;
    confirmation: 'none' | 'confirm';
    enabled: boolean;
    note?: string;
}
export interface Parameter {
    signal: string;
    label: string;
    group: string;
    description: string;
    unit: string | null;
    min?: number; // optional engineering bounds; PLC type validation is mandatory
    max?: number;
    defaultValue: Scalar | null; // null = unspecified; never write on refresh
    enumValues?: { value: number; label: string }[];
    maxBytes?: number;
    encoding?: string;
    precision?: number;
    permission: Permission;
    save: 'explicitItemSave';
    confirmation: 'confirm';
    writable: boolean;
}
export interface SymbolLayout {
    viewBox: Box;
    geometryBox: Box;
    statusBox: Box;
    iconBox: Box;
    labelBox: Box;
    alarmBox: Box;
    labelBaseline: number;
    iconSlots: number;
    iconSize: 16 | 20;
    slotWidth: number;
    slotGap: number;
    statusText: 'short' | 'full';
}
export type AlarmContract =
    | { adapter: 'none'; faultSignal: string; faultIsAlarmLifecycle: false }
    | { adapter: 'fuxaAlarmEvents'; associationRef: string; faultSignal: string; faultIsAlarmLifecycle: false };
export interface AlarmAssociation {
    id: string;
    instances: Record<string, { // exact complete instance key; no fallback
        events: { alarmName: string; alarmType: 'highhigh' | 'high' | 'low' | 'info'; priority: 1 | 2 | 3 | 4 }[];
    }>;
}
export type AlarmFlag = 'active' | 'inactive' | 'unsupported' | 'unknown';
export interface UiAlarm {
    id: string;
    priority: 1 | 2 | 3 | 4;
    condition: 'active' | 'returned' | 'unknown';
    acknowledgement: 'unacknowledged' | 'acknowledged' | 'notRequired' | 'unknown';
    activatedAt: number | null;
    returnedAt: number | null;
    acknowledgedAt: number | null;
    acknowledgedBy: string | null;
    suppression: { state: AlarmFlag; since: number | null; reason: string | null };
    shelving: { state: AlarmFlag; since: number | null; until: number | null; by: string | null; reason: string | null };
    quality: 'good' | 'uncertain' | 'bad' | 'stale';
}
export interface ValveSemantics {
    kind: 'nexplcValveSixBool'; // finite versioned reducer; no expression engine
    profileId: string;
    profileVersion: string;
    inputs: {
        extended: string; retracted: string; extending: string;
        retracting: string; fault: string; hmiControlAvailable: string;
    };
    required: string[]; // equipment completeness only; never a global dimension gate
    qualityPolicy: 'connectionThenPerDimension';
    hmiControl: {
        trueLabel: 'MAN'; trueDescription: 'HMI Control';
        falseLabel: 'HMI Locked'; falseShortLabel: 'LOCK'; unknownLabel: 'HMI ?';
        meaning: string;
    };
}
export interface ComponentUiTemplate {
    contractVersion: '1.0.0';
    templateId: string;
    templateVersion: string;
    modelRef: { name: string; version: string; rootType: string; sourceCommit: string };
    componentType: string;
    shape: { asset: string; geometryId: string; provenance: string };
    layouts: { symbolBackground: 'transparent'; faceplateBackground: 'opaque'; defaultVariant: LayoutVariant; variants: Record<LayoutVariant, SymbolLayout> };
    metadata: { labelSource: 'instance'; descriptionSource: 'instance'; extendedMeaning: 'instanceOrUnspecified' };
    signals: Record<string, Signal>;
    semantics: ValveSemantics; // add a separate finite profile union when second component is verified
    stateDisplay: Record<PrimaryState, { text: string; shortText: string; fillToken: string; marker: string; motion: 'none' | 'directionPulse' }>;
    alarms: AlarmContract;
    faultEmphasis: 'staticDashedWhenNoAlarmBorder'; // no severity, flashing or acknowledgement
    icons: { id: string; capability: Capability; source: string | null; visibility: 'alwaysWhenSupported' | 'abnormalOnly' }[];
    processValues: { signal: string; label: string; unit: string | null; capability: Capability }[];
    commands: Record<string, Command>;
    parameters: Parameter[];
    faceplate: { tabs: { id: 'operation' | 'configuration' | 'diagnostics' | 'alarms' | 'trends' | 'maintenance'; requires: 'always' | 'hasParameters' | 'bindingReport' | 'alarmAdapterConfigured' | 'trendSourceConfigured' | 'maintenanceConfigured' }[] };
    binding: { adapter: 'fuxaPrefixV1'; parameters: string[]; exactDeviceAndTagName: true; missing: 'invalidateNoFallback' };
    writeAdapter: { kind: 'fuxaPrefixWriteV1'; optIn: true; targets: 'declaredCommandsAndWritableParameters'; result: 'driverWriteResult' };
    upgrade: { policy: 'pinnedExplicitMigration'; legacyWidget: 'preserve'; minimumRendererVersion: string };
}
export interface ComponentUiInstance {
    instanceId: string;
    templateId: string;
    templateVersion: string;
    prefixBinding: { deviceId: string; parameters: Record<string, string> };
    layout: { symbolVariant: LayoutVariant };
    metadata: { label: string; description: string; extendedMeaning: 'open' | 'closed' | 'unspecified'; direction: 0 | 90 | 180 | 270 };
    sourceEvidence: { adsRoot: string; indices: number[]; naming: 'phase3a' | 'generatorV2' | 'explicit' };
}
/** Frozen design request: definition IDs, never DOM suffix IDs or caller-selected Tag IDs. */
export interface PrefixWriteRequest {
    source: { viewDefinitionId: string; gaugeDefinitionId: string };
    target: { viewDefinitionId: string; gaugeDefinitionId: string };
    writeKey: string; // e.g. command:Extend or parameter:Cfg.ExtendTimeOut
    value: Scalar;
}
export type PrefixWriteResult = { ok: true } | { ok: false; error: string };
export interface Sample {
    value: Scalar | null;
    quality: 'good' | 'uncertain' | 'bad' | 'missing' | 'stale';
}
export interface ValveState {
    position: 'extended' | 'retracted' | 'conflict' | 'unknown';
    motion: 'extending' | 'retracting' | 'stopped' | 'conflict' | 'unknown';
    fault: boolean | null;
    conflict: boolean | null;
    hmiControl: 'available' | 'locked' | 'unknown';
}
export interface RuntimeSnapshot {
    instanceKey: string;
    viewInstanceId: string;
    signals: Record<string, Sample>;
    semantic: ValveState;
    primary: PrimaryState;
    quality: { status: 'good' | 'partial' | 'bindingError' | 'commLost' | 'waiting' | 'stale' | 'uncertain'; reason: string };
    alarmSummary?: { quality: 'good' | 'uncertain' | 'bad' | 'stale'; selected: UiAlarm | null; activeCount: number; unackCount: number; flashing: boolean };
    icons: { id: string; label: string; state: 'active' | 'normal' | 'unknown'; priority: number }[];
    display: { text: string; shortText: string; fillToken: string; marker: string; motion: 'none' | 'directionPulse' };
    // Layout selection and individual write pending/result are presentation-local, not PLC state.
}
