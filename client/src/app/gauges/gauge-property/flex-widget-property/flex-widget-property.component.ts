import { Component, Input, OnInit } from '@angular/core';
import { WidgetProperty } from '../../../_models/hmi';
import { ProjectService } from '../../../_services/project.service';
import { SvgUtils } from '../../../_helpers/svg-utils';
import { WidgetBindingResolver, WidgetBindingResult } from '../../../_helpers/widget-binding';
import { HmiService } from '../../../_services/hmi.service';

@Component({
    selector: 'flex-widget-property',
    templateUrl: './flex-widget-property.component.html',
    styleUrls: ['./flex-widget-property.component.scss']
})
export class FlexWidgetPropertyComponent implements OnInit {

    @Input() property: WidgetProperty;
    dataDevices = { devices: []};
    preview: WidgetBindingResult[] = [];

    get isValveSymbol(): boolean { return this.property.svgContent?.includes('data-nexfuxa-valve-symbol'); }

    setSymbolVariant(symbolVariant: 'compact' | 'standard' | 'detailed') {
        this.property.layout = { symbolVariant };
    }

    setSymbolMetadata(key: 'label' | 'description' | 'direction', value: string | number) {
        this.property.componentUi ||= {};
        this.property.componentUi.metadata ||= {};
        Object.assign(this.property.componentUi.metadata, { [key]: value });
    }

    constructor(private projectService: ProjectService, public hmiService: HmiService) {
        this.dataDevices = {
            devices: Object.values(this.projectService.getDevices())
        };
    }

    ngOnInit() {
        // Populate defaults from SVG script if available
        if (this.property?.varsToBind?.length && this.property?.scriptContent?.content) {
            this.property.varsToBind = SvgUtils.populateDefaults(
                this.property.scriptContent.content,
                this.property.varsToBind
            );
        }
        if (this.property.prefixBinding || this.property.inheritFaceplateBinding) this.validateBindings();
        this.hmiService.askDeviceStatus();
    }

    get parameterKeys(): string[] {
        const expressions = Object.values(this.property.bindingProfile?.bindings || {}).join(' ');
        return Array.from(new Set(Array.from(expressions.matchAll(/\{(#[1-9]\d*)\}/g), match => match[1])));
    }

    setMode(prefix: boolean | 'inherit') {
        if (prefix) {
            if (!this.property.prefixBinding && !this.property.inheritFaceplateBinding) {
                this.property.manualBindings = JSON.parse(JSON.stringify(this.property.varsToBind || []));
            }
            if (prefix === 'inherit') {
                this.property.inheritFaceplateBinding = true;
                delete this.property.prefixBinding;
            } else {
                delete this.property.inheritFaceplateBinding;
                this.property.prefixBinding = { deviceId: '', parameters: { '#1': '' } };
            }
            this.validateBindings();
        } else {
            this.property.varsToBind = this.property.manualBindings || this.property.varsToBind;
            delete this.property.manualBindings;
            delete this.property.prefixBinding;
            delete this.property.inheritFaceplateBinding;
            this.preview = [];
        }
    }

    validateBindings() {
        if (this.property.inheritFaceplateBinding) {
            WidgetBindingResolver.apply(this.property, Object.values(this.projectService.getDevices()));
            this.preview = [];
            return;
        }
        this.preview = WidgetBindingResolver.apply(this.property, Object.values(this.projectService.getDevices()));
    }

    get communicationStatus(): string {
        const device = this.dataDevices.devices.find(item => item.id === this.property.prefixBinding?.deviceId);
        if (!device) return 'Communication: no PLC selected';
        if (!device.enabled) return 'Communication: PLC disabled (binding lookup remains available)';
        if (!this.hmiService.onServerConnection$.value) return 'Communication: server disconnected';
        return `Communication: ${this.hmiService.deviceStatuses[device.id] || 'unknown / waiting for PLC status'}`;
    }
}
