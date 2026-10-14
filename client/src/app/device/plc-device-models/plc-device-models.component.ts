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

@Component({
    selector: 'app-plc-device-models',
    templateUrl: './plc-device-models.component.html',
    styleUrls: ['./plc-device-models.component.scss']
})
export class PlcDeviceModelsComponent {
    private readonly api = EndPointApi.getURL() + '/api/plc-device-models';
    readonly adsDevices: Device[];
    models: any[] = [];
    rows: InstanceRow[] = [];
    previewResult: any = null;
    previewDeviceId = '';
    saved = true;
    error = '';
    busy = false;

    constructor(private http: HttpClient, private projectService: ProjectService,
        private dialogRef: MatDialogRef<PlcDeviceModelsComponent>) {
        this.adsDevices = this.projectService.getDeviceList().filter(device => device.type === DeviceType.ADSclient);
        this.previewDeviceId = this.adsDevices[0]?.id || '';
        this.http.get<any[]>(this.api).subscribe({
            next: models => this.models = models,
            error: error => this.showError(error)
        });
        this.http.get<{ rows: InstanceRow[] }>(this.api + '/instances').subscribe({
            next: result => { this.rows = result.rows; if (!this.rows.length) this.addRow(); else this.saved = true; },
            error: error => this.showError(error)
        });
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
        this.previewResult = null;
        this.saved = false;
        this.error = '';
    }

    save() {
        this.busy = true;
        const rows = JSON.parse(JSON.stringify(this.rows));
        this.http.post(this.api + '/instances', { rows }).subscribe({
            next: () => {
                this.saved = JSON.stringify(this.rows) === JSON.stringify(rows);
                this.projectService.onRefreshProject();
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
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (file.size > 65536) { this.error = 'CSV exceeds 64 KB'; return; }
        file.text().then(csv => {
            this.busy = true;
            this.http.post<{ rows: InstanceRow[] }>(this.api + '/csv', { csv }).subscribe({
                next: result => { this.rows = result.rows; this.invalidate(); this.busy = false; },
                error: error => { this.showError(error); this.busy = false; }
            });
        }).catch(error => this.showError(error));
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
        this.busy = true;
        this.error = '';
        this.previewResult = null;
        const rows = this.rows.filter(row => row['PLC Device ID'] === this.previewDeviceId);
        this.http.post<any>(this.api + '/preview', { rows }).subscribe({
            next: result => { this.previewResult = result; this.busy = false; },
            error: error => { this.showError(error); this.busy = false; }
        });
    }

    apply() {
        if (!this.previewResult || this.previewResult.summary.conflicts ||
            !window.confirm(`Apply ${this.previewResult.summary.created} new Tag definitions to this FUXA project?`)) return;
        this.busy = true;
        this.http.post(this.api + '/apply', { token: this.previewResult.token, confirmed: true }).subscribe({
            next: () => { this.projectService.onRefreshProject(); this.dialogRef.close(true); },
            error: error => { this.showError(error); this.previewResult = null; this.busy = false; }
        });
    }

    private showError(error: any) {
        this.error = error?.error?.message || error?.message || String(error);
    }
}
