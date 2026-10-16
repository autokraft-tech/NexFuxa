# PLC device model and tag generator

The [Valve model](models/valve.v1.json) is a reviewed snapshot of four TwinCAT DUTs in [NexPlc commit `04b27f25`](https://github.com/autokraft-tech/NexPlc/tree/04b27f25dce1b1be335c5f51f539496f195e3708/MySPT_Machine/MainPLC/03_POUs/02_Components/Valves/01_DUT/ST_Valve_HMI). Its `types` tree retains every member, nested DUT reference and PLC primitive. Full recursively walks from `rootType` to every supported primitive leaf; it has no maintained member list. The current Valve has 4 Cmd, 9 Sts and 7 Cfg leaves, or 20 tags per instance. The selective `profiles` are Status (six widget feedback BOOLs), Control (four command BOOLs), and Engineering (status and configuration). Control only creates tag definitions; this tool does not issue PLC commands.

The six Status paths are `Sts.Extended`, `Sts.Retracted`, `Sts.Extending`, `Sts.Retracting`, `Sts.Error`, and `Sts.IsManualMode`. They match the existing valve SVG's six feedback bindings. Current NexFuxa ADS tag types are lowercase `boolean`, `number`, and `string`. The checked PLC primitives map as `BOOL → boolean`, `LREAL/UDINT → number`, and `STRING → string`. Other PLC primitives fail explicitly until reviewed. Existing tags with legacy title-case ADS types, such as the supplied V101 `Boolean` tags, are semantically compared but never rewritten.

## CSV and output

Use the [example CSV](examples/valves.csv) as the starting table. **Device Name** is the instance label (`V101`), **PLC Device ID** is the existing FUXA ADS device ID (`TC-VM`'s `d_b6ba9d1c-2b054dc3`), and **Device Model** is `Valve` or `Valve@1.0.0`. **Array Indices** is a quoted comma-separated tuple; spaces around indices are removed. Explicit `Full` or an empty Profile selects every leaf. Explicit `Status` selects only six feedback leaves. Excel can edit and export this CSV as UTF-8. Tag names use the unchanged instance name followed by the full member path in snake_case (`V101_sts_current_lifetime_count`); ADS addresses retain the PLC spelling and dots (`GVL.g_aValve_HMI[1,1].Sts.CurrentLifetimeCount`). Duplicate generated names, recursive type cycles and unsupported primitives fail explicitly.

```powershell
node tools/plc-device-model/cli.cjs --input _reports/plc-generator/devices-export.json --config tools/plc-device-model/examples/valves.csv --output _reports/plc-generator/generated-devices.json --report _reports/plc-generator/change-report.md
```

Export the current Devices from FUXA and use that complete device array as input. Create the ignored output directory first, or choose a directory outside the repository. Pass `--dry-run` instead of `--output` to write only the report. Conflicts produce a nonzero exit and prevent writing the devices JSON. The tool does not connect to FUXA or a PLC. Validate generated output in an isolated project made from the same export snapshot; re-export if the project's devices changed because FUXA's `importDevices` replaces matching Device IDs.

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

## Online PLC Tag Generator

Open **Devices → ⋮ → PLC Tag Generator** as a project administrator and choose an existing ADSclient Device. Create or select a saved task, enter its root ADS Symbol without brackets or a member suffix, then select Primitive or Structure and Scalar, Single Element or Range. Range supports one or two dimensions with integer bounds and nonzero Step. Preview/Apply is limited to 500 candidates and one ADS Device per batch. Declared primitives are BOOL, INT, DINT, UINT, UDINT, REAL, LREAL and STRING; each structure leaf or array element becomes a separate Tag.

For Structure, select a versioned model and profile, with optional leaf selection. **Model Library** supports nested custom structures and per-leaf properties. Save changes as a new model version; saved versions are immutable and referenced versions cannot be deleted. Tasks and custom models are stored in project SQLite. Removing a task or model does not remove existing Tags.

Use **Save → Preview → Apply**. Preview lists Created/Reused/Conflict with exact proposed names and ADS addresses. Default names combine prefix, index and snake_case member path; advanced templates support `{prefix}`, `{index}` and `{member}`. The Preview token is bound to the administrator and project version for ten minutes; Apply regenerates and rechecks the saved inputs. Existing reused Tags retain IDs, names, types, addresses, DAQ settings and other properties.

JSON import uses `schemaVersion: 2` with a `models` or `configurations` array. It previews Merge (default), Overwrite matching keys, or Replace all before explicit confirmation. Merge preserves conflicting saved items; overwrite keeps unrelated items; replacement lists deletions. Cancel does not save. Configuration identity is ID; model identity is name/version. Export Current Configuration includes unsaved edits with a draft marker; Selected/All exports use saved entries. Switching tasks prompts before abandoning edits; background refresh does not silently replace a draft.

Model `memberDefaults` and configuration `memberOverrides` (`$value` for primitives) provide Tag properties. Priority is configuration override → model default → system default; partial DAQ settings inherit unspecified fields. Reset removes the override. Ordinary Apply preserves reused Tag properties instead of synchronizing defaults onto existing Tags. Import/Preview never evaluate scripts or expressions.

Preview does not persist Tags, write PLC values or verify live symbols. Apply saves definitions and reloads the selected Device with native Restore suppressed for that entire runtime session, including connection retries/reconnects and existing Tags outside the selected tasks. It still stops/starts the driver and refreshes subscriptions. Ordinary starts, project restarts and non-Generator reloads retain native Restore behavior and can write stored values to the PLC. A driver write already issued before stopping cannot be revoked. Check declared types/addresses and Restore settings against the PLC project before applying.

Apply reports persistence and runtime reload separately: HTTP 200 with `persistence="committed"` and `runtime.status="updated"` means the reload calls completed; HTTP 207 reports committed definitions with a failed reload and a diagnostic message. Neither certifies PLC connectivity. Investigate a failed reload, then Preview again before retrying Apply.

### HTTP API

All `/api/plc-device-models` routes require administrator permission. `GET/POST /models` and `/configurations` manage saved collections; POST includes the relevant array and GET's `expectedHash`, with HTTP 409 for stale saves. `POST /preview` accepts `{ "configurationIds": ["cfg_..."], "expectedHash": "..." }`; `POST /apply` accepts `{ "token": "...", "confirmed": true }`. Requests over 100 KB are rejected. Legacy `/instances`, `/csv` and row-based Preview remain compatible; migration previews equivalent v2 tasks without applying Tags or clearing old rows. Preserve historical names with `{prefix}_{member}`. See [Git workflow](../../docs/GIT_WORKFLOW.md) for maintained CI requirements.
