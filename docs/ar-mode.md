# FUXA AR mode

AR mode displays project Views over a browser camera feed at `/ar`. It uses existing FUXA Views and their normal runtime bindings; it is not a separate PLC communication path.

## Configuration and operation

Configure marker IDs and their target Views in the AR marker management page. Each mapping stores `id`, `viewId`, optional `label` and `ttlMs` in project AR settings. The marker editor can generate a QR image for the configured ID. IDs are trimmed and must match the detected text.

Open `/ar` over HTTPS or localhost and allow camera access. The scanner uses the browser BarcodeDetector when available, with the bundled html5-qrcode scanner as a fallback. Detected configured markers show their mapped `app-fuxa-view`; a marker expires after its configured timeout (default 3000 ms). Missing mappings do not select another View. `?debug=true` displays scanner and mapping diagnostics.

Leaving the page stops camera tracks and scanning and releases the page's subscriptions. Camera permission, QR detection and display readability require validation on the target device/browser; source support does not establish Safari/iPad or plant acceptance.

## Maintenance

The implementation is in `client/src/app/ar/`, with persisted shapes in `client/src/app/_models/ar.ts`. `ar-view.service.ts` owns marker visibility and mapping reloads; `ar-view.component.ts` owns camera/scanner lifecycle. Preserve the existing View instance isolation when changing embedded rendering. Future tracking libraries or native applications are not part of the current interface.
