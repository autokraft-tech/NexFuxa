import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-plc-tag-properties',
    templateUrl: './plc-tag-properties.component.html',
    styles: [':host { display:block; } .fields { display:flex; flex-wrap:wrap; gap:12px; align-items:center; } label { display:flex; gap:6px; align-items:center; margin:8px 0; } input,select { max-width:100%; min-width:0; } .number { width:70px; } .text { width:100%; } small { display:block; opacity:.75; } details { margin-top:8px; }']
})
export class PlcTagPropertiesComponent {
    @Input() properties: any = {};
    @Input() defaults: any = {};
    @Input() disabled = false;
    @Output() edited = new EventEmitter<any>();
    daq(key: string): any {
        return this.properties?.daq?.[key] ?? this.defaults?.daq?.[key] ??
            ({ enabled: false, interval: 60, changed: false, restored: false })[key];
    }
    value(key: string): any { return Object.prototype.hasOwnProperty.call(this.properties || {}, key) ?
        this.properties[key] : this.defaults?.[key] ?? null; }
    setDaq(key: string, value: any) {
        this.edited.emit({ ...this.properties, daq: { ...this.properties?.daq, [key]: value } });
    }
    set(key: string, value: any) { this.edited.emit({ ...this.properties, [key]: value === '' ? null : value }); }
    setScaleMode(mode: string) {
        this.set('scale', mode === 'none' ? null : mode === 'linear' ?
            { mode, rawLow: 0, rawHigh: 100, scaledLow: 0, scaledHigh: 100 } : { mode });
    }
    setScale(key: string, value: any) { this.set('scale', { ...this.value('scale'), [key]: value }); }
}
