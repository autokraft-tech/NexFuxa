# Phase 4A.1 — Widget prefix binding

Prefix binding is optional. Existing Widgets continue using their manual `varsToBind` configuration. No database migration, Tag rename, ADS address inference, Tag creation or PLC write is involved.

## Data and execution

An SVG carries its portable profile in a non-executable metadata element:

```xml
<metadata data-fuxa-binding-profile="1"><![CDATA[
{"version":1,"bindings":{"_pb_extended":"{#1}_sts_extended"}}
]]></metadata>
```

`HtmlImageComponent.initElement()` extracts it into `WidgetProperty.bindingProfile` on import. Profiles stay separate from JavaScript names and `putValue()`. The valve declares six read-only status mappings; the generic editor has no valve parameter list. Changing a template in the property dialog changes that instance's profile only.

`WidgetProperty.prefixBinding` stores `{deviceId, parameters: {"#1": "V101"}}`. Absence means Manual. Entering Prefix mode snapshots manual values in `manualBindings`; returning to Manual restores them. Parameters outside the profile, such as the valve label, remain editable manually.

`WidgetBindingResolver` is a pure reusable helper with no Angular or transport dependency. It expands numbered placeholders, matches exact case-sensitive Tag names inside the selected Device ID, checks uniqueness and type, then materializes existing Tag IDs in `varsToBind`. Failed entries lose stale IDs and static fallbacks. Boolean parameters accept `BOOL`, `Bool`, `Boolean` and `boolean`; numeric types are never treated as BOOL implicitly. Missing parameters/devices/Tags, ambiguous matches, incompatible types and invalid profiles produce explicit preview errors. Disabled/offline devices do not turn otherwise valid bindings into configuration errors.

The existing `ProjectService.setView[Async]` → project storage path saves the optional fields as part of View items. At runtime `FuxaViewComponent.loadWatch()` resolves again against current project Tags **before** gauge initialization and subscription. The existing `HtmlImageComponent.getSignals()` → `GaugesManager.bindGauge()` → `HmiService` subscription map receives real IDs. Updates return through `HtmlImageComponent.processValue()` to `putValue()`. Multiple SVG parameters may receive one Tag's update. Prefix mode does not install the script `postValue` bridge.

Ordinary controls continue using `GaugeProperty.variableId`; Shapes collect their existing action/range signals through `ShapesComponent`. Scripted SVG Widgets export `_pb_`, `_pn_`, `_ps_`, `_pc_` variables through `SvgUtils.processWidget()` into `varsToBind`. Only Widgets with explicit `prefixBinding` enter the new resolver path; neither Shapes nor ordinary controls acquire a new transport or naming convention.

Saved/copied SVG instances receive fresh DOM IDs and script module IDs. Reinitialization replaces suffixes instead of growing them, updates SVG references, stores matching SVG/script content, removes temporary script elements, and releases the previous module attached to the same container. No second ADS connection or new binding registry exists.

Device/server disconnection invalidates received prefix values; the valve returns to WAITING FOR DATA instead of retaining a normal indication. Existing FAULT/CONFLICT priority remains conservative. A fresh complete set of valid BOOL values restores state. The editor separately shows server connection, PLC status or disabled-device information.

## Phase 3B naming

`tools/plc-device-model/generator.cjs` combines prefix, actual array indices and member suffix. The built-in Valve model uses `sts_extended`, `sts_retracted`, `sts_extending`, `sts_retracting`, `sts_error`, `sts_is_manual_mode`. Custom model/configuration aliases may produce other names: edit the instance's Tag template to match the actual saved names. A full prefix such as `V105_1_5` is accepted unchanged. Lookup never calls Generator Apply and never changes Tag IDs, names, address, DAQ or descriptions.

## Validation commands

From the repository root:

```powershell
node --test tools/plc-device-model/test/phase3a.test.cjs tools/plc-device-model/test/phase3b.test.cjs tools/plc-device-model/test/phase3b1.test.cjs tools/plc-device-model/test/phase3b1-manager.test.cjs
```

From `client`:

```powershell
npm run test:widget-binding
npm run test:scripts
node --test test/plc-device-models-race.test.cjs
npm run build -- --configuration production --output-path <temporary-client-directory>
# Requires Python Playwright with Chromium and the server dependencies installed.
$env:FUXA_TEST_CLIENT_DIST = '<temporary-client-directory>'
python test/widget-prefix-e2e.py
node test/widget-prefix-docker.cjs <local-fuxa-image>
```

From `server`: `npm test` and `npm run build`. Build artifacts are excluded from this feature's commit; the client output can be directed outside the checkout.

The Node suite covers parameter substitution (including multiple parameters and array prefixes), exact lookup, all error classes, BOOL variants, offline/configuration separation, Manual regression/restoration, JSON round trips, real SVG compiler/runtime routing, shared-Tag fanout, DOM references, existing cross-View map behavior, and SQLite persistence in separate processes. The original valve suite checks geometry/license, state priorities, unknown values and independent script instances.

The browser suite starts a real server with a fresh temporary SQLite project, loads the production Angular client and injects fixture device events into the **test process only**. It exercises Socket.IO/HmiService, two identical saved SVGs, DOM ID isolation, state/fault updates, disconnection, reopen and the actual property dialog. These are fixture tests, not TwinCAT online tests. The Docker driver creates a randomly named volume, verifies saved Widget/Tag definitions in two separate containers without network, and removes only that volume and its own temporary fixture directory. Testing with an existing image validates its storage compatibility, not a newly packaged application image.

## Manual acceptance in the Docker editor

