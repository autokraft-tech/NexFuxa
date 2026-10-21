# NexPlc.Valve profile, version 1

This profile maps one FUXA SVG widget instance to the existing NexPlc `ST_Valve_HMI.Sts` structure, checked against NexPlc commit `04b27f25dce1b1be335c5f51f539496f195e3708`. It defines a manual binding contract; automatic prefix binding is outside version 1.

| SVG export parameter | Type | `ST_Valve_HMI` member | Access |
| --- | --- | --- | --- |
| `_ps_label` | String | Display label, entered in FUXA | Local only |
| `_pb_extended` | BOOL | `Sts.Extended` | Read only |
| `_pb_retracted` | BOOL | `Sts.Retracted` | Read only |
| `_pb_extending` | BOOL | `Sts.Extending` | Read only |
| `_pb_retracting` | BOOL | `Sts.Retracting` | Read only |
| `_pb_error` | BOOL | `Sts.Error` | Read only |
| `_pb_isManualMode` | BOOL | `Sts.IsManualMode` | Read only |

For V101, bind each BOOL to `GVL.g_aValve_HMI[1,1].Sts.<member>` over ADS. The `GVL.V101_HMI` reference alias is not part of this profile. Other instances use their own array indices and bindings.

Status priority is `FAULT` when `Sts.Error` is true, then `CONFLICT` when both end position feedback signals or both movement signals are true, then `EXTENDING`, `RETRACTING`, `EXTENDED`, `RETRACTED`, and `UNKNOWN`. Until all six BOOL values are valid, including after a disconnect, the widget shows `WAITING FOR DATA`; cached fault/conflict values do not bypass this gate. The mode badge separately shows `MANUAL`, `AUTO`, or `MODE ?` when mode feedback is unavailable.

The widget exposes no command, write, or `postValue` function. Version 1 deliberately has no `State` tag, PLC structure changes, or automatic prefix binding.
