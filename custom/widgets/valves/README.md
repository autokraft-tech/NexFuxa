# NexPlc valve widget

Start the isolated development stack with `docker compose -f compose.dev.yml up --build -d`. Open `http://localhost:1882`. The Compose file builds this checkout and mounts `custom/widgets` read only at FUXA's `_widgets` path. The project name is `nexfuxa-valve-dev`.

Runtime data lives on the Windows host in `.local/fuxa-dev/{appdata,db,logs,images}`, relative to this checkout. These bind mounts persist across container recreation and image rebuilds or removal. Git ignores this directory, including backups. The development stack uses separate paths from the production `compose.yml`; always specify `-f compose.dev.yml` for the commands below.

In the FUXA editor, select **Widgets → valves → NexPlc_Valve.svg** and place a valve. Set `_ps_label` to the desired display name. Create or select six read-only ADS variables using the V101 paths below, then bind each variable in the SVG properties panel:

| Parameter | ADS symbol |
| --- | --- |
| `_pb_extended` | `GVL.g_aValve_HMI[1,1].Sts.Extended` |
| `_pb_retracted` | `GVL.g_aValve_HMI[1,1].Sts.Retracted` |
| `_pb_extending` | `GVL.g_aValve_HMI[1,1].Sts.Extending` |
| `_pb_retracting` | `GVL.g_aValve_HMI[1,1].Sts.Retracting` |
| `_pb_error` | `GVL.g_aValve_HMI[1,1].Sts.Error` |
| `_pb_isManualMode` | `GVL.g_aValve_HMI[1,1].Sts.IsManualMode` |

Place another copy for each additional valve and bind its six parameters to that valve's array element. Each FUXA import receives its own SVG IDs and script module. No PLC writes are available from this widget. See [NexPlc.Valve.v1.md](NexPlc.Valve.v1.md) for the status rules and profile contract.

Run the focused tests with `node --test custom/widgets/valves/NexPlc_Valve.test.cjs` and validate Compose with `docker compose -f compose.dev.yml config`.

## SVG source and adaptation

The equipment graphic is reused from `D:\Will\Documents\source\repos\FUXA-SVG-Widgets\Proc. Engineering\Proc. Eng. Valves\25_Gate Valve (Double Acting Cylinder).svg` in `frangoteam/FUXA-SVG-Widgets`. The local library HEAD at inspection was `70e7c4a656d111c0428c77eb4b0409fc3670b8d5`; the actual source file SHA-256 was `3706a8b63f5481af2f983f526da2cae297f62ba46b78370627aec8e6554f1e82`.

Four existing candidates were compared: `01_Gate Valve.svg` has a plain gate body, `03_Ball Valve.svg` adds a ball enclosure, `24_Gate Valve (Single Acting Cylinder).svg` shows a single actuator port, and the selected `25_Gate Valve (Double Acting Cylinder).svg` shows two actuator ports. The selected drawing provides a recognizable actuated valve for the widget's bidirectional extend/retract status display.

The three source paths, actuator rectangle, and internal group transforms are retained unchanged. The copied equipment group is translated and uniformly scaled to fit the existing widget layout. Its outer ID becomes `valveSymbol`, and the valve-body path ID becomes `valveBody`; that path's `fill:none` style is removed so the existing status colors can fill the body. Black equipment outlines and actuator details are retained. The earlier hand-drawn equipment paths and circle are removed; the existing label, status band, and Manual/Auto badge remain.

The library's generic state/write script is replaced by the existing read-only NexPlc script. The six BOOL parameters, fault priority, conflict detection, independent-instance behavior, and V101 ADS paths remain defined by `NexPlc.Valve.v1`. The original library is not modified.

The library's MIT license permits copying, modification, and redistribution with its copyright and permission notice retained. The complete `Copyright (c) 2019-2025 frangoteam info@frangoteam.org` MIT notice is embedded in `NexPlc_Valve.svg` so it accompanies standalone downloads. Future widgets must follow [the SVG reuse policy](../../../docs/SVG_REUSE_POLICY.md).

## Backup and restoration

Run these PowerShell commands from the checkout root. Stop FUXA before copying projects and databases so the snapshot is consistent. Keep an additional copy of important snapshots outside the checkout for protection against host disk loss or checkout deletion.

