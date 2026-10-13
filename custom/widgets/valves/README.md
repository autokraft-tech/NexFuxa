# NexPlc valve widget

Start the isolated development stack with `docker compose -f compose.dev.yml up --build -d`. Open `http://localhost:1882`. The Compose file builds this checkout, mounts `custom/widgets` read only at FUXA's `_widgets` path, and uses Compose volumes under the `nexfuxa-valve-dev` project. It does not use the upstream `compose.yml` or its bind mounted data directories.

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
