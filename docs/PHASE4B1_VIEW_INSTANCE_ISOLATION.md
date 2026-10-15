# Phase 4B.1 — View instance isolation

## Root cause and regression

Baseline: `153f2d1a` (Phase 4A.1, PR #6). `FuxaViewComponent.loadResolvedHmi()` assigned the persisted View ID to every renderer. `bindGauge()`/`unbindGauge()` used that ID, so closing A removed the shared signal registry containing B. Manager caches also used definition Gauge IDs, and global SVG lookup could select or update another renderer's node. The View subscription setter replaced one global array. Widget script injection declared a top-level `var`, which made its global property non-configurable and retained module state after close.

The first new regression loads the same definition twice through the real component method and removes A. Before the fix, the assertion failed with B's registry missing (`undefined`). It now passes. The Phase 4A.1 test demonstrating why definition IDs cannot be ownership keys remains a historical lower-level test, not a test of the corrected renderer.

## Runtime architecture

`ViewRuntimeContext` owns one render generation:

- `viewDefinitionId` is the persisted View ID, used for navigation, lookup and configuration.
- `viewInstanceId` is a monotonically allocated ID in this browser runtime. Reloading a renderer allocates another context.
- `view` is a deep runtime clone; its `id` stays the definition ID. Gauge IDs and the items dictionary keys reference actual namespaced DOM IDs.
- `ids` maps original DOM IDs to runtime IDs, preserving control prefixes required by existing controls.
- Context cleanups and tracked UI timers belong to that render only.

No schema migration, Tag identity change, ADS address change, new driver connection, PLC command, or project migration is introduced. The existing widget asset is reused unchanged in fixtures.

The component keeps its public `id` semantics for compatibility; registration, value lookup and teardown use `viewInstanceId`. A generation token rejects late lazy-load and popup results after replacement or destruction. Page navigation and Home navigation reject superseded requests. Panels construct the same component and therefore get the same ownership rules. Panel mouse events execute in the panel's context.

## Gauge registries and subscriptions

Actual runtime Gauge IDs key `memorySigGauges`, `eventGauge`, `mapGaugeView`, `mapGauges`, `mapChart` and `mapTable`. Chart/table DAQ correlation continues to use the control's ID, which is now unique, while saved chart configuration IDs retain their meaning. uPlot's generated DOM ID also uses the runtime control ID instead of the shared chart name. The manager records all Gauge IDs owned by each renderer, including controls without signal/event bindings. Teardown removes only those entries and destroys their dynamic component references once.

Server protocol inspection: `server/runtime/index.js` assigns `socket.tagsClientSubscriptions = message.tagsId`; subscribe is a **full replacement**, and unsubscribe currently does nothing. `HmiService` stores `owner → Tag[]`, merges every owner with Home, resolves device adapter IDs, deduplicates and sends a replacement. Releasing A preserves B's shared Tags. Reconnect uses the same complete union. Maps, schedulers and the editor device list also allocate owners and release them on destruction, avoiding a leftover global consumer. Home's existing subscription source remains included. DAQ and alarm protocols are unchanged.

## DOM, SVG and scripts

The runtime clone receives namespaced DOM IDs. Fragment href/xlink:href, `url(#...)`, style ID references, label and ARIA ID references follow the map. Event panel targets and input lookup use mapped IDs; arbitrary view/script/tag parameters are not globally rewritten. Runtime value/event lookup stays inside the renderer root. Existing control factories can retain `document.getElementById()` because their supplied Gauge IDs are globally unique.

`HtmlImageComponent` retains the Phase 4A.1 per-widget SVG ID/module mapping. Script injection wraps generated code in a function so its module declaration does not create a permanent top-level global. Teardown invokes an optional module `destroy()` and removes its window export. View-owned dialogs, nested cards, delayed UI callbacks, dynamic components and SVG event bindings are released with their owner.

View-triggered client scripts execute with an invocation-specific ScriptService receiver carrying the originating instance ID. `$getObject()` and `$invokeObject()` resolve names only within that instance, including after `await`; a destroyed instance returns no object and never falls back to a sibling. Scheduled/global scripts retain their existing global lookup semantics. The browser fixture runs an asynchronous client script against two identically named Chart controls and checks only the initiating chart changes.

Supported scope: FUXA-generated widget modules and existing controls. An arbitrary custom script can deliberately access globals, create timers/observers or register listeners elsewhere; those resources require the script's own `destroy()` hook. This change does not sandbox arbitrary JavaScript or isolate shared server-side script state. Scripts directly querying saved Gauge DOM IDs outside the supported Widget compiler must use the current runtime context/mapped ID. Inspect such legacy scripts before rollout.

## Verification

Principal source changes:

| File under `client/src/app` | Responsibility |
| --- | --- |
| `_helpers/view-runtime-context.ts` | Runtime identity, cloned definition, DOM/SVG reference map, script modules and UI timers |
| `fuxa-view/fuxa-view.component.ts` / `.html` | Registration, root-scoped lookup, binding mapping, navigation races and child ownership |
| `gauges/gauges.component.ts` | Per-instance Gauge ownership, teardown, scoped script object lookup and unique uPlot IDs |
| `_services/hmi.service.ts` | Consumer subscription union, release and reconnect replay |
| `_services/script.service.ts` | Per-invocation client script receiver and HTTP subscription teardown |
| `gauges/controls/html-image/html-image.component.ts` | Function-scoped Widget injection |
| `home/home.component.ts` | Navigation race guard and header Tag release |
| `maps/maps-view`, `device/device-list`, `gauges/controls/html-scheduler/scheduler` | Independent subscription owners and release, including empty Tag lists |

The new `client/test/view-instance*` fixtures/suites and `.github/workflows/nexfuxa-ci.yml` keep this regression in CI. The existing prefix browser harness gains isolated fixture/lazy-loading options and waits for the actual editor import tool before placement.

Run from the repository root after installing client/server dependencies:

```powershell
node --test client/test/view-instance.test.cjs
node --test client/test/widget-prefix-binding.test.cjs custom/widgets/valves/NexPlc_Valve.test.cjs
node --test tools/plc-device-model/test/phase3a.test.cjs tools/plc-device-model/test/phase3b.test.cjs tools/plc-device-model/test/phase3b1.test.cjs tools/plc-device-model/test/phase3b1-manager.test.cjs client/test/home-scheduled-scripts.test.cjs client/test/plc-device-models-race.test.cjs
npm test --prefix server
npm run build --prefix server
npm run build --prefix client -- --configuration production
python client/test/view-instance-e2e.py
python client/test/widget-prefix-e2e.py
```

`FUXA_TEST_CLIENT_DIST` can point both browser tests to a separate production-build output directory. The browser harness seeds a temporary SQLite project, disables ADS and Node-RED, binds localhost on an ephemeral port, and terminates only its own server. It never opens `.local/fuxa-dev` or an existing Docker volume. Phase 4B.1 uses `broadcastAll=false`, actual Angular components and real Socket.IO filtering; it also closes the underlying Socket.IO transport to exercise reconnect.

Coverage includes two Dialogs, two Cards from distinct triggers, duplicate-trigger prevention, mixed Dialog/Card, embedded Panel, mapped different/shared Tags, closing either order, reopen, independent SVG/script state, fragment references, and 20 cycles through the view's own Close Gauge event. The fixture also mounts HTML Input, Chart and Table controls. Unit tests cover cache teardown including signal-free controls, Home union retention, final-owner release, lazy-load destruction and out-of-order navigation.

The browser test enables real lazy-view loading and holds the HTTP response for an Open Dialog action, navigates the originating render to another definition, then releases the response. It checks the stale Dialog never opens and the new main View still updates. HTML Input values are checked independently, and configured charts share a saved chart definition with mapped feedback while receiving separate DOM IDs. Real historical DAQ queries and scheduler/recipe controls are additional manual acceptance items.

Lifecycle measurements compare mounted view count, DOM node count, active module count, total module global keys and explicitly registered native SVG listener count with the warmed baseline. The fixture server asserts the final real Tag subscription union contains no fixture Tags after closing consumers. These are ownership/leak regression checks, not a general browser heap benchmark or proof about arbitrary custom script timers. Tests also compare SQLite project definitions and device/Tag configuration before/after runtime use.

Screenshot evidence is written to the system temporary directory as `nexfuxa-view-instance.png`, `nexfuxa-prefix-property.png` and `nexfuxa-prefix-editor.png`. CI runs the new unit and browser suites after the existing production build and Phase 4A.1 suites.

Local verification on 2026-10-15:

| Check | Result |
| --- | --- |
| Combined View/Widget/PLC model/Home/client race tests | 112 passed, 0 failed |
| Server Mocha suite | 309 passed |
| Server TypeScript build | Passed |
| Angular production build | Passed; existing unused-environment/CommonJS warnings |
| Phase 4B.1 production-browser integration | Passed, filtered Socket.IO and lazy SQLite-backed views |
| Phase 4A.1 complete browser/editor integration | Passed, including save/reload and three viewport sizes |
| 20-cycle mounted View/module/global-module-key/SVG-listener/DOM-ID counts | Before = after: **2 / 1 / 1 / 20 / 45** |
| Final server fixture Tag subscription union | Empty after mapped instances close; remaining Panel placeholder subscriptions are unaffected |
| Runtime configuration persistence | View, device/Tag, Chart and Script definitions unchanged |

`nexfuxa-view-instance-dialogs.png` additionally captures concurrent Dialogs and the scoped Chart script result. No real TwinCAT connection, production Docker deployment or general heap benchmark was performed.

The CI client job uploads these screenshots as `view-instance-browser-evidence` with 14-day retention.

## Docker + TwinCAT manual acceptance

Use a development build of the PR in a separately provisioned test environment. Preserve existing runtime data/volumes; do not replace production Compose or migrate its database.

1. In a test project, create `Valve.Faceplate.Test` using the existing approved NexPlc valve Widget, Manual Binding placeholders for all six BOOL inputs, and a label. Keep ADS writes disabled; use an independent test PLC or existing safe feedback simulator.
2. Configure two host buttons opening that definition with existing `variablesMapping`: A maps to V101 feedback, B maps to V102. Retain `sourceDeviceId` if your current configuration uses it. Open both Dialogs and check each shows its own label/status.
3. Change feedback on the independent test PLC: V101 affects A only, V102 affects B only. Test all six BOOL validity inputs, FAULT priority and conflicting feedback. Repeat with both instances mapped to V101.
4. Close A, update B, reopen A, then close B and update A. Repeat 20 times. Check for duplicate events, stale windows, continuously increasing modules/listeners or missing updates.
5. Repeat with two Cards from different buttons, then Dialog + Card and a Panel. Confirm the same button cannot create duplicate Cards and `singleCard` retains its existing visible behavior. Check nested Panel events target their own controls.
6. Include input/output, chart, table and gauge-associated panel actions from your actual project. Verify DAQ responses update their originating runtime control after another instance closes.
7. Navigate between Views while opening/closing instances; include lazy-loaded Views and a slow connection. A closed/superseded View must not appear later. Switch away with nested Cards/Dialog open and confirm owned children close.
8. Disconnect/reconnect the browser transport, then ADS. Confirm the full remaining subscription union recovers, and Prefix Widgets wait for six valid BOOL values before leaving WAITING FOR DATA.
9. Save/restart/reload the test project. Check persisted View/Gauge IDs, Tag IDs/names/ADS addresses, Manual/Prefix Binding and Phase 3B Tag Generator preview remain unchanged. Do not apply generated Tags to production as part of this acceptance.

Real TwinCAT and Docker deployment acceptance remains manual; fixture/browser results do not certify PLC connectivity or a production deployment. No Phase 4B.2 parameter inheritance, template synchronization/versioning, valve commands or new communication layer is included.
