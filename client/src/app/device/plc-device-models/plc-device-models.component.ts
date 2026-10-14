import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';
import { EndPointApi } from '../../_helpers/endpointapi';
import { ProjectService } from '../../_services/project.service';
import { Device, DeviceType } from '../../_models/device';

interface InstanceRow {
    'Device Name': string;
    'PLC Device ID': string;
    'Device Model': string;
    'Array Symbol': string;
    'Array Indices': string;
    Profile: string;
}

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
    modelEditor = '';
    selectedModel = 'Valve@1.0.0';
    configurations: any[] = [];
    configurationHash = '';
    selectedConfigurationId = '';
    draft: any = null;
    configSaved = false;
    previewMode: 'legacy' | 'configuration' = 'legacy';
    previewSearch = '';
    previewFilter = 'All';
    previewSort = 'name';
    readonly primitiveTypes = ['BOOL', 'INT', 'DINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'STRING'];
    rows: InstanceRow[] = [];
    previewResult: any = null;
    previewDeviceId = '';
    saved = false;
    error = '';
    busy = false;
    jsonImport: any = null;
    private previewVersion = 0;
    private previewRequestId = 0;
    private configurationLoadId = 0;

    constructor(private http: HttpClient, private projectService: ProjectService,
        private dialogRef: MatDialogRef<PlcDeviceModelsComponent>) {
        this.adsDevices = this.projectService.getDeviceList().filter(device => device.type === DeviceType.ADSclient);
        this.previewDeviceId = this.adsDevices[0]?.id || '';
        this.http.get<any[]>(this.api).subscribe({
            next: models => this.models = models,
            error: error => this.showError(error)
        });
        this.reloadModels();
        this.reloadConfigurations();
        const initialVersion = this.previewVersion;
        this.http.get<{ rows: InstanceRow[] }>(this.api + '/instances').subscribe({
            next: result => {
                if (initialVersion !== this.previewVersion) return;
                this.rows = result.rows;
                if (!this.rows.length) this.addRow(); else this.saved = true;
            },
            error: error => this.showError(error)
        });
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
        return model?.leaves || [];
    }

    modelProfiles(): string[] {
        return this.models.find(item => `${item.name}@${item.version}` === this.draft?.model)?.profiles || ['Full'];
    }

    changeValueKind() {
        if (this.draft?.valueKind === 'structure' && !this.draft.model && this.models.length)
            this.draft.model = `${this.models[0].name}@${this.models[0].version}`;
        this.invalidateConfiguration();
    }

    changeStructureModel() {
        if (this.draft) {
            this.draft.profile = 'Full';
            delete this.draft.memberPaths;
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
                    this.previewMode = 'configuration';
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
            (!search || `${row.name} ${row.address} ${row.sourceConfiguration}`.toLowerCase().includes(search)))
            .sort((a, b) => String(a[this.previewSort] || '').localeCompare(String(b[this.previewSort] || '')));
    }

    editModel(name: string) {
        this.selectedModel = name;
        const current = this.customModels.find(item => `${item.name}@${item.version}` === name);
        this.modelEditor = current ? JSON.stringify(current, null, 2) : '';
    }

    newModel() {
        this.selectedModel = '';
        this.modelEditor = JSON.stringify({ schemaVersion: 2, name: 'Pump', version: '1.0.0',
            rootType: 'ST_Pump_HMI', types: { ST_Pump_HMI: { Cmd: 'ST_Pump_Command', Sts: 'ST_Pump_Status' },
                ST_Pump_Command: { Start: 'BOOL', Stop: 'BOOL' },
                ST_Pump_Status: { Running: 'BOOL', Speed: 'REAL', ErrorCode: 'UDINT' } }, profiles: {} }, null, 2);
    }

    copyModel() {
        const current = this.models.find(item => `${item.name}@${item.version}` === this.selectedModel);
        if (!current) return;
        const original = this.customModels.find(item => `${item.name}@${item.version}` === this.selectedModel);
        const copy = original || { schemaVersion: 2, name: current.name, version: current.version,
            rootType: current.rootType, types: current.types, profiles: current.profileDefinitions };
        this.modelEditor = JSON.stringify({ ...copy, name: copy.name + 'Copy', version: '1.0.0' }, null, 2);
        this.selectedModel = '';
    }

    saveModel() {
        if (this.busy) return;
        let candidate: any;
        try { candidate = JSON.parse(this.modelEditor); }
        catch (error) { this.showError(error); return; }
        const next = [...this.customModels.filter(item => `${item.name}@${item.version}` !== `${candidate.name}@${candidate.version}`), candidate];
        this.persistModels(next);
    }

    deleteModel() {
        if (this.busy || !this.selectedModel) return;
        if (!this.customModels.some(item => `${item.name}@${item.version}` === this.selectedModel) ||
            !window.confirm(`Delete custom model "${this.selectedModel}"? Referenced versions cannot be deleted. Existing Tags and Widget bindings will be kept.`)) return;
        this.persistModels(this.customModels.filter(item => `${item.name}@${item.version}` !== this.selectedModel));
    }

    private persistModels(next: any[], done: () => void = () => {}) {
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
        } catch (error) { this.showError(error); }
        finally { this.busy = false; }
    }

    private importKey(item: any, kind: JsonImportKind): string {
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
            (kind === 'models' ? typeof item.name !== 'string' || !item.name ||
                typeof item.version !== 'string' || !item.version : typeof item.id !== 'string' || !item.id)) {
            throw new Error('Every imported item requires a valid identity');
        }
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

    exportJson(kind: 'models' | 'configurations') {
        const data = { schemaVersion: 2, [kind]: kind === 'models' ? this.customModels : this.configurations };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `plc-tag-generator-${kind}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    addRow() {
        this.rows.push({ 'Device Name': '', 'PLC Device ID': this.adsDevices[0]?.id || '',
            'Device Model': 'Valve@1.0.0', 'Array Symbol': 'GVL.g_aValve_HMI',
            'Array Indices': '', Profile: 'Full' });
        this.invalidate();
    }

    removeRow(index: number) {
        this.rows.splice(index, 1);
        this.invalidate();
    }

    invalidate() {
        this.previewVersion++;
        this.previewResult = null;
        this.saved = false;
        this.error = '';
    }

    save() {
        if (this.busy) return;
        this.busy = true;
        this.previewVersion++;
        this.previewResult = null;
        const rows = JSON.parse(JSON.stringify(this.rows));
        this.http.post(this.api + '/instances', { rows }).subscribe({
            next: () => {
                this.saved = JSON.stringify(this.rows) === JSON.stringify(rows);
                this.projectService.onRefreshProject();
                this.reloadModels();
                this.reloadConfigurations();
                this.busy = false;
            },
            error: error => { this.showError(error); this.busy = false; }
        });
    }

    deviceName(id: string): string {
        return this.adsDevices.find(device => device.id === id)?.name || id;
    }

    groupCount(model: any, group: string): number {
        return model.leaves.filter(leaf => leaf.path.startsWith(group + '.')).length;
    }

    importCsv(event: Event) {
        if (this.busy) return;
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (file.size > 65536) { this.error = 'CSV exceeds 64 KB'; return; }
        this.busy = true;
        file.text().then(csv => {
            this.http.post<{ rows: InstanceRow[] }>(this.api + '/csv', { csv }).subscribe({
                next: result => { this.rows = result.rows; this.invalidate(); this.busy = false; },
                error: error => { this.showError(error); this.busy = false; }
            });
        }).catch(error => { this.showError(error); this.busy = false; });
    }

    exportCsv() {
        const columns = ['Device Name', 'PLC Device ID', 'Device Model', 'Array Symbol', 'Array Indices', 'Profile'];
        const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
        const csv = [columns.join(','), ...this.rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\r\n') + '\r\n';
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plc-device-model-instances.csv';
        link.click();
        URL.revokeObjectURL(url);
    }

    preview() {
        if (this.busy || !this.saved || !this.rows.length) return;
        this.busy = true;
        this.error = '';
        this.previewResult = null;
        const version = ++this.previewVersion;
        const requestId = ++this.previewRequestId;
        const snapshot = JSON.stringify(this.rows);
        const deviceId = this.previewDeviceId;
        const rows = this.rows.filter(row => row['PLC Device ID'] === this.previewDeviceId);
        this.http.post<any>(this.api + '/preview', { rows }).subscribe({
            next: result => {
                if (version === this.previewVersion) {
                    if (this.saved && deviceId === this.previewDeviceId && snapshot === JSON.stringify(this.rows)) {
                        this.previewMode = 'legacy';
                        this.previewResult = result;
                    }
                }
                if (requestId === this.previewRequestId) this.busy = false;
            },
            error: error => {
                if (version === this.previewVersion) this.showError(error);
                if (requestId === this.previewRequestId) this.busy = false;
            }
        });
    }

    changePreviewDevice() {
        this.previewVersion++;
        this.previewResult = null;
    }

    apply() {
        if (this.busy || (this.previewMode === 'legacy' ? !this.saved : !this.configSaved) ||
            !this.previewResult || this.previewResult.summary.conflicts ||
            !window.confirm(`Apply ${this.previewResult.summary.created} new Tag definitions to this FUXA project?`)) return;
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
                    this.dialogRef.close(true);
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
