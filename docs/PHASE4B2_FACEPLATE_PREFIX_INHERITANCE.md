# Phase 4B.2 — Faceplate Prefix Parameter Inheritance

## Baseline and scope

PR #7 was verified merged before development. This feature starts from stable `nexfuxa` commit `8126324620d2cfadde99f0da666486aafdfbbaf5` and retains its View instance identity, Gauge/DOM/script isolation, subscription ownership and lazy-load guards. It does not change the ADS driver, PLC program, Tag definitions, database schema, production Compose or runtime volumes.

The implemented binding option applies to SVG Widgets with a Binding Profile. It supports any such Widget geometry, multiple Widgets in one Faceplate, and their static text labels. Ordinary Output/Input/Shape controls retain Manual/Variables Mapping behavior; their extension design is specified below, rather than implying those controls already have an inheritance selector.

## Configuration and user flow

1. In the host View, select a NexPlc Valve Widget. Choose **Prefix Binding**, the PLC Device and **Tag Prefix (#1)**, for example `V101`.
2. In its Events tab, choose Click and **Open Faceplate (Dialog)** or **Open Faceplate (Card)**, with destination `Valve.Faceplate`. These are contextual labels for the existing Open Dialog/Open Card actions; their saved action keys and behavior remain compatible.
3. In the shared Faceplate, set each participating Widget's **Binding Mode** to **Inherit Faceplate Binding**. Its Binding Profile still defines the Tag templates and expected variable types. Non-participating Widgets can remain Manual or fixed Prefix Binding.
4. Copy the host Symbol and change its prefix to `V102`. Both Symbols open the same saved Faceplate definition with different runtime parameters. No Variables Mapping rows are required.

The PLC selector displays a device name such as `TwinCAT_ADS`; `deviceId` is the existing internal FUXA Device ID selected by that control. Lookup uses that exact ID, never an ambiguous device-name or address fallback.

Saved target Widget configuration contains the opt-in flag and its existing profile, for example:

```json
{
  "inheritFaceplateBinding": true,
  "bindingProfile": {
    "version": 1,
    "bindings": { "_pb_extended": "{#1}_sts_extended" }
  }
}
```

The effective device/prefix and resolved Tag IDs are not written into the shared definition. Switching from Prefix to Inherit clears profile-owned resolved IDs/defaults in the editor. Switching back to Manual restores the previous manual-binding snapshot when one exists. Static label variables outside the profile remain editable.

## Runtime parameter context and resolution

`ViewRuntimeContext.faceplateBinding` is the runtime parameter context. It reuses the existing `WidgetPrefixBinding` data contract:

```typescript
{ deviceId: existingDeviceId, parameters: { '#1': 'V101' } }
```

The event handler reads the **clicked runtime Gauge's** effective Prefix Binding, takes a frozen copy and adds it to runtime popup options. Dialog data and Card models pass it to the child View. A second snapshot at the async entry point protects direct API calls whose caller mutates an options object while the View loads. Each new View context owns its own immutable snapshot. No global/current-Faceplate variable is used.

Binding precedence is explicit:

| Widget configuration | Effective binding |
| --- | --- |
| Manual | Existing IDs/static values and Variables Mapping |
| Fixed Prefix Binding | Its own saved device/parameters; ignores the parent context |
| Inherit Faceplate Binding | This View instance's parameter context; never falls back to fixed/manual IDs |

Legacy Variables Mapping is applied as before. An inheriting Widget's profile-owned fields are then resolved from the context, so a stale mapping cannot override inheritance. Other fields and non-inheriting Widgets retain their original behavior. An inheriting Widget can itself open another Faceplate: its runtime effective binding is the source for the next snapshot. Static embedded Panels receive their parent's context through the existing component factory. Ordinary page navigation clears the old popup context unless the caller explicitly supplies a new one; it never borrows another instance's parameters.

`WidgetBindingResolver.apply()` reuses the Phase 4A.1 template expansion, exact Device/Tag-name match, ambiguity checks and type checks. Multiple numbered parameters such as `{#1}_{#2}` work through the same resolver. No Tag is created, renamed, written or matched by ADS address.

Missing context, required parameter, Device, Tag, unsupported profile, ambiguity or type mismatch leaves profile-owned IDs/defaults cleared. The affected View renders an accessible **Binding errors** alert containing the Widget and failed expression. NexPlc validity remains WAITING FOR DATA until all six BOOL inputs are valid. Fixed/manual siblings continue using their own bindings. Inherited bindings join the existing Prefix disconnect/recovery handling and read-only Widget event guard.

The resolved Tags use Phase 4B.1's existing owner union. Closing one Faceplate releases only its registrations and subscriptions. The server still receives its existing full replacement subscription protocol; no second ADS connection or communication layer is introduced.

## Output/Input/Shape extension design

Source investigation found three different binding surfaces that must use a common adapter point, not string substitution in saved `variableId` fields:

| Control | Existing source | Consistent extension |
| --- | --- | --- |
| Output (`ValueComponent`) | `property.variableId`, range text/digit Tags | Profile entries declare the primary feedback and optional range sources; an Output adapter assigns resolved IDs to the runtime clone before registration |
| Input (`HtmlInputComponent`) | `property.variableId`, options, key-enter writes | The same feedback adapter for display, with inherited feedback kept read-only; command routing requires a separately scoped feature and explicit UI permissions |
| Shape / indicator (`ShapesComponent`) | Main variable, action/range/alarm sources | Profile entries declare each feedback/action source and expected type; an adapter maps those declared fields only, reusing the resolver and runtime ownership |
| Text label | Static text or range text Tag | Tag-backed text resolves a declared STRING profile source; parameter captions such as `Valve {#1}` need a separate, explicitly selected text-format adapter, not a fake Tag ID |
| Multi-variable SVG Widget | `varsToBind`, Binding Profile | Implemented: original variable names are the adapter targets, with manual label variables outside the profile preserved |

The shared architecture is `immutable View context → declared profile → existing resolver → control adapter → runtime IDs/status`. A future common selector can expose the same Manual/fixed/Inherit modes in `flex-head`, alongside the current Widget selector, while keeping old saved IDs valid by default. Validation errors must be attached to the owning control/View and use the same disconnect invalidation rules. No tag-prefix string should be stored in `variableId` or treated as an ADS address. This phase does not implement those native-control adapters, parameter-caption interpolation or inherited commands.

## Main code changes

| File under `client/src/app` | Change |
| --- | --- |
| `_helpers/view-runtime-context.ts` | Immutable per-instance parameter snapshot |
| `_helpers/widget-binding.ts` | Inherit resolution and failure cleanup using the existing validator |
| `_models/hmi.ts` | Optional `WidgetProperty.inheritFaceplateBinding`; no schema migration |
| `fuxa-view/fuxa-view.component.ts` / `.html` / `.css` | Source capture, popup propagation, runtime resolution and visible binding errors |
| `fuxa-view/fuxa-view-dialog/*` | Pass parameters to the actual dialog View |
| `gauges/controls/panel/panel.component.ts` | Pass parent context to static nested Views |
| `gauges/controls/html-image/html-image.component.ts` | Keep inherited Widget binding read-only; avoid recreating absent old script exports from saved editor markup |
| `gauges/gauge-property/flex-widget-property/*` | Explicit inherit mode, parameter/profile description and manual restore |
| `gauges/gauge-property/flex-event/*` | Contextual Open Faceplate labels and automatic-transfer hint |

The source SVG is reused unchanged. Test fixtures use the already permitted `custom/widgets/valves/NexPlc_Valve.svg` and native FUXA `foreignObject`/HTML image containers; they do not create a replacement industrial symbol.

## Automated verification and evidence

The first regression failed on the baseline: an inheriting Widget retained the stale ID instead of resolving V101/V102. Tests now exercise independent parameters, missing inputs, type checks, unchanged definitions, fixed/manual compatibility, multiple numbered parameters, mode changes, immutable copies and snapshot timing across lazy loading.

`client/test/faceplate-e2e.py` runs the production Angular build against real Socket.IO with `broadcastAll=false`, lazy View HTTP loading and a temporary SQLite project. The host's Symbols have no Variables Mapping. Each opened Faceplate contains two inheriting Widgets, one fixed V102 Widget and one manually bound V101 Widget. Coverage includes six BOOL validity, FAULT/CONFLICT and moving-state priority, manual/auto mode, Dialog/Dialog, Card/Card, mixed entrances, shared Tags, independent close/reopen, missing-context/device/parameter/Tag errors, device loss, Socket.IO reconnect and 20 open/close cycles. The test asserts unique DOM IDs, stable View/module/DOM counts, the actual server subscription union, unchanged runtime definitions and absence of client write frames.

The actual editor changes a target from fixed Prefix back to Inherit and saves it. The harness terminates its own server, restarts it on the **same temporary SQLite data**, creates a new browser and repeats runtime checks. This verifies save/reload and real server restart, not just JSON serialization. Existing Phase 4A.1 and 4B.1 tests remain in CI and run against the same production bundle.

Run from the repository root (client/server dependencies and Python Playwright required):

```powershell
node --test client/test/faceplate-binding.test.cjs
npm run build --prefix client -- --configuration production
python client/test/faceplate-e2e.py
python client/test/widget-prefix-e2e.py
python client/test/view-instance-e2e.py
```

`FUXA_TEST_CLIENT_DIST` can select a separate production-build directory. CI uploads `nexfuxa-faceplate-runtime.png` and `nexfuxa-faceplate-property.png` with the existing `view-instance-browser-evidence` artifact. Test data is temporary; `.local/fuxa-dev` and production volumes are never opened or modified.

Local results on 2026-10-15:

| Check | Result |
| --- | --- |
| New inheritance unit tests | 14 passed, including lazy parameter snapshots and event labels |
| Combined client/Widget/View/PLC model/Home regressions | 126 passed, 0 failed |
| Server Mocha tests | 309 passed |
| Angular production and server TypeScript builds | Passed; existing Angular unused-environment/CommonJS warnings |
| Phase 4A.1 full production browser/editor regression | Passed, including save/reload and three viewport sizes |
| Phase 4B.1 full production browser regression | Passed; original 20-cycle baseline retained |
| Phase 4B.2 browser/editor/restart regression | Passed before and after real server restart, including nested inherited opens and contextual action labels |
| 20-cycle View/module-key/active-module/DOM counts | Before = after in each run: **1 / 7 / 7 / 123**, then **1 / 7 / 7 / 139** after the editor saves its canonical SVG markup |
| Runtime definitions / Device and Tag identities | Unchanged; editor explicitly saves only authored configuration |
| Client PLC write frames | None |

`nexfuxa-faceplate-actions.png` captures the actual event selector. Inherit/fixed modes hide profile-owned manual Tag rows; only the static label remains visible. No real TwinCAT or production Docker acceptance was performed locally.

## Docker + TwinCAT manual acceptance

Use the reviewed PR build in an independent development/test environment. Preserve production data and the current development volume; do not migrate a production project for this test.

1. Confirm the existing six BOOL feedback Tags for V101 and V102 are already present on the selected test ADS Device. Record their IDs, names and addresses. Use an independent test PLC or safe feedback fixture; no valve command is added by this phase.
2. Create/save `Valve.Faceplate` with two participating SVG Widgets set to Inherit Faceplate Binding. Add static text labels and, if useful, one fixed Prefix and one Manual Widget to verify mixed behavior.
3. Place a host Valve Symbol, choose the ADS Device and `#1=V101`, then Click → Open Faceplate (Dialog) → `Valve.Faceplate`. Leave Variables Mapping empty. Copy it and change only `#1` to V102.
4. Open both. Change each of the six feedback BOOLs on the independent test PLC. Verify the correct instance and its participating Widgets update; check label/mode information, FAULT precedence, conflicting feedback and incomplete-data invalidation.
5. Close A, update B, reopen A, then close B and update A. Repeat with two instances of the same prefix, Cards and mixed Dialog/Card. Repeat 20 cycles and check for duplicate events, stale values or increasing active resources.
6. Disconnect/reconnect ADS, then the browser transport. Both affected instances must invalidate and recover only after complete valid feedback. Closing either one must preserve the remaining subscriber.
7. Test an unbound source, absent Device, missing required prefix, missing Tag and wrong Tag type in the isolated test project. Each inherited target must report its own error and must not display the last successful instance's values. Fixed/manual siblings retain their declared bindings.
8. Save, refresh and restart the development server/container. Reopen both Symbols and verify inheritance, modes and source prefixes remain configured. Compare recorded Device/Tag identities and the shared View configuration; runtime device/prefix values must not have been copied into the target definition.
9. Confirm old Manual, fixed Prefix, Variables Mapping and Phase 3B Tag Generator preview still behave normally. Review any project-specific custom script destroy hooks as documented in Phase 4B.1.

Real TwinCAT connectivity and Docker deployment acceptance remain manual. Arbitrary custom JavaScript retains Phase 4B.1's support limits; this change is not a script sandbox, Global Object/template synchronization system, command-inheritance feature or new ADS layer.
