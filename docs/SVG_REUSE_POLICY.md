# SVG reuse policy

NexFuxa HMI widgets must reuse suitable existing equipment graphics. The preferred local library is `D:\Will\Documents\source\repos\FUXA-SVG-Widgets`, with valve candidates in `Proc. Engineering\Proc. Eng. Valves`. Inspect the actual files; do not infer filenames from equipment names. Treat this library as read only.

## Mandatory workflow

1. Search the existing library before drawing or implementing equipment geometry. Start in the equipment category, then search related categories if necessary.
2. Identify suitable SVG candidates and record the files actually inspected.
3. Compare their graphical appearance, equipment type, and intended function. For example, a spring-return actuator, double-acting cylinder, and motor actuator convey different equipment functions.
4. Select the most appropriate existing graphic. Check the library license and any asset-specific notices before copying. If permission is absent, unclear, or incompatible with the intended use, do not copy the asset; seek a permitted alternative or clarification.
5. Copy the selected SVG into the appropriate NexFuxa `custom/widgets/<equipment>` directory. Edit this copy only.
6. Preserve the original paths, proportions, topology, and recognizable appearance wherever practical. A uniform scale or translation to fit the widget is preferable to rebuilding its geometry. Do not redraw an equivalent valve, pump, motor, sensor, or other industrial symbol for convenience.
7. Adapt groups, element IDs, colors, and scripts for FUXA. Keep status badges or labels separate from the equipment drawing. Remove or replace source scripts whose parameters, write commands, timers, or global state do not fit the new widget.
8. Connect the copy to the appropriate versioned PLC binding profile. Use existing PLC structures and supported FUXA export parameters and `putValue`; a source asset's generic state parameter does not justify introducing a new PLC state tag. Respect the profile's read/write restrictions.
9. Test XML validity, rendered geometry and layout, FUXA import and bindings, runtime updates, fault priorities, and multiple independent instances. Use unique IDs and the FUXA script module conventions; check inherited SVG styles that can override runtime colors. Keep test projects out of saved development and production runtime data.
10. Document the original asset path, repository and revision where available, source file checksum, selection rationale, modifications, and license or attribution requirements alongside the copied widget. Retain all required notices in distributable assets, including an SVG that users might download separately.

If the search finds no suitable asset with permission for the intended use, report the categories and files searched, why candidates were unsuitable, and proposed alternatives. An original SVG requires explicit user approval before drawing begins.

## Provenance and verification records

Each widget's README should distinguish equipment geometry retained from presentation or script changes. Record the actual local source file, even when a repository revision is also available; do not assume that a local library checkout is clean or that its files match that revision. An unmodified source copy or geometry comparison can support regression checks, but the widget must remain testable without the developer's local library installed.

Rendering tests should cover unknown data, movement, end positions, faults, and operating mode as applicable. Bind at least two instances independently and confirm that updates affect only the intended instance. Prefer temporary browser fixtures or an isolated test environment; do not save tests into an existing FUXA project database. Preserve source library files, PLC source, production Compose, and runtime data during asset adaptation.

The first adaptation under this policy is documented in [the NexPlc valve README](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/custom/widgets/valves/README.md#svg-source-and-adaptation).