1. Build/run the reviewed feature in a separately approved development environment. Back up the selected test project using the existing workflow. This change does not redeploy the current development container.
2. Confirm that the chosen ADS device already contains the six V101 status Tags and six V102 status Tags. Inspect their actual names, types and IDs; do not apply or rename generated Tags for this test.
3. Import the updated `custom/widgets/valves/NexPlc_Valve.svg` through the Widget library, then place two instances in one View. Existing saved valve copies without profile metadata require reimporting this updated asset; no project-wide template migration is performed.
4. Open instance A's Properties. Select Prefix Binding, the ADS device and `#1 = V101`. Validate: all six entries should show Bound, BOOL-compatible types and real Tag IDs. Set the separate static label to V101 if desired. Repeat for B with V102.
5. If names differ, edit the matching Tag templates. Test an incorrect prefix and observe Missing Tag; restore the correct value. Wrong device/type must remain an explicit error, without fallback. An offline PLC may still have all six bindings configured correctly.
6. Confirm the dialogs, save the View/project and open runtime. Until all valid data arrive, expect WAITING FOR DATA. From an independently authorized PLC/test fixture, change V101 status and confirm V102 does not change; repeat in the other direction. Check FAULT, CONFLICT, EXTENDING, RETRACTING and operating mode. This feature sends no PLC commands.
7. Reopen the View and reload the saved project. Reopen each Properties dialog and verify device, prefix, templates and Tag IDs. Restart only an isolated test container and repeat. Delete A from the test View, save/reopen, and verify B still updates.
8. On a separate test copy, enter Prefix mode from an existing Manual Widget, then return to Manual. Verify previous hand-selected IDs/static values are restored. Check an unrelated legacy Widget and ordinary Shape.

## Limits and follow-up

- Same-View Widgets are isolated. Concurrent renderings of the **same View** in multiple Faceplates are not fully isolated: `FuxaViewComponent.loadHmi()` normally uses `view.id`, `GaugesManager.bindGauge()` registers under that ID, and `HmiService.ViewSignalGaugeMap.remove(domViewId)` deletes its entire bucket. The test `existing View ID map reproduces cross-View-instance teardown limitation` registers two contexts under one View ID, removes one and observes both mappings disappear. Phase 4B needs distinct rendering contexts plus DOM/event/subscription ownership, not a prefix resolver change.
- Profiles and configuration are snapshots per Widget instance. No global template synchronization, versions, Faceplate parameter propagation, bulk screen generation or PLC command interface is implemented.
- Communication status uses existing server status events. No new liveness timer or ADS health probe is added. Real ADS reconnect timing, PLC fault/motion behavior and deployed editor acceptance require online manual confirmation.
- Binding failures are detailed in Properties and logged with Widget/parameter at runtime; the valve remains waiting for incomplete data. Runtime has no dedicated error overlay.
- Fresh module names prevent state sharing; full lifecycle disposal of arbitrary legacy Widget timers and all cross-Faceplate script resources remains outside this phase.

## Implementation files

| File | Purpose |
| --- | --- |
| `client/src/app/_helpers/widget-binding.ts` | Profile/configuration contracts, substitution, exact lookup and validation |
| `client/src/app/_models/hmi.ts` | Optional instance fields; existing View persistence requires no schema change |
| `client/src/app/gauges/gauge-property/flex-widget-property/*` | Material mode/device/parameter editor, editable templates and preview |
| `client/src/app/fuxa-view/fuxa-view.component.ts` | Resolve before subscription; invalidate on communication loss |
| `client/src/app/_services/hmi.service.ts` | Cache existing device-status events for communication display |
| `client/src/app/gauges/controls/html-image/html-image.component.ts` | Metadata import, per-instance script/DOM identity, read-only prefix bridge and update fanout |
| `client/src/app/_helpers/svg-utils.ts` | Stable instance suffix replacement and SVG references |
| `custom/widgets/valves/NexPlc_Valve.svg`, `README.md` | Six status templates and invalid-data handling; retained geometry/license |
| `client/test/widget-prefix-*`, `client/package.json`, `.github/workflows/nexfuxa-ci.yml` | Unit, runtime, SQLite, Docker and browser verification plus CI commands |

## Local validation record — 2026-10-15

Host: Windows, Node **24.15.0**, npm **11.12.1**. The existing CI continues to use Node 20/Ubuntu; local results do not assert that CI has already completed.

| Command / check | Result |
| --- | --- |
| Four `tools/plc-device-model/test/phase3*.test.cjs` commands listed above | 38 passing |
| `npm run test:widget-binding` (client) | 24 passing, including 6 original SVG regressions |
| `npm run test:scripts` and `node --test test/plc-device-models-race.test.cjs` (client) | 40 passing total |
| `npm test` (server) | 309 passing |
| `npm run build` (server) | Passed |
| Angular production build with external output path | Passed; hash `e24cfac5961bdf0e` |
| `python test/widget-prefix-e2e.py` against that production output | Passed runtime and actual dialog flows, save/reload, deletion and three viewport checks |
| `node test/widget-prefix-docker.cjs nexfuxa-dev-fuxa:latest` | Seed/reopen passed in two isolated containers; temporary volume removed |
| `git diff --check` | Passed |

The Docker storage check used existing local image `sha256:9269cd6a97e935b69eb01993921b25aa96e36944db13a58435be57cfb0f68f01`. It was not deployed or rebuilt. Angular reports existing `qrcode` CommonJS and unused environment-file warnings. The existing scheduled-script fixture prints a caught mock subscription TypeError while its tests pass. No remaining local test failures; real TwinCAT ADS online acceptance is outstanding.