```powershell
docker compose -f compose.dev.yml stop -t 30 fuxa
if ($LASTEXITCODE -ne 0) { throw 'Could not stop development FUXA' }
$dataRoot = Join-Path (Resolve-Path -LiteralPath '.').Path '.local/fuxa-dev'
$snapshotPath = Join-Path $dataRoot ('backups/host-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $snapshotPath) { throw 'Backup destination already exists' }
New-Item -ItemType Directory -Path $snapshotPath | Out-Null
foreach ($kind in @('appdata', 'db', 'logs', 'images')) {
    Copy-Item -LiteralPath (Join-Path $dataRoot $kind) -Destination $snapshotPath -Recurse -ErrorAction Stop
}
docker compose -f compose.dev.yml up -d
```

To restore, set `$snapshotPath` to a complete snapshot containing all four directories. This moves the current runtime directories into a fresh recovery backup before copying the snapshot; it does not overwrite the current files or merge old database files into the restored snapshot.

```powershell
# Set this to the snapshot to restore (host backup or named-volume migration).
$snapshotPath = (Resolve-Path -LiteralPath $snapshotPath).Path
$checkoutRoot = (Resolve-Path -LiteralPath '.').Path
$dataRoot = [IO.Path]::GetFullPath((Join-Path $checkoutRoot '.local/fuxa-dev'))
$kinds = @('appdata', 'db', 'logs', 'images')
foreach ($kind in $kinds) {
    if (-not (Test-Path -LiteralPath (Join-Path $snapshotPath $kind) -PathType Container)) {
        throw "Snapshot is missing $kind"
    }
}
docker compose -f compose.dev.yml stop -t 30 fuxa
if ($LASTEXITCODE -ne 0) { throw 'Could not stop development FUXA' }
$recoveryPath = Join-Path $dataRoot ('backups/before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $recoveryPath) { throw 'Recovery destination already exists' }
New-Item -ItemType Directory -Path $recoveryPath | Out-Null
foreach ($kind in $kinds) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $dataRoot $kind))
    if (-not $targetPath.StartsWith($dataRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Restore target is outside the development data directory'
    }
    if (Test-Path -LiteralPath $targetPath) {
        Move-Item -LiteralPath $targetPath -Destination $recoveryPath -ErrorAction Stop
    }
    Copy-Item -LiteralPath (Join-Path $snapshotPath $kind) -Destination $targetPath -Recurse -ErrorAction Stop
}
docker compose -f compose.dev.yml up -d --force-recreate fuxa
```

## Migration from the earlier named volumes

The earlier configuration used `nexfuxa-valve-dev_appdata`, `nexfuxa-valve-dev_db`, `nexfuxa-valve-dev_logs`, and `nexfuxa-valve-dev_images`. Before starting the bind mount configuration, stop the development container and copy those volumes into a fresh snapshot. This works even if the original container has been removed. It requires the locally built `nexfuxa-valve-dev-fuxa` image; build it with `docker compose -f compose.dev.yml build` if necessary.

```powershell
docker volume ls --filter label=com.docker.compose.project=nexfuxa-valve-dev
docker compose -f compose.dev.yml stop -t 30 fuxa
if ($LASTEXITCODE -ne 0) { throw 'Could not stop development FUXA' }
$dataRoot = Join-Path (Resolve-Path -LiteralPath '.').Path '.local/fuxa-dev'
$snapshotPath = Join-Path $dataRoot ('backups/named-volumes-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $snapshotPath) { throw 'Migration destination already exists' }
foreach ($kind in @('appdata', 'db', 'logs', 'images')) {
    $volumeName = "nexfuxa-valve-dev_$kind"
    docker volume inspect $volumeName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Missing volume: $volumeName" }
    $targetPath = Join-Path $snapshotPath $kind
    New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
    docker run --rm --mount "type=volume,source=$volumeName,target=/from,readonly" --mount "type=bind,source=$targetPath,target=/to" --entrypoint sh nexfuxa-valve-dev-fuxa -c 'cp -a /from/. /to/'
    if ($LASTEXITCODE -ne 0) { throw "Migration copy failed: $kind" }
    docker run --rm --mount "type=volume,source=$volumeName,target=/from,readonly" --mount "type=bind,source=$targetPath,target=/to,readonly" --entrypoint diff nexfuxa-valve-dev-fuxa -qr /from /to
    if ($LASTEXITCODE -ne 0) { throw "Migration verification failed: $kind" }
}
```

Use the restoration block above with this `$snapshotPath` to populate the host runtime directories, then start FUXA on port 1882. Keep the original named volumes until the migrated projects have been checked. Do not run `docker compose down -v` or `docker volume prune` during migration or recovery.
