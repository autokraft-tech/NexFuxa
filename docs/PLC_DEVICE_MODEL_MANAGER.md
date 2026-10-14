# Phase 3B PLC Device Model Manager

Open **Devices → ⋮ → PLC Device Models** as a project administrator. The catalog shows the read-only `Valve@1.0.0` model from `tools/plc-device-model/models/valve.v1.json`, including every PLC leaf and its FUXA type. The editor is available only when the Devices page is editable.

In **Device Instances**, add rows or import a Phase 3A CSV. Select an existing ADSclient connection by its internal ID, set the Valve instance name, array symbol, indices, and profile, then **Save Configurations**. Export CSV to keep a copy. Removing a row changes only the saved configuration; it does not remove Tags. Configurations are stored in the FUXA project database and can cover multiple ADS devices.

Select one **Preview ADS device** and click **Preview Tags**. The preview is read-only and lists each candidate's name, ADS address, PLC type, FUXA type, device, and Created/Reused/Conflict operation. It also shows counts. A batch for one ADS device can contain multiple Valve instances. If conflicts are zero, click **Apply to Project** and accept the confirmation. The server checks that the project device and saved configuration state still match the preview, regenerates candidates with Phase 3A, and persists the one ADS device. Re-preview if the project changed. The Devices page refreshes after success. Apply never writes a PLC value.

## API

All routes require the existing authentication middleware and administrator permission. Requests use JSON. The route rejects request bodies over 100 KB; CSV input is limited to 64 KB and configurations to 100 rows. Only the bundled Valve model is accepted.

| Route | Request | Result |
| --- | --- | --- |
| `GET /api/plc-device-models` | None | Model metadata and flattened member tree |
| `GET /api/plc-device-models/instances` | None | Saved configuration rows |
| `POST /api/plc-device-models/instances` | `{ "rows": [ ... ] }` | Validates and saves rows in project general storage |
| `POST /api/plc-device-models/csv` | `{ "csv": "..." }` | Parses Phase 3A CSV into rows |
| `POST /api/plc-device-models/preview` | `{ "rows": [ ... ] }` | Full candidate report and opaque preview token; no writes |
| `POST /api/plc-device-models/apply` | `{ "token": "...", "confirmed": true }` | Revalidates and commits one ADS device |

The six row fields are `Device Name`, `PLC Device ID`, `Device Model`, `Array Symbol`, `Array Indices`, and `Profile`. The model is `Valve` or `Valve@1.0.0`; profiles are Full, Status, Control, and Engineering. A preview token belongs to its authenticated user and expires after ten minutes. Invalid input returns HTTP 400; stale previews and Tag conflicts return HTTP 409; unauthorized requests return HTTP 401. A multi-device Apply batch is rejected before any write.

## Isolated checks

Run `node --test tools/plc-device-model/test/phase3a.test.cjs tools/plc-device-model/test/phase3b.test.cjs`, `npm test` in `server`, and `npm run build -- --configuration production` in `client`. The server suite includes a temporary SQLite project reopened in a separate process, checks persisted configuration and 40 Valve Tags, and verifies that an existing widget binding ID and Tag object survive.

For browser testing, create a fresh temporary FUXA user directory, seed only a sanitized fixture with its ADS device disabled, and run `node server/main.js --userDir <temporary-directory> --port 1881`. Open `/device` and test catalog, CSV import/export, save, preview, confirmation, and the normal Tag controls. Keep the temporary user directory outside `.local/fuxa-dev`; the disabled ADS fixture does not connect to a PLC. Browser and SQLite checks do not replace a later test against the operator's actual TwinCAT PLC and Docker project.
