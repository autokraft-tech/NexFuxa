## NexFuxa documentation

Start with the [installation guide](Installing-and-Running.md) and [getting started](Getting-Started.md). NexFuxa customizations use these maintained sources:

| Scope | Authoritative guide |
| --- | --- |
| Branches, upstream synchronization, CI, releases and artifact review | [Git workflow](GIT_WORKFLOW.md) |
| ADS models, Tag naming, Preview/Apply, persistence and Restore suppression | [PLC Device Model / Tag Generator](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/tools/plc-device-model/README.md) |
| Widget Prefix binding | [Widgets](HowTo-Widgets.md#prefix-binding) |
| Faceplate inheritance and concurrent View isolation | [Reusable Views](HowTo-use-same-view.md#faceplate-prefix-inheritance) |
| Valve assets, current read-only Symbol runtime and development Docker data | [Valve guide](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/custom/widgets/valves/README.md) |
| Frozen Component UI design requirements and capability boundaries | [Component UI specification index](component-ui/README.md) |
| Equipment geometry reuse and licensing | [SVG reuse policy](SVG_REUSE_POLICY.md) |
| Camera and marker-based Views | [AR mode](ar-mode.md) |

The Component UI specifications describe the frozen design baseline; the Valve guide describes the delivered read-only Symbol. Native Faceplate commands/configuration writes and alarm adapters remain future implementation work. Development reports and test output belong in ignored `_reports/`, not this knowledge base.

## FUXA overview

FUXA is a powerful **web-based** software to rapidly build and deploy scalable SCADA, HMI, Dashboard or IIoT systems. With FUXA you can create modern process visualizations with individual designs for your machines and real-time data display, as well as control instrument of automated industrial plants.

![](images/fuxa-editor.png)

FUXA supports commonly used communication standards such as Siemens S7 protocol and OPC UA that allow to connect third-party OPC servers. The list of supported  communication standards can be extended by developing additional drivers.

The software model of FUXA is based on a Node.js runtime that you point a web browser at to access the editor to create your app (SCADA/HMI/Dashboard) and as client you can run your visualizations.

## User Interface

FUXA is composed from two differents views: FUXA-editor to edit the project and FUXA-view to show the product of your visualization project.

![](images/fuxa-home.png)

## Features

The FUXA not require any runtime licenses. You can build your HMI projects in any number and size and you do not need to worry about further licensing the runtime environment.

### Communication Protocols
The FUXA Platform includes connectors to achieve direct communications to Siemens PLCs and OPC UA data sources:
- A client for OPC UA connectivity.
- S7 Protocol to communicate over Ethernet with Siemens CPU 200, 300, 400, 1200, and 1500.
- Modbus RTU/TCP, BACnet IP, MQTT, Ethernet/IP (Allen Bradley), WebAPI

### Cross-Platform Full-Stack
This system is designed to operate in various operating systems, with easy installation. Backend is develop with NodeJs. The user-interface is a scalable HTML5 web frontend, develop with Web technologies (HTML5, CSS, Javascript, Angular, SVG) and compatible with all recent browsers.