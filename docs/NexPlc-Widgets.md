# NexPlc widgets in NexFuxa

This fork keeps FUXA's existing SVG widget, tag, and ADS driver paths. NexPlc widgets live in `server/_widgets/NexPlc/` and use FUXA's exported SVG variables. No NexPlc-specific code is needed in the FUXA editor or ADS driver for the first milestone.

## Milestone 1: Valve extended feedback

`Valve.svg` is a read-only widget based on the valve symbol already used in FUXA. Its only exported variable is `_pb_extended`. The icon reports **EXTENDED** for true, **NOT EXTENDED** for false, and **UNKNOWN** before a valid value arrives or when the value is unavailable. `false` does not prove that the actuator is retracted or that the valve is closed.

1. Configure the existing FUXA ADS device for NexPlc. Create a Boolean tag whose ADS address is exactly `GVL.g_aValve_HMI[1,1].Sts.Extended` (for example, name the FUXA tag `Valve_1_1_Extended`). Do not select the parent structure or infer other member addresses.
2. Start NexFuxa and open the editor. Select **Valve.svg** from the **NexPlc** widget group and place it in a view.
3. Select the placed widget. In its widget properties, bind `_pb_extended` to the Boolean FUXA tag created above. Save the project.
4. In runtime, verify that true shows **EXTENDED**, false shows **NOT EXTENDED**, and a missing value shows **UNKNOWN**. Place a second copy and verify that each copy can be bound independently.

The SVG contains no ADS address. Tag selection remains in the FUXA project, so the same widget can represent another valve after that valve's exact leaf symbol is independently verified.

## Phased implementation plan

| Phase | Proposed PR | Exit check |
| --- | --- | --- |
| 1. Read-only Valve SVG | Add `Valve.svg`, its binding guide, and focused widget checks. | Widget appears in the library and responds to the verified leaf tag on a live NexPlc connection. |
| 2. Verified valve signals | Add only NexPlc status fields that have each been read successfully as leaf ADS symbols; define state precedence, including missing and conflicting feedback. | Each new state has a verified address and a runtime test. |
| 3. Prefix-driven Faceplates | Introduce a faceplate instance prefix, resolve documented suffixes to FUXA tag IDs, and report missing bindings. Reuse FUXA's current widget and tag model. | Two faceplate instances with different prefixes show independent values and safe missing-tag states. |
| 4. Commands and reuse | Add controls only after command addresses, permissions, interlocks, and write behavior have been confirmed with NexPlc. Extend the pattern to other device types. | Authorized writes and failure behavior are tested with the target PLC. |

Keep each phase on a feature branch and review it through a PR into `master`. Sync upstream FUXA separately so NexPlc changes remain easy to review.
