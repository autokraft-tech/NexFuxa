# PLC Tag Generator (Phase 3B.1)

Open **Devices → ⋮ → PLC Tag Generator** as a project administrator. Choose an existing ADSclient device. The generator stores Tag definitions in the FUXA project; it does not write PLC values or verify symbols against a connected PLC. Check the declared PLC types and ADS addresses against the TwinCAT project before Apply. The supported declared primitives are `BOOL`, `INT`, `DINT`, `UINT`, `UDINT`, `REAL`, `LREAL`, and `STRING`. Other types are rejected. Each array element or structure leaf becomes a separate ADS Tag.

## Configuration workflow

JSON imports open a preview before saving. **Merge** is the default: it adds new identities, skips identical duplicates, and preserves existing items with conflicting content. Configurations match by ID; custom models match by name and version. The preview lists additions, duplicates, conflicts, and planned deletions. Choose **Overwrite matching keys** to replace conflicting configurations while keeping unrelated saved items, or **Replace all** to remove saved items absent from the file. Every mode requires explicit confirmation; Cancel leaves saved data untouched. Saved model versions remain immutable, including during import, and referenced models cannot be deleted.

Switching tasks, creating or copying a task, and explicitly refreshing the editor prompt before leaving unsaved configuration edits. Background data refreshes preserve the draft; if the saved configuration changed externally, Preview is disabled until the editor is refreshed or saved. Deleting a configuration or custom model requires confirmation and keeps existing Tags and Widget bindings.

In **Generator Configurations**, create or select a saved task in the left panel, edit it in the middle panel, and inspect server generated Tags in the right panel. Enter a complete root ADS Symbol without brackets or member suffix, select Primitive or Structure, and choose Scalar, Single Element, or Range. Range accepts one or two dimensions with integer Start, End, and nonzero Step. Bounds can start at any integer. The server limits a Preview/Apply batch to 500 candidates and one ADS device. It rejects invalid ranges, types, templates, duplicate generated names, and conflicting existing Tags.

For Structure, choose a versioned model, a profile, and optional individual leaves. The read-only `Valve@1.0.0` remains available. **Model Library** displays every leaf's member path and declared PLC/FUXA type. Create, copy, and edit custom models in the JSON definition editor. A saved model version is immutable; to change its meaning, save a new version. Referenced versions cannot be deleted. Custom models and tasks are stored in the project SQLite database and restored on restart. JSON import/export uses a top-level `schemaVersion: 2` and a `models` or `configurations` array.

Default Tag names use `Tag Prefix` for a scalar, `Prefix_index` for a primitive array, `Prefix_member_path` for a structure scalar, and `Prefix_index_member_path` for a structure array. Advanced templates can use `{prefix}`, `{index}`, and `{member}`; duplicate or invalid names are rejected. Member path parts are converted to snake case. Preview shows Created, Reused, Conflict, reasons, source configuration, and summary counts, with search, filter, and sort. **Save → Preview → Apply** is required. A Preview token is bound to the administrator and project version for ten minutes. Apply regenerates candidates and rechecks saved configurations inside the serialized project write.

| Form | ADS Symbol | Data and array fields | Example generated address |
| --- | --- | --- | --- |
| Primitive Scalar | `GVL.bStart` | Primitive BOOL; Scalar | `GVL.bStart` |
| Primitive Array | `GVL.aTemperature` | Primitive REAL; Range Start 0, End 9, Step 1 | `GVL.aTemperature[0]` … `[9]` |
| Structure Scalar | `GVL.stValve` | Structure Valve@1.0.0; Full; Scalar | `GVL.stValve.Cmd.Extend` (20 Tags) |
| Structure Array | `GVL.aValve` | Structure Valve@1.0.0; Full; Range 1..2 | `GVL.aValve[1].Cmd.Extend` (40 Tags) |
| Array Element | `GVL.aPump` | Structure Pump@1.0.0; Single Element index 2 | `GVL.aPump[2].Sts.Running` |
| Multidimensional Array | `GVL.g_aValve_HMI` | Structure Valve@1.0.0; Full; Range dimension 1 = 1..1, dimension 2 = 1..2 | `GVL.g_aValve_HMI[1,1].Cmd.Extend`, `[1,2].Cmd.Extend` (40 Tags) |

For a single primitive array element, select Primitive and Single Element. For a two-dimensional selected element, enter both indices; for example `[1,2]`. A custom `Pump@1.0.0` model can define `ST_Pump_HMI` with nested `Cmd.Start: BOOL`, `Cmd.Stop: BOOL`, `Sts.Running: BOOL`, `Sts.Speed: REAL`, and `Sts.ErrorCode: UDINT`. The same model generates `GVL.stPump.Sts.Running` and `GVL.aPump[1].Sts.Running`.

## Legacy compatibility and safety

The **Legacy Valve CSV** tab preserves the six Phase 3A columns: `Device Name, PLC Device ID, Device Model, Array Symbol, Array Indices, Profile`. The original `expand()`, `flatten()`, CLI and CSV contracts remain. Existing V101/V102 rows still generate `V101_cmd_extend` at `GVL.g_aValve_HMI[1,1].Cmd.Extend` and equivalent V102 addresses. Existing Tag IDs, widget bindings, DAQ settings, type, address, and name are preserved on reuse. Removing a configuration or model never removes a Tag. Preview does not write to the FUXA project.

Apply reports SQLite persistence and runtime reload separately. HTTP 200 with `persistence: "committed"` and `runtime.status: "updated"` means the device stop and start calls completed. HTTP 207 means the Tags were committed but runtime reload failed; the response contains `runtime.status: "failed"` and a message. Re-preview and Apply again after investigating the device. Runtime update does not confirm a live PLC connection.

## API and CI

All `/api/plc-device-models` routes require administrator permission. The v2 routes are `GET/POST /models` and `GET/POST /configurations`, relative to that base. POST bodies contain `models` or `configurations` arrays and the `expectedHash` returned by GET; stale saves return HTTP 409. `POST /preview` takes `{ "configurationIds": ["cfg_..."], "expectedHash": "..." }` for saved v2 tasks, or `{ "rows": [...] }` for saved legacy rows. `POST /apply` takes `{ "token": "...", "confirmed": true }`. Legacy `/instances` and `/csv` routes remain. Requests over 100 KB are rejected.

PRs targeting `nexfuxa` must pass the four NexFuxa CI jobs: PLC model tests, full server tests/build, client script/race tests and production build, and final Docker runtime packaging. Local equivalents:

- `node --test tools/plc-device-model/test/phase3a.test.cjs tools/plc-device-model/test/phase3b.test.cjs tools/plc-device-model/test/phase3b1.test.cjs tools/plc-device-model/test/phase3b1-manager.test.cjs`
- In `server`: `npm test` and `npm run build`
- In `client`: `npm run test:scripts`, `node --test test/plc-device-models-race.test.cjs`, and `npm run build -- --configuration production`
- `docker build --build-arg INSTALL_ODBC=false -t nexfuxa-runtime-ci .`, then `node tools/plc-device-model/test/docker-restart.cjs nexfuxa-runtime-ci`. The Docker CI job also loads the manager and generator from the final image and verifies that legacy/v2 configurations and a custom model survive a restart using a disposable volume.

Tests use temporary SQLite data. Do not point them at `.local/fuxa-dev` or a production project. The Docker test verifies package contents and module loading; it does not establish an ADS connection.
