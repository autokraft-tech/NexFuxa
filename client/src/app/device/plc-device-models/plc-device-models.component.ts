import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';
import { EndPointApi } from '../../_helpers/endpointapi';
import { ProjectService } from '../../_services/project.service';
import { Device, DeviceType } from '../../_models/device';

type JsonImportKind = 'models' | 'configurations';
type JsonImportMode = 'merge' | 'overwrite' | 'replace';

@Component({
    selector: 'app-plc-device-models',
    templateUrl: './plc-device-models.component.html',
    styleUrls: ['./plc-device-models.component.scss']
})
export class PlcDeviceModelsComponent {
    private readonly api = EndPointApi.getURL() + '/api/plc-device-models';
    readonly adsDevices: Device[];
    models: any[] = [];
    customModels: any[] = [];
    modelHash = '';
    modelDraft: any = null;
    modelRows: any[] = [];
    editingType = '';
    modelTypeNameError = false;
    modelEditing = false;
    modelDirty = false;
    memberSelection: { [path: string]: boolean } = {};
    private modelLeavesCacheKey = '';
    private modelLeavesCache: any[] = [];
    taskSearch = '';
    selectedTasks: { [id: string]: boolean } = {};
    defaultDaq = { enabled: false, interval: 60, changed: false, restored: false };
    bulkDaq = { enabled: false, interval: 60, changed: false, restored: false };
    selectedModel = 'Valve@1.0.0';
    configurations: any[] = [];
    configurationHash = '';
    selectedConfigurationId = '';
    draft: any = null;
    configSaved = false;
    previewSearch = '';
    previewFilter = 'All';
    previewSort = 'name';
    readonly primitiveTypes = ['BOOL', 'INT', 'DINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'STRING'];
    previewResult: any = null;
    error = '';
    notice = '';
    busy = false;
    jsonImport: any = null;
    private previewVersion = 0;
    private previewRequestId = 0;
    private configurationLoadId = 0;

    constructor(private http: HttpClient, private projectService: ProjectService,
        private dialogRef: MatDialogRef<PlcDeviceModelsComponent>) {
        this.adsDevices = this.projectService.getDeviceList().filter(device => device.type === DeviceType.ADSclient);
        this.http.get<any[]>(this.api).subscribe({
            next: models => { this.models = models; if (!this.modelDraft && models.length) this.editModel(models[0].name + '@' + models[0].version); },
            error: error => this.showError(error)
        });
        this.reloadModels();
        this.reloadConfigurations();
    }

    private reloadModels() {
        this.http.get<any>(this.api + '/models').subscribe({
            next: result => { this.customModels = result.models; this.modelHash = result.hash; },
            error: error => this.showError(error)
        });
    }

    private reloadConfigurations(refreshEditor = false) {
        const requestId = ++this.configurationLoadId;
        const version = this.previewVersion;
        const draftSnapshot = JSON.stringify(this.draft);
        this.http.get<any>(this.api + '/configurations').subscribe({
            next: result => {
                if (requestId !== this.configurationLoadId) return;
                this.configurations = result.configurations;
                this.configurationHash = result.hash;
                if (refreshEditor && version === this.previewVersion && draftSnapshot === JSON.stringify(this.draft)) {
                    const current = this.configurations.find(item => item.id === this.selectedConfigurationId);
                    this.loadConfiguration(current || null);
                } else if (this.draft && this.configSaved &&
                    this.fingerprint(this.draft) !== this.fingerprint(this.configurations.find(item => item.id === this.selectedConfigurationId))) {
                    this.invalidateConfiguration();
                }
            }, error: error => this.showError(error)
        });
    }

    refreshConfigurations() {
        if (this.busy || !this.confirmLeaveConfiguration('refresh the editor')) return;
        this.previewVersion++;
        this.previewResult = null;
        this.reloadConfigurations(true);
    }

    private confirmLeaveConfiguration(action: string): boolean {
        return !this.draft || this.configSaved ||
            window.confirm(`The current configuration has unsaved changes. Continue and ${action}? Changes to the current task will not be saved.`);
    }

    private loadConfiguration(configuration: any) {
        this.selectedConfigurationId = configuration?.id || '';
        this.draft = configuration ? JSON.parse(JSON.stringify(configuration)) : null;
        this.configSaved = !!configuration;
        this.previewVersion++;
        this.previewResult = null;
        this.error = '';
    }

    newConfiguration() {
        if (this.busy || !this.confirmLeaveConfiguration('create a new task')) return;
        const id = 'cfg_' + Math.random().toString(36).slice(2, 11);
        this.selectedConfigurationId = id;
        this.draft = { schemaVersion: 2, id, name: 'New configuration',
            deviceId: this.adsDevices[0]?.id || '', tagPrefix: 'Tag', adsSymbol: 'GVL.bStart',
            valueKind: 'primitive', plcType: 'BOOL', array: { mode: 'scalar' } };
        this.invalidateConfiguration();
    }

    selectConfiguration(id: string) {
        if (this.busy) return;
        const saved = this.configurations.find(item => item.id === id);
        if (!saved || !this.confirmLeaveConfiguration('switch tasks')) return;
        this.loadConfiguration(saved);
    }

    copyConfiguration() {
        if (!this.draft || this.busy || !this.confirmLeaveConfiguration('copy the current contents into a new task')) return;
        this.draft = { ...JSON.parse(JSON.stringify(this.draft)),
            id: 'cfg_' + Math.random().toString(36).slice(2, 11), name: this.draft.name + ' copy' };
        this.selectedConfigurationId = this.draft.id;
        this.invalidateConfiguration();
    }

    deleteConfiguration() {
        if (!this.draft || this.busy) return;
        if (!window.confirm(`Delete configuration "${this.draft.name}"?${!this.configSaved ? ' Unsaved changes will be discarded.' : ''} Existing Tags and Widget bindings will be kept.`)) return;
        if (!this.configurations.some(item => item.id === this.draft.id)) {
            this.loadConfiguration(null);
            return;
        }
        const next = this.configurations.filter(item => item.id !== this.draft.id);
        this.persistConfigurations(next, () => {
            this.loadConfiguration(null);
        });
    }

    invalidateConfiguration() {
        this.notice = '';
        this.previewVersion++;
        this.previewResult = null;
        this.configSaved = false;
        this.error = '';
    }

    setArrayMode(mode: string) {
        if (!this.draft) return;
        this.draft.array = mode === 'element' ? { mode, indices: [0] } :
            mode === 'range' ? { mode, dimensions: [{ start: 0, end: 9, step: 1 }] } : { mode: 'scalar' };
        this.invalidateConfiguration();
    }

    addDimension() {
        if (this.draft?.array?.mode === 'element' && this.draft.array.indices.length < 2) this.draft.array.indices.push(0);
        if (this.draft?.array?.mode === 'range' && this.draft.array.dimensions.length < 2)
            this.draft.array.dimensions.push({ start: 0, end: 1, step: 1 });
        this.invalidateConfiguration();
    }

    removeDimension() {
        if (this.draft?.array?.mode === 'element' && this.draft.array.indices.length > 1) this.draft.array.indices.pop();
        if (this.draft?.array?.mode === 'range' && this.draft.array.dimensions.length > 1) this.draft.array.dimensions.pop();
        this.invalidateConfiguration();
    }

    modelLeaves(): any[] {
        const model = this.models.find(item => `${item.name}@${item.version}` === this.draft?.model);
        const selected = this.draft?.profile && this.draft.profile !== 'Full' ? model?.profileDefinitions?.[this.draft.profile] : null;
        return (model?.leaves || []).filter(leaf => !selected || selected.includes(leaf.path));
    }

    modelProfiles(): string[] {
        return this.models.find(item => `${item.name}@${item.version}` === this.draft?.model)?.profiles || ['Full'];
    }

    changeValueKind() {
        if (this.draft?.valueKind === 'structure' && !this.draft.model && this.models.length)
            this.draft.model = `${this.models[0].name}@${this.models[0].version}`;
        if (this.draft?.valueKind === 'structure') this.changeStructureModel();
        else if (this.draft) {
            delete this.draft.model;
            delete this.draft.profile;
            delete this.draft.memberPaths;
            this.draft.memberOverrides = this.draft.memberOverrides?.$value ? { $value: this.draft.memberOverrides.$value } : {};
        }
        this.invalidateConfiguration();
    }

    changeStructureModel() {
        if (this.draft) {
            this.draft.profile = 'Full';
            delete this.draft.memberPaths;
            const paths = new Set(this.modelLeaves().map(leaf => leaf.path));
            if (this.draft.memberOverrides) this.draft.memberOverrides = Object.fromEntries(
                Object.entries(this.draft.memberOverrides).filter(([path]) => paths.has(path)));
        }
        this.invalidateConfiguration();
    }

    memberSelected(path: string): boolean {
        return !this.draft?.memberPaths || this.draft.memberPaths.includes(path);
    }

    toggleMember(path: string) {
        if (!this.draft) return;
        const all = this.modelLeaves().map(leaf => leaf.path);
        const selected = new Set(this.draft.memberPaths || all);
        if (selected.has(path)) selected.delete(path); else selected.add(path);
        this.draft.memberPaths = all.filter(item => selected.has(item));
        this.invalidateConfiguration();
    }

    saveConfiguration() {
        if (this.busy || !this.draft) return;
        const snapshot = JSON.parse(JSON.stringify(this.draft));
        const next = [...this.configurations.filter(item => item.id !== snapshot.id), snapshot];
        this.persistConfigurations(next, () => {
            this.configSaved = JSON.stringify(this.draft) === JSON.stringify(snapshot);
        });
    }

    private persistConfigurations(next: any[], done: () => void) {
        this.error = '';
        this.busy = true;
        this.configurationLoadId++;
        this.previewVersion++;
        this.previewResult = null;
        this.http.post<any>(this.api + '/configurations', { configurations: next, expectedHash: this.configurationHash }).subscribe({
            next: result => {
                this.configurations = result.configurations;
                this.configurationHash = result.hash;
                done();
                this.busy = false;
                this.reloadModels();
            }, error: error => { this.showError(error); this.busy = false; }
        });
    }

    previewConfiguration() {
        if (this.busy || !this.configSaved || !this.draft) return;
        this.busy = true;
        this.error = '';
        this.previewResult = null;
        const version = ++this.previewVersion;
        const requestId = ++this.previewRequestId;
        const snapshot = JSON.stringify(this.draft);
        const id = this.draft.id;
        this.http.post<any>(this.api + '/preview', { configurationIds: [id], expectedHash: this.configurationHash }).subscribe({
            next: result => {
                if (version === this.previewVersion && this.configSaved && snapshot === JSON.stringify(this.draft) &&
                    id === this.selectedConfigurationId) {
                    this.previewResult = result;
                }
                if (requestId === this.previewRequestId) this.busy = false;
            }, error: error => {
                if (version === this.previewVersion) this.showError(error);
                if (requestId === this.previewRequestId) this.busy = false;
            }
        });
    }

    filteredPreviewRows(): any[] {
        const search = this.previewSearch.trim().toLowerCase();
        return (this.previewResult?.rows || []).filter(row =>
            (this.previewFilter === 'All' || row.operation === this.previewFilter) &&
            (!search || `${row.actualName || row.name} ${row.address} ${row.sourceConfiguration}`.toLowerCase().includes(search)))
            .sort((a, b) => String(this.previewSort === 'name' ? a.actualName || a.name : a[this.previewSort] || '')
                .localeCompare(String(this.previewSort === 'name' ? b.actualName || b.name : b[this.previewSort] || '')));
    }

    filteredConfigurations(): any[] {
        return this.configurations.filter(item => (item.name + ' ' + item.adsSymbol).toLowerCase().includes(this.taskSearch.toLowerCase()));
    }

    useModelInConfiguration() {
        if (!this.selectedModel || this.modelDirty || this.busy) return;
        if (!this.draft) this.newConfiguration();
        if (!this.draft) return;
        this.draft.valueKind = 'structure';
        this.draft.model = this.selectedModel;
        this.changeStructureModel();
    }

    configurationProperties(path: string): any { return this.draft?.memberOverrides?.[path] || {}; }
    modelDefaults(path: string): any {
        return this.models.find(item => item.name + '@' + item.version === this.draft?.model)?.memberDefaults?.[path] || {};
    }
    setConfigurationProperties(path: string, properties: any) {
        this.draft.memberOverrides = { ...this.draft.memberOverrides, [path]: properties };
        this.invalidateConfiguration();
    }
    resetMemberDefaults(path: string) {
        if (this.draft.memberOverrides) delete this.draft.memberOverrides[path];
        this.invalidateConfiguration();
    }

    close() {
        if (this.busy || !this.confirmLeaveConfiguration('close the dialog') ||
            !this.confirmModelLeave()) return;
        this.dialogRef.close();
    }

    private confirmModelLeave(): boolean {
        return !this.modelDirty || window.confirm('Discard unsaved model draft changes?');
    }

    editModel(key: string) {
        if (this.busy || !this.confirmModelLeave()) return;
        const current = this.customModels.find(item => item.name + '@' + item.version === key) ||
            this.models.find(item => item.name + '@' + item.version === key);
        if (!current) return;
        this.selectedModel = key;
        this.modelDraft = JSON.parse(JSON.stringify({ schemaVersion: 2, name: current.name,
            version: current.version, rootType: current.rootType, types: current.types,
            profiles: current.profileDefinitions || current.profiles || {},
            ...(current.memberDefaults ? { memberDefaults: current.memberDefaults } : {}) }));
        this.modelEditing = false;
        this.modelDirty = false;
        this.editingType = this.modelDraft.rootType;
        this.loadModelRows();
    }

    beginModelEdit() {
        if (!this.modelDraft || this.selectedModel === 'Valve@1.0.0') return;
        const parts = this.modelDraft.version.split('.').map(Number);
        do { parts[2]++; } while (this.customModels.some(item => item.name === this.modelDraft.name && item.version === parts.join('.')));
        this.modelDraft.version = parts.join('.');
        this.modelEditing = true;
        this.modelChanged();
    }

    newModel() {
        if (this.busy || !this.confirmModelLeave()) return;
        this.selectedModel = '';
        this.modelDraft = { schemaVersion: 2, name: 'NewModel', version: '1.0.0',
            rootType: 'ST_NewModel', types: { ST_NewModel: { Running: 'BOOL' } }, profiles: {} };
        this.editingType = this.modelDraft.rootType;
        this.modelEditing = true;
        this.modelChanged();
        this.loadModelRows();
    }

    copyModel() {
        if (!this.modelDraft || this.busy || !this.confirmModelLeave()) return;
        if (!this.syncModelType()) return;
        this.modelDraft = JSON.parse(JSON.stringify(this.modelDraft));
        this.modelDraft.name += 'Copy';
        this.modelDraft.version = '1.0.0';
        this.selectedModel = '';
        this.modelEditing = true;
        this.modelChanged();
    }

    modelTypes(): string[] { return Object.keys(this.modelDraft?.types || {}); }
    private loadModelRows() {
        this.modelTypeNameError = false;
        this.modelRows = Object.entries(this.modelDraft.types[this.editingType] || {}).map(([name, plcType]) => ({ name, plcType }));
    }
    private syncModelType(): boolean {
        if (!this.modelDraft) return false;
        const names = this.modelRows.map(row => row.name);
        if (new Set(names).size !== names.length || names.some(name => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))) {
            this.error = 'Member names must be valid PLC identifiers and unique within their structure.';
            return false;
        }
        this.modelDraft.types[this.editingType] = Object.fromEntries(this.modelRows.map(row => [row.name, row.plcType]));
        return true;
    }
    switchModelType(type: string) {
        if (!this.syncModelType()) return;
        this.editingType = type;
        this.loadModelRows();
    }
    renameModelType(name: string) {
        if (this.busy || !this.modelEditing) return;
        if (name === this.editingType) { this.modelTypeNameError = false; this.error = ''; return; }
        if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || this.modelDraft.types[name]) {
            this.modelTypeNameError = true;
            this.error = 'Structure type names must be valid and unique.';
            return;
        }
        if (!this.syncModelType()) return;
        const old = this.editingType;
        this.modelDraft.types[name] = this.modelDraft.types[old];
        delete this.modelDraft.types[old];
        for (const members of Object.values(this.modelDraft.types) as any[]) {
            for (const key of Object.keys(members)) if (members[key] === old) members[key] = name;
        }
        for (const row of this.modelRows) if (row.plcType === old) row.plcType = name;
        if (this.modelDraft.rootType === old) this.modelDraft.rootType = name;
        this.editingType = name;
        this.modelChanged();
        this.modelTypeNameError = false;
        this.error = '';
    }
    addModelMember() {
        let n = 1;
        while (this.modelRows.some(row => row.name === 'Member' + n)) n++;
        this.modelRows.push({ name: 'Member' + n, plcType: 'BOOL' });
        this.modelChanged();
    }
    addModelGroup() {
        let n = 1;
        while (this.modelDraft.types['ST_Group' + n] || this.modelRows.some(row => row.name === 'Group' + n)) n++;
        this.modelDraft.types['ST_Group' + n] = { Value: 'BOOL' };
        this.modelRows.push({ name: 'Group' + n, plcType: 'ST_Group' + n });
        this.modelChanged();
    }
    removeModelMember(index: number) { this.modelRows.splice(index, 1); this.modelChanged(); }
    expandedModelLeaves(): any[] {
        if (!this.modelDraft) return [];
        const types = { ...this.modelDraft.types,
            [this.editingType]: Object.fromEntries(this.modelRows.map(row => [row.name, row.plcType])) };
        const cacheKey = JSON.stringify([this.modelDraft.rootType, types]);
        if (cacheKey === this.modelLeavesCacheKey) return this.modelLeavesCache;
        const leaves = [];
        const walk = (type: string, path: string, active: string[]) => {
            if (active.includes(type) || active.length > 100) throw new Error('Cyclic structure reference');
            for (const [name, child] of Object.entries(types[type] || {})) {
                const next = path ? path + '.' + name : name;
                if (types[child as string]) walk(child as string, next, [...active, type]);
                else {
                    if (!this.primitiveTypes.includes(child as string)) throw new Error('Unsupported PLC type ' + child);
                    leaves.push({ path: next, plcType: child, type: this.fuxaType(child as string) });
                    if (leaves.length > 500) throw new Error('Model exceeds 500 leaves');
                }
            }
        };
        this.modelLeavesCacheKey = cacheKey;
        try { walk(this.modelDraft.rootType, '', []); this.modelLeavesCache = leaves; }
        catch { this.modelLeavesCache = []; }
        return this.modelLeavesCache;
    }
    fuxaType(plcType: string): string { return plcType === 'BOOL' ? 'boolean' : plcType === 'STRING' ? 'string' : this.primitiveTypes.includes(plcType) ? 'number' : 'Structure'; }
    setModelProperties(path: string, properties: any) {
        this.modelDraft.memberDefaults = { ...this.modelDraft.memberDefaults, [path]: properties };
        this.modelChanged();
    }
    modelChanged() {
        this.notice = '';
        this.modelDirty = true;
        this.previewVersion++;
        this.previewResult = null;
    }
    bulkSetModelDaq() {
        for (const leaf of this.expandedModelLeaves().filter(item => this.memberSelection[item.path])) {
            this.setModelProperties(leaf.path, { ...this.modelDraft.memberDefaults?.[leaf.path], daq: { ...this.bulkDaq } });
        }
    }

    saveModel() {
        if (this.busy || !this.modelEditing || this.modelTypeNameError || !this.syncModelType()) return;
        const leaves = this.expandedModelLeaves();
        if (!leaves.length) { this.error = 'Model must have valid primitive leaves and no cyclic structure references.'; return; }
        const paths = new Set(leaves.map(leaf => leaf.path));
        if (this.modelDraft.memberDefaults) this.modelDraft.memberDefaults = Object.fromEntries(
            Object.entries(this.modelDraft.memberDefaults).filter(([path]) => paths.has(path)));
        this.modelDraft.profiles = Object.fromEntries(Object.entries(this.modelDraft.profiles || {})
            .map(([key, value]) => [key, (value as string[]).filter(path => paths.has(path))]).filter(([, value]) => (value as string[]).length));
        const candidate = JSON.parse(JSON.stringify(this.modelDraft));
        if (this.customModels.some(item => item.name === candidate.name && item.version === candidate.version)) {
            this.error = 'Save with a new model name or version. Saved versions are immutable.';
            return;
        }
        this.persistModels([...this.customModels, candidate], () => {
            this.modelDirty = false;
            this.modelEditing = false;
            this.selectedModel = candidate.name + '@' + candidate.version;
        });
    }

    deleteModel() {
        if (this.busy || !this.selectedModel) return;
        const references = this.configurations.filter(item => item.model === this.selectedModel).map(item => item.name);
        if (references.length) { this.error = 'Model is referenced by: ' + references.join(', '); return; }
        if (!this.customModels.some(item => item.name + '@' + item.version === this.selectedModel) ||
            !window.confirm('Delete custom model "' + this.selectedModel + '"? Existing Tags and Widget bindings will be kept.')) return;
        this.persistModels(this.customModels.filter(item => item.name + '@' + item.version !== this.selectedModel),
            () => { this.modelDraft = null; this.modelDirty = false; this.selectedModel = ''; });
    }

    private persistModels(next: any[], done: () => void = () => {}) {
        this.error = '';
        this.notice = '';
        this.previewVersion++;
        this.previewResult = null;
        this.busy = true;
        this.http.post<any>(this.api + '/models', { models: next, expectedHash: this.modelHash }).subscribe({
            next: result => {
                this.customModels = result.models;
                this.modelHash = result.hash;
                done();
                this.busy = false;
                this.http.get<any[]>(this.api).subscribe({ next: models => this.models = models,
                    error: error => this.showError(error) });
                this.reloadConfigurations();
            }, error: error => { this.showError(error); this.busy = false; }
        });
    }

    async importJson(event: Event, kind: JsonImportKind) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (this.busy) return;
        if (!file || file.size > 100000) { if (file) this.error = 'JSON exceeds 100 KB'; return; }
        this.jsonImport = null;
        this.busy = true;
        try {
            const data = JSON.parse(await file.text());
            if (data.schemaVersion !== 2 || !Array.isArray(data[kind])) throw new Error('Expected Schema Version 2 JSON');
            this.stageJsonImport(data, kind);
        } catch (error) { this.showError(error); }
        finally { this.busy = false; }
    }

    stageJsonImport(data: any, kind: JsonImportKind) {
        if (data.schemaVersion !== 2 || !Array.isArray(data[kind])) throw new Error('Expected Schema Version 2 JSON');
        const keys = new Set<string>();
        for (const item of data[kind]) {
            const key = this.importKey(item, kind);
            if (keys.has(key)) throw new Error(`Duplicate key in import file: ${key}`);
            if (kind === 'models' && key === 'Valve@1.0.0') throw new Error('Valve@1.0.0 is a read-only built-in model');
            keys.add(key);
        }
        this.jsonImport = { kind, items: data[kind], mode: 'merge',
            baseline: this.fingerprint(kind === 'models' ? this.customModels : this.configurations),
            expectedHash: kind === 'models' ? this.modelHash : this.configurationHash };
        this.updateJsonImportMode();
        this.error = '';
    }

    importLegacyConfigurations() {
        if (this.busy) return;
        this.busy = true;
        this.http.get<any>(this.api + '/legacy-configurations').subscribe({
            next: result => {
                this.busy = false;
                try {
                    if (!result.configurations.length) { this.error = 'No unmigrated legacy configurations remain.'; return; }
                    this.stageJsonImport(result, 'configurations');
                } catch (error) { this.showError(error); }
            }, error: error => { this.busy = false; this.showError(error); }
        });
    }

    private importKey(item: any, kind: JsonImportKind): string {
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
            (kind === 'models' ? typeof item.name !== 'string' || !item.name ||
                typeof item.version !== 'string' || !item.version : typeof item.id !== 'string' || !item.id)) {
            throw new Error('Every imported item requires a valid identity');
        }
        if (kind === 'configurations' && (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(item.id) || item.id.length > 100))
            throw new Error('Invalid configuration ID in import');
        return kind === 'models' ? `${item.name}@${item.version}` : item.id;
    }

    private fingerprint(value: any): string {
        const normalize = (input: any): any => Array.isArray(input) ? input.map(normalize) :
            input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])])) : input;
        return JSON.stringify(normalize(value));
    }

    updateJsonImportMode() {
        if (!this.jsonImport) return;
        const { kind, items, mode } = this.jsonImport as { kind: JsonImportKind; items: any[]; mode: JsonImportMode };
        const existing = kind === 'models' ? this.customModels : this.configurations;
        const byKey = new Map<string, any>(existing.map(item => [this.importKey(item, kind), item]));
        const incomingKeys = new Set(items.map(item => this.importKey(item, kind)));
        const added = items.filter(item => !byKey.has(this.importKey(item, kind)));
        const entries = items.map(item => {
            const key = this.importKey(item, kind);
            const previous = byKey.get(key);
            const operation = !previous ? 'Added' : this.fingerprint(previous) === this.fingerprint(item) ? 'Duplicate' : 'Conflict';
            return { key, operation, reason: operation === 'Conflict' ?
                (kind === 'models' ? 'Saved model versions are immutable. Import a new version.' :
                    mode === 'merge' ? 'Same configuration ID has different content; existing data will be kept.' :
                        'Same configuration ID has different content; imported data will overwrite it.') : '' };
        });
        const conflicts = entries.filter(entry => entry.operation === 'Conflict').length;
        const deleted = mode === 'replace' ? existing.filter(item => !incomingKeys.has(this.importKey(item, kind))) : [];
        const next = mode === 'replace' ? items : mode === 'overwrite' ?
            [...existing.map(item => items.find(incoming => this.importKey(incoming, kind) === this.importKey(item, kind)) || item), ...added] :
            [...existing, ...added];
        this.jsonImport.plan = { next, entries: [...entries, ...deleted.map(item => ({
            key: this.importKey(item, kind), operation: 'Deleted', reason: 'Missing from the replacement file.'
        }))], added: added.length, duplicates: entries.filter(entry => entry.operation === 'Duplicate').length,
            conflicts, deleted: deleted.length, blocked: kind === 'models' && mode !== 'merge' && conflicts > 0 };
    }

    cancelJsonImport() {
        if (!this.busy) this.jsonImport = null;
    }

    confirmJsonImport() {
        if (this.busy || !this.jsonImport || this.jsonImport.plan.blocked) return;
        const { kind, mode, plan, baseline, expectedHash } = this.jsonImport;
        const existing = kind === 'models' ? this.customModels : this.configurations;
        const hash = kind === 'models' ? this.modelHash : this.configurationHash;
        if (baseline !== this.fingerprint(existing) || expectedHash !== hash) {
            this.error = 'Saved data changed after the import preview. Cancel and import again.';
            return;
        }
        if (kind === 'configurations' && !this.confirmLeaveConfiguration('import configurations')) return;
        if (!window.confirm(`Confirm JSON ${mode} import: ${plan.added} added, ${plan.duplicates} duplicates, ${plan.conflicts} conflicts (${mode === 'merge' ? 'kept existing' : 'overwritten'}), ${plan.deleted} deleted?`)) return;
        if (kind === 'models') {
            this.persistModels(plan.next, () => { this.jsonImport = null; });
        } else {
            this.persistConfigurations(plan.next, () => {
                this.jsonImport = null;
                this.loadConfiguration(null);
            });
        }
    }

    private download(data: any, filename: string) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
    }
    exportConfigurations(scope: 'current' | 'selected' | 'all') {
        const configurations = scope === 'current' ? (this.draft ? [JSON.parse(JSON.stringify(this.draft))] : []) :
            scope === 'selected' ? this.configurations.filter(item => this.selectedTasks[item.id]) : this.configurations;
        if (scope === 'current' && configurations[0] && !configurations[0].id) {
            configurations[0].id = 'cfg_' + Math.random().toString(36).slice(2, 11);
            this.draft.id = configurations[0].id;
            this.selectedConfigurationId = configurations[0].id;
            this.invalidateConfiguration();
        }
        this.download({ schemaVersion: 2, draft: scope === 'current' && !this.configSaved, configurations },
            'plc-configurations-' + scope + '.json');
    }
    exportJson(kind: JsonImportKind) {
        this.download({ schemaVersion: 2, [kind]: kind === 'models' ? this.customModels : this.configurations },
            'plc-tag-generator-' + kind + '.json');
    }
    exportSelectedModel() {
        if (this.modelDraft) {
            if (!this.syncModelType()) return;
            this.download({ schemaVersion: 2, draft: this.modelDirty, models: [this.modelDraft] }, 'plc-model.json');
        }
    }
    downloadExample(kind: JsonImportKind) {
        const example = kind === 'models' ? { schemaVersion: 2, name: 'Pump', version: '1.0.0',
            rootType: 'ST_Pump', types: { ST_Pump: { Running: 'BOOL', Speed: 'REAL' } },
            profiles: {}, memberDefaults: { Speed: { daq: { enabled: true, interval: 10, changed: true, restored: false } } } } :
            { schemaVersion: 2, id: 'cfg_example', name: 'Start', deviceId: this.adsDevices[0]?.id || 'ADS_DEVICE_ID',
                tagPrefix: 'Start', adsSymbol: 'GVL.bStart', valueKind: 'primitive', plcType: 'BOOL', array: { mode: 'scalar' } };
        this.download({ schemaVersion: 2, [kind]: [example] }, 'plc-example-' + kind + '.json');
    }

    deviceName(id: string): string {
        return this.adsDevices.find(device => device.id === id)?.name || id;
    }

    apply() {
        if (this.busy || !this.configSaved ||
            !this.previewResult || this.previewResult.summary.conflicts ||
            !window.confirm(`Apply ${this.previewResult.summary.created} new Tag definitions to this FUXA project?` +
                (this.previewResult.rows?.some(tag => tag.daq?.restored) ?
                    ' Restore is enabled: native restoration on device start may write stored values to the PLC.' : ''))) return;
        this.busy = true;
        this.http.post<any>(this.api + '/apply', { token: this.previewResult.token, confirmed: true }).subscribe({
            next: result => {
                this.projectService.onRefreshProject();
                if (result.runtime?.status === 'failed') {
                    this.error = `Tags were saved, but the runtime device reload failed: ${result.runtime.message}. Preview again after checking the device.`;
                    this.previewResult = null;
                    this.reloadModels();
                    this.reloadConfigurations();
                    this.busy = false;
                } else if (result.persistence === 'committed' && result.runtime?.status === 'updated') {
                    if (this.modelDirty) {
                        this.notice = 'Tags committed and runtime updated. Your unsaved model draft remains open.';
                        this.previewResult = null;
                        this.busy = false;
                        this.reloadModels();
                        this.reloadConfigurations();
                    } else this.dialogRef.close(true);
                } else {
                    this.error = 'Apply returned an unknown outcome. Refresh the project before retrying.';
                    this.previewResult = null;
                    this.busy = false;
                }
            },
            error: error => { this.showError(error); this.previewResult = null; this.busy = false; }
        });
    }

    private showError(error: any) {
        this.error = error?.error?.message || error?.message || String(error);
    }
}
