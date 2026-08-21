# LOCAL implementation roadmap

The remaining production work is divided into phases so each storage or processing boundary can be verified before the next depends on it.

## Phase 1 — Durable document files (complete)

- Store original, processed, OCR, and thumbnail images in Capacitor `Directory.Data`.
- Keep only stable paths and metadata in IndexedDB on native platforms.
- Write a recoverable `metadata.json` beside document assets.
- Hydrate native paths into WebView-safe display URLs.
- Migrate earlier embedded data-URL records on first access.
- Delete the document directory and metadata together.
- Retain IndexedDB image data only for browser development.

## Phase 2 — SQLite metadata and full-text foundation (complete)

- Versioned SQLite schema for documents, pages, folders, jobs, and settings.
- One-time migration from IndexedDB metadata after native files are persisted.
- FTS5 index for titles, folders, and page OCR text, with a LIKE fallback.
- Stable repository interfaces so UI components never issue SQL.

## Phase 3 — Offline English/Hindi OCR (complete)

- Bundled Tesseract worker, LSTM WASM core variants, and English/Hindi language assets.
- Sequential recognition of the OCR-specific page derivative.
- Persisted page text, language, confidence, and failures.
- Transactional FTS refresh after each completed page.

## Phase 4 — Durable processing jobs (complete foundation)

- Persist page-level OCR jobs and checkpoints in SQLite, with a browser fallback.
- Reset interrupted jobs and resume sequentially after application restart.
- Retry OCR failures up to three times and retain error details.

Still required in this phase: explicit user cancellation, low-storage preflight, Android background execution beyond the foreground WebView lifecycle, and job-management UI.

## Phase 5 — Search, viewer, and searchable PDF (complete)

- Ranked full-text results now retain page-level matches and snippets.
- Search results open directly on the first matching page.
- The viewer includes in-document match navigation plus pinch, pan, and explicit zoom controls.
- Indexed documents receive a private persisted PDF with an invisible OCR text layer; export reuses it through Android's share/save sheet.

## Phase 6 — Production hardening

- Added conservative storage preflight before saving new scans.
- Added OCR pause, retry, and foreground-resume controls backed by durable jobs.
- Improve contour detection with locally bundled OpenCV/WASM where benchmarks justify it.
- Add native camera controls and lifecycle handling.
- Add automated processing, repository, migration, and end-to-end tests.
- Complete physical-device performance, privacy, low-storage, and interruption testing.
- Add optional biometric lock and encrypted-storage implementation.
- Set up and verify the iOS platform on macOS.
