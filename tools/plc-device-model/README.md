# Phase 3A PLC device model and batch tag generator

The [Valve model](models/valve.v1.json) is a reviewed snapshot of four TwinCAT DUTs in [NexPlc commit `04b27f25`](https://github.com/autokraft-tech/NexPlc/tree/04b27f25dce1b1be335c5f51f539496f195e3708/MySPT_Machine/MainPLC/03_POUs/02_Components/Valves/01_DUT/ST_Valve_HMI). Its `types` tree retains every member, nested DUT reference and PLC primitive. Full recursively walks from `rootType` to every supported primitive leaf; it has no maintained member list. The current Valve has 4 Cmd, 9 Sts and 7 Cfg leaves, or 20 tags per instance. The selective `profiles` are Status (six widget feedback BOOLs), Control (four command BOOLs), and Engineering (status and configuration). Control only creates tag definitions; this tool does not issue PLC commands.

The six Status paths are `Sts.Extended`, `Sts.Retracted`, `Sts.Extending`, `Sts.Retracting`, `Sts.Error`, and `Sts.IsManualMode`. They match the existing valve SVG's six feedback bindings. Current NexFuxa ADS tag types are lowercase `boolean`, `number`, and `string`. The checked PLC primitives map as `BOOL → boolean`, `LREAL/UDINT → number`, and `STRING → string`. Other PLC primitives fail explicitly until reviewed. Existing tags with legacy title-case ADS types, such as the supplied V101 `Boolean` tags, are semantically compared but never rewritten.

## CSV and output

Use the [example CSV](examples/valves.csv) as the starting table. **Device Name** is the instance label (`V101`), **PLC Device ID** is the existing FUXA ADS device ID (`TC-VM`'s `d_b6ba9d1c-2b054dc3`), and **Device Model** is `Valve` or `Valve@1.0.0`. **Array Indices** is a quoted comma-separated tuple; spaces around indices are removed. Explicit `Full` or an empty Profile selects every leaf. Explicit `Status` selects only six feedback leaves. Excel can edit and export this CSV as UTF-8. Tag names use the unchanged instance name followed by the full member path in snake_case (`V101_sts_current_lifetime_count`); ADS addresses retain the PLC spelling and dots (`GVL.g_aValve_HMI[1,1].Sts.CurrentLifetimeCount`). Duplicate generated names, recursive type cycles and unsupported primitives fail explicitly.

```powershell
node tools/plc-device-model/cli.cjs --input "D:\Will\下载\fuxa-devices-latest.json" --config tools/plc-device-model/examples/valves.csv --output "D:\Will\下载\phase3a-full-devices.json" --report "D:\Will\下载\phase3a-full-change-report.md"
```

First export Devices from FUXA **after** deleting the manual test tags and save that new export as `fuxa-devices-latest.json`. The previously supplied `fuxa-devices.json` still contains eight old V101 tags and must not be treated as the new empty baseline. Pass `--dry-run` instead of `--output` to write only the report. Without Valve tags, the expected report is Reused 0, Created 40, Conflicts 0; if some tags exist, their exact addresses determine the reused count. Conflicts always produce a nonzero exit and prevent writing the devices JSON. The JSON is the same complete device array used by `exportDevices` and `importDevices`; the tool does not connect to FUXA or a PLC. Import only into an isolated test project made from the same export snapshot. If that project's devices changed after export, re-export before generating again because FUXA's `importDevices` replaces devices with matching IDs.

In that isolated FUXA project, open **Devices → Import**, select `phase3a-full-devices.json`, and inspect TC-VM's V101/V102 tags and existing system tags. Save, reopen, and confirm any existing V101 widget bindings still resolve. Only after this offline check should a separate live ADS test be performed by the operator; this generator does not test PLC connectivity.

The CLI rejects file aliases among both inputs and both outputs, including hard links, so an output cannot replace a source file. Existing output or report files are refused unless you explicitly pass `--overwrite`. Each output is fully written to a temporary file in its destination directory before it is published; new files use exclusive creation, and `--overwrite` replaces a complete file. A dry run never writes the devices JSON. CSV field values are preserved as entered: an array symbol with leading/trailing whitespace or invalid characters is rejected. Instance names must be unique in a batch, and duplicate device IDs in the input export are rejected.

Existing tags are matched within the exact device ID by exact ADS `address`. Their IDs, names, types, DAQ settings and any other fields remain untouched. A new tag gets a unique `t_` ID, a descriptive name such as `V102_sts_extended`, the actual ADS `address`, the current lowercase ADS type and the same disabled DAQ defaults as `TagDaq(false, false, 60, false)`. New tags omit `value` and `timestamp`. The report lists reused, created, conflicting and unchanged tags. No tag or device is removed. The pure `expand` function in [model.cjs](model.cjs) and pure `mergeDevices` function in [fuxa.cjs](fuxa.cjs) take plain objects and can be called later from an Angular management UI or widget binding flow; the CLI handles files and ID creation separately.

## Model synchronization

For a future NexPlc revision, fetch a specific reviewed commit and compare each `.TcDUT` declaration with the model's `types`. Record the new commit, review changes in member names, nesting and primitive types, then publish a new model version. Full automatically includes new supported leaves from `types`; update selective profiles deliberately. Test the updated model against a current FUXA export before use. This is a one-way, controlled copy from reviewed PLC definitions to HMI metadata. The tool never writes PLC source or changes live PLC symbols.

Run tests with `node --test tools/plc-device-model/test/phase3a.test.cjs`. The committed partial-tag fixture is derived from the supplied older export: it retains eight V101 tag IDs and addresses and the FUXA system tag, with network connection values replaced and transient `value`/`timestamp` fields removed. The separate `devices.empty-valves.json` fixture has the same sanitized devices but no Valve tags; it is a synthetic test baseline, not a recent FUXA export.

## Offline FUXA project import check

The [integration check](test/offline-fuxa-project.cjs) uses FUXA's actual `set-device` and `set-view` project storage operations against an isolated SQLite `workDir`. Run it twice in separate processes with `import` and then `reopen`, setting `PHASE3A_SERVER_ROOT`, `PHASE3A_WORK_DIR`, `PHASE3A_ORIGINAL_JSON`, `PHASE3A_MERGED_JSON`, and `PHASE3A_WIDGET_SVG` to the corresponding absolute paths. The server environment needs its usual `sqlite3` and `async` dependencies. Keep `PHASE3A_WORK_DIR` in a newly created temporary directory, outside `.local/fuxa-dev` and production volumes.

```powershell
node tools/plc-device-model/test/offline-fuxa-project.cjs import
node tools/plc-device-model/test/offline-fuxa-project.cjs reopen
```

The check imports the complete generated devices array, saves a small synthetic view with the V101 widget's six `varsToBind` references, then reopens the project database in a new process. It compares every pre-existing V101 tag object and the FUXA system device with the input fixture, checks all 20 tags for each Valve, and confirms that each saved binding ID still resolves to the same V101 tag and SVG parameter. This is **offline import and persistence verification**. It does not establish PLC connectivity, live ADS read/write behavior, or browser rendering of an existing deployed view.
