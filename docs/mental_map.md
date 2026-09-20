# LOCAL project mental map

This guide explains how LOCAL is put together, how data moves through the app, and where to look when changing a feature. It describes the current repository, including the browser fallbacks and the native Android implementation.

## Start with this picture

LOCAL is a React application packaged as an Android app by Capacitor. Most screens and workflows are TypeScript. Android-specific features such as document scanning, background OCR, encrypted storage, biometrics, PDF import/export, and password protection are implemented as Java Capacitor plugins.

```text
User interface (React)
        |
        v
Feature workflows and service contracts
        |
        +----------------------+----------------------+
        |                      |                      |
        v                      v                      v
Browser fallback        Capacitor plugins       Persistent data
IndexedDB, Tesseract,    Java + Android APIs     SQLite/SQLCipher,
jsPDF, Web Share         ML Kit, WorkManager     private files
```

There is no application server. OCR, indexing, PDF creation, metadata extraction, and document storage run on the device.

## Repository at a glance

```text
LOCAL/
├── src/                         React and TypeScript application
│   ├── App.tsx                  Screen router and main workflow coordinator
│   ├── main.tsx                 React entry point
│   ├── styles.css               Global application styles
│   ├── domain/                  Core data and processing types
│   ├── features/                Feature-specific UI and scanner algorithms
│   └── services/                Storage, OCR, PDF, search, security, and workflows
├── android/                     Native Android/Capacitor project
│   └── app/src/main/java/
│       └── in/local/vault/      LOCAL's native Capacitor plugins
├── public/ocr/                  Bundled browser OCR worker, WASM, and languages
├── scripts/                     Build and OCR-asset helper scripts
├── site/                        Static GitHub Pages download/privacy site
├── docs/                        Engineering and product documentation
├── .github/workflows/           GitHub Pages and signed-release automation
├── capacitor.config.ts          Web-to-Android packaging configuration
├── package.json                 Dependencies, version, and common commands
├── PRIVACY.md                   Public privacy commitments
└── RELEASE.md                   Android signing and release procedure
```

## The main layers

### 1. Domain model

Start at [`src/domain/types.ts`](../src/domain/types.ts). It defines the vocabulary shared by the whole app:

- `VaultDocument` is the top-level document record.
- `DocumentPage` holds page file references, rotation, OCR state/text/words, detected barcodes, crop corners, and rendering adjustments.
- `DocumentPage.annotations` stores versioned pen/highlighter strokes in normalized coordinates relative to the unrotated source image, so drawing is independent of display size, zoom, and device rotation.
- `DocumentStatus` and `processingStage` describe the document processing lifecycle.
- `Screen` is the app's lightweight navigation model.
- `DocumentSmartMetadata` contains locally inferred type, organisation, date, amount, and identifier information.

Durable OCR job types live in [`src/domain/processing.ts`](../src/domain/processing.ts).

When adding persisted fields, update the domain types first, then the SQLite schema/row mapping, browser persistence behavior, backup serialization, and any migration logic.

### 2. Application shell and screens

[`src/App.tsx`](../src/App.tsx) is currently the composition root. It:

- owns the active `Screen` state instead of using a routing library;
- loads and refreshes documents;
- coordinates app locking and Android Back behavior;
- renders Library, Folders, Scan, Document Tools, Settings, Viewer, Trash, and Scanner Lab screens;
- starts import, scan, save, OCR, and document-update workflows;
- contains several screen components that have not yet been split into separate files.

This file is large because LOCAL grew from a compact prototype. Business-heavy operations should normally be added to `src/services/` and called from `App.tsx`, rather than implemented directly inside UI handlers. A future refactor can move each top-level screen into `src/features/<feature>/` without changing the domain/service boundaries.

[`src/main.tsx`](../src/main.tsx) mounts React. [`src/styles.css`](../src/styles.css) is the global visual system and contains both foundational styles and feature-specific blocks.

### 3. Feature UI

Feature folders contain UI or algorithms that are cohesive enough to stand alone:

- [`src/features/actions/ActionsScreen.tsx`](../src/features/actions/ActionsScreen.tsx): combine, split, reorder, insert, compress, cleanup, and OCR export flows.
- [`src/features/library/components/BulkDocumentTools.tsx`](../src/features/library/components/BulkDocumentTools.tsx): multi-document move, tag, privacy, and delete tools.
- [`src/features/library/components/CombineDocumentsSheet.tsx`](../src/features/library/components/CombineDocumentsSheet.tsx): ordered combination UI.
- [`src/features/viewer/components/ZoomablePage.tsx`](../src/features/viewer/components/ZoomablePage.tsx): pinch/drag and smart double-tap zoom, virtualized continuous pages, OCR highlights, and page-swipe detection.
- [`src/features/viewer/components/TagEditorSheet.tsx`](../src/features/viewer/components/TagEditorSheet.tsx): document tag editing.
- [`src/features/viewer/components/CompressionSheet.tsx`](../src/features/viewer/components/CompressionSheet.tsx) and [`PageExtractSheet.tsx`](../src/features/viewer/components/PageExtractSheet.tsx): focused PDF operations.
- [`src/features/settings/components/StorageSecurityPanel.tsx`](../src/features/settings/components/StorageSecurityPanel.tsx): storage-security status UI.

The scanner has its own deeper feature area:

```text
src/features/scanner/
├── components/       Camera, native scanner, crop editor, and Scanner Lab UI
├── processing/       Edge detection, geometry, perspective, colour, and cleanup
├── services/         Page-image processing orchestration
└── scannerTypes.ts   Scanner-specific types
```

The native Google scanner normally owns capture, edge detection, crop, and perspective correction. The TypeScript scanner pipeline remains important for editing, enhancement presets, browser fallback, tests, and Scanner Lab.

### 4. Services

Services contain most non-visual behavior. [`src/services/contracts.ts`](../src/services/contracts.ts) defines the small replaceable interfaces for scanning, OCR, PDF generation, repositories, and sharing.

The most important services are:

| Concern | Primary file | Responsibility |
| --- | --- | --- |
| Document access | [`documentRepository.ts`](../src/services/documentRepository.ts) | Chooses native SQLite or browser IndexedDB and returns hydrated documents |
| Metadata database | [`sqliteRepository.ts`](../src/services/sqliteRepository.ts) | SQLCipher connection, schema, migrations, folders, pages, jobs, and FTS search |
| Page/PDF files | [`documentStorageService.ts`](../src/services/documentStorageService.ts) | Persists, hydrates, migrates, and removes document files |
| Private files | [`privateStorageService.ts`](../src/services/privateStorageService.ts) | Manages encrypted private-document sessions and decrypted temporary access |
| Processing lifecycle | [`processingQueue.ts`](../src/services/processingQueue.ts) | Durable per-page OCR, retries, cancellation, recovery, title inference, PDF finalization |
| Job persistence | [`processingJobRepository.ts`](../src/services/processingJobRepository.ts) | Stores OCR job state and cancellation markers |
| OCR | [`ocrService.ts`](../src/services/ocrService.ts) | Selects native ML Kit or bundled Tesseract fallback |
| Native background OCR | [`backgroundProcessingService.ts`](../src/services/backgroundProcessingService.ts) | TypeScript bridge to Android WorkManager processing |
| Search | [`searchService.ts`](../src/services/searchService.ts) | Text search, structured filters, snippets, and result scoring |
| PDF creation/export | [`pdfService.ts`](../src/services/pdfService.ts) | Searchable PDF generation, invisible OCR layer, save/share/open, compression, passwords |
| Annotations | [`annotationService.ts`](../src/services/annotationService.ts) | Normalized strokes, erasing, annotated thumbnails, copy/update finalization, and versioned PDF replacement |
| PDF import | [`pdfImportService.ts`](../src/services/pdfImportService.ts) | Android picker and native page rendering |
| PDF operations | [`documentOperationsService.ts`](../src/services/documentOperationsService.ts) | Combine, extract, reorder, insert, and remove pages |
| Scan entry points | [`scannerService.ts`](../src/services/scannerService.ts) and [`nativeDocumentScannerService.ts`](../src/services/nativeDocumentScannerService.ts) | Image import/fallback and native scanner bridge |
| Folder rules | [`folderService.ts`](../src/services/folderService.ts) | List, create, rename, and remove folders |
| Backup/restore | [`backupService.ts`](../src/services/backupService.ts) | Passphrase-encrypted portable backup and restore |
| App authentication | [`appLockService.ts`](../src/services/appLockService.ts) | Biometric/device-credential bridge and preference |
| Screenshot protection | [`screenSecurityService.ts`](../src/services/screenSecurityService.ts) | Enables secure-window behavior for private documents |
| Smart titles | [`documentTitleService.ts`](../src/services/documentTitleService.ts) | Infers titles and structured metadata from OCR |
| Storage checks | [`storageHealthService.ts`](../src/services/storageHealthService.ts) | Estimates required space before saving/importing |
| Text export | [`textExportService.ts`](../src/services/textExportService.ts) | Whole-document TXT and Markdown export |

## Native Android layer

[`android/app/src/main/java/in/local/vault/MainActivity.java`](../android/app/src/main/java/in/local/vault/MainActivity.java) registers LOCAL's Capacitor plugins:

| Native class | Used for |
| --- | --- |
| `DocumentScannerPlugin` / `DocumentScannerActivity` | ML Kit document scanning and native capture |
| `MlKitOcrPlugin` | English/Devanagari OCR and barcode recognition |
| `BackgroundProcessingPlugin` / `NativeOcrWorker` | WorkManager OCR that survives activity recreation |
| `PdfImportPlugin` | Picking and rendering imported PDFs with Android's PDF renderer |
| `PdfDownloadPlugin` | Save, open, share preparation, and PDF password protection |
| `BiometricLockPlugin` | Biometric or device-credential authentication |
| `DatabaseSecurityPlugin` | Safe migration and recovery around SQLCipher database encryption |
| `VaultEncryptionPlugin` | Android Keystore-backed private file encryption and screen security |

TypeScript accesses these classes with Capacitor's `registerPlugin(...)`. A plugin's string name must match its Java `@CapacitorPlugin(name = ...)` declaration.

Android dependencies, package identity, signing hooks, SDK levels, minification, and version code are configured in [`android/app/build.gradle`](../android/app/build.gradle). Permissions and component declarations are in [`android/app/src/main/AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml).

Files under `android/app/src/main/assets/public/` are generated by `npx cap sync android`; edit the TypeScript/web source instead of editing generated assets.

## Persistence and security model

On Android, metadata is stored in an encrypted SQLite/SQLCipher database named `local_vault`. The schema in [`sqliteRepository.ts`](../src/services/sqliteRepository.ts) contains:

- `documents` for document-level metadata and state;
- `pages` for ordered page metadata and OCR results;
- `folders` for folders that can exist even when empty;
- `processing_jobs` for resumable background work;
- `settings` for migration and application markers;
- an FTS5 index when supported for fast local search.

Large images and PDFs are files, not database blobs. A document page can have separate original, visible processed, OCR-optimized, and thumbnail files. Repository reads “hydrate” stored paths into URLs usable by the UI; writes “persist” transient data URLs into durable files.

Private documents add Android Keystore-backed file encryption and require a revealed session before decrypted URLs are exposed. Portable PDF passwords are a separate feature: they protect exported/shared PDF files, while LOCAL's private lock protects access inside the app.

Browser development and the public web workspace use IndexedDB for metadata, bundled Tesseract assets from `public/ocr/`, and an on-demand PDF.js worker for local PDF page rendering. Browser behavior does not reproduce Android biometrics, Keystore protection, native sharing, or background processing, so the interface explains browser-storage retention and keeps the Android download visible.

## Core runtime flows

### Scan and save

```text
Scan button
  -> native ML Kit scanner (or camera/image fallback)
  -> DocumentPage objects
  -> review/edit/crop/reorder
  -> documentsRepository.save()
  -> immediate Viewer
  -> processingQueue.processDocument()
```

Saving is intentionally not blocked on OCR. The document appears immediately, while processing continues in the background.

### OCR and searchable PDF

```text
Saved document
  -> durable page jobs
  -> Android WorkManager + ML Kit (native)
     or Tesseract worker (browser fallback)
  -> OCR text, words, confidence, languages, barcodes
  -> smart title/metadata inference
  -> jsPDF page images + invisible positioned OCR text
  -> persisted searchable PDF
  -> FTS index / status = indexed
```

[`processingQueue.ts`](../src/services/processingQueue.ts) is the best starting point when OCR is stuck, retry behavior is wrong, or a document never becomes searchable.

### Import PDF

```text
Android file picker or browser file input
  -> PdfImportPlugin on Android, or locally loaded PDF.js in the browser, validates and renders each PDF page
  -> imported pages become ordinary DocumentPage records
  -> storage check and folder selection
  -> same save, OCR, PDF, and indexing pipeline as a scan
```

This design avoids maintaining a separate kind of “imported document.” After import, scans and PDFs use the same model and tools.

### Search

Library input and filters call [`searchService.ts`](../src/services/searchService.ts). Native document retrieval can use SQLite FTS5; structured filtering additionally considers folder, tag, privacy, type, organisation, amount, identifier, and dates. Search results carry page matches/snippets so the Viewer can open the relevant page and highlight OCR words.

### Delete and restore

A normal delete sets `deletedAt`; it does not immediately destroy files. Recently Deleted lists those records, permits restore, and permanently removes records/files older than 30 days. Permanent removal flows through the repository so metadata and stored files stay consistent.

## Navigation and UI state

LOCAL does not use React Router. The `Screen` union and `screen` state in `App.tsx` select the current top-level screen. The persistent bottom navigation is intentionally limited to four everyday destinations: Library, Folders, Scan, and Settings. Document Tools is opened from the Library's contextual quick actions instead of occupying a permanent navigation slot.

At browser widths of 900px and above, `App.tsx` adds the `web-platform` shell and `styles.css` replaces the mobile bottom navigation with a persistent desktop sidebar, wider grids, desktop tool sheets, and pointer hover feedback. Page-operation grids use the full stored page image instead of stretching the small list thumbnail, keep the complete page visible with `object-fit: contain`, and expose drag ordering alongside accessible arrow controls. The Viewer uses measured source and canvas dimensions to make its baseline **Fit** state contain the whole portrait, landscape, or rotated page; zoom is relative to that fitted size. The browser-only `desktop-viewer` class keeps desktop reading controls stable and gives the thumbnail strip enough inspection space. These desktop classes are never added inside Capacitor, so desktop layout rules cannot change the Android app even on a large display. Narrow browsers deliberately retain the mobile layout. Motion is brief and functional, with `prefers-reduced-motion` overrides.

Android Back first gives active overlays/editors a chance to consume a custom `local:back` event. Otherwise it returns a non-home screen to the Library; a quick second Back minimizes the app. When adding a modal or sheet, add it to this dismissal order so Back closes the nearest UI layer before navigating away.

Per-document page, reading mode, zoom, scroll position, bookmarks, page theme, margin preference, and screen-awake preference are stored through [`viewerStateService.ts`](../src/services/viewerStateService.ts). This lightweight reading preference is separate from durable document content: document metadata belongs in the repository, while disposable viewer position may use versioned `localStorage`. Continuous and two-page views keep stable lightweight page placeholders and decode images only around the viewport. The OCR reading view reflows existing on-device recognised text and uses the installed system speech engine for read-aloud. Page fitting is automatic; Single page view provides explicit 25%–400% zoom controls.

The global Small, Medium, or Large interface-text preference is also local presentation state. Semantic title, heading, body, label, and caption tokens scale together, and primary mobile controls use a shared 44px minimum touch target. Library selection follows the familiar mobile convention: hold a document to enter selection, then tap additional documents. **Document tools** groups operations on documents already stored in LOCAL; it is not analytics, tracking, or a reporting service. Returning users get compact Scan, Import, and Document Tools actions instead of the onboarding hero. The Library exposes only the most useful category chips and keeps the complete category/folder/tag/privacy filter set in one sheet. Folder cards summarize document/page counts and show up to three local thumbnails, while folder creation uses the floating action appropriate to that screen.

Annotations are durable document content, not viewer state. The viewer edits normalized freehand strokes, OCR-snapped highlights, geometric shapes, arrows, and positioned text notes. SQLite stores them in `pages.annotations_json`; browser IndexedDB and encrypted backups serialize them with each page; PDF generation composites them while retaining the existing invisible OCR layer. Drafts recover automatically, using encrypted SQLite settings on Android. **Done** asks whether to create an annotated copy or update the current document. Finalization rebuilds thumbnails and a versioned PDF without changing recognised text/state or scheduling recognition again; the old PDF is removed only after the new metadata save succeeds.

Viewer language should describe user outcomes rather than implementation details. The normal interface calls reflowed recognition output **Text view**, uses **Recognise text again** for recovery, and reserves “OCR” for engineering documentation and diagnostics. In normal reading mode, the compact page button opens thumbnails; annotation mode replaces ordinary page controls with its focused tool bar until the user taps **Done**.

## Where do I change...?

| Goal | Start here |
| --- | --- |
| Library cards, filters, sorting, or bottom navigation | `src/App.tsx`, then `src/styles.css` |
| PDF viewer layout, More sheet, page text selection | `src/App.tsx` Viewer component and `src/features/viewer/components/ZoomablePage.tsx` |
| PDF action workflows | `src/features/actions/ActionsScreen.tsx` and `src/services/documentOperationsService.ts` |
| Scan review/editor UI | `src/App.tsx` review screen and `src/features/scanner/components/ScanPageEditor.tsx` |
| Image enhancement quality | `src/features/scanner/processing/` and `scannerProcessingService.ts` |
| OCR language, timeout, or fallback | `src/services/ocrService.ts`; native recognition in `MlKitOcrPlugin.java` |
| OCR recovery or progress state | `src/services/processingQueue.ts`, `processingJobRepository.ts`, and native background classes |
| Imported-PDF compatibility | `src/services/pdfImportService.ts` and `PdfImportPlugin.java` |
| Search behavior or filters | `src/services/searchService.ts` and SQLite FTS code in `sqliteRepository.ts` |
| Database field/schema | `src/domain/types.ts` plus `src/services/sqliteRepository.ts` |
| Stored image/PDF lifecycle | `src/services/documentStorageService.ts` |
| Private-document security | `privateStorageService.ts`, `VaultEncryptionPlugin.java`, and `screenSecurityService.ts` |
| Backup format or restore policy | `src/services/backupService.ts` and its tests |
| Folders | `src/services/folderService.ts` and Folders UI in `App.tsx` |
| App colors, spacing, typography | `src/styles.css` |
| App icon or splash | `android/app/src/main/res/` |
| Android permissions | `android/app/src/main/AndroidManifest.xml` |
| Package/version/signing configuration | `package.json`, `android/app/build.gradle`, `RELEASE.md` |
| GitHub APK release | `.github/workflows/release.yml` |
| GitHub download page | `site/` and `.github/workflows/pages.yml` |

## Tests and useful commands

```sh
npm install                 # install exact JavaScript dependencies
npm run dev                 # browser development server
npm test                    # Vitest unit tests
npm run build               # type-check and production web build
npm run android:sync        # copy current web build and plugins into Android
npm run android:open        # open the Android project in Android Studio
npm run android:apk         # scripted Android APK build helper
```

Tests live beside their subjects. Existing suites cover edge/perspective geometry, OCR behavior, searchable PDF text placement, search, storage estimates, processing recovery, document operations, timeouts, smart titles, and encrypted backup behavior. Native instrumentation tests under `android/app/src/androidTest/` cover PDF import/rendering, PDF passwords, and encryption.

For a normal TypeScript change, run `npm test` and `npm run build`. For a native/plugin, storage, permission, or release change, also sync Android and run the relevant Gradle tests/lint before testing on a device.

## Build and release path

1. `npm run build` creates `dist/`.
2. `npm run android:sync` copies `dist/` and Capacitor configuration into the Android project.
3. Gradle builds and minifies the Android release.
4. Release signing values are supplied through environment variables or GitHub Actions secrets; keystores and passwords must never enter the repository.
5. `.github/workflows/release.yml` verifies the APK signature and publishes versioned and `LOCAL-latest.apk` assets.
6. The static site in `site/` links to GitHub's latest-release APK.

See [`RELEASE.md`](../RELEASE.md) for the exact release procedure and [`docs/ANDROID_APK.md`](ANDROID_APK.md) for Android build guidance.

## Design principles to preserve

- **Local first:** do not introduce a server dependency for document contents, OCR, search, or storage.
- **Immediate save:** users should not lose a capture because OCR or PDF generation is slow.
- **Recoverable operations:** destructive actions should be staged or confirmed, and failures should leave the previous document intact.
- **One document model:** scans, imported PDFs, and outputs from PDF tools should continue to use `VaultDocument` and `DocumentPage`.
- **Native behind contracts:** keep Android details in services/plugins so UI screens remain testable and browser development remains possible.
- **Separate metadata from large files:** SQLite tracks stable paths and state; image/PDF bytes belong in file storage.
- **Explicit sharing:** documents leave LOCAL only after a user chooses save, share, open externally, or backup.
- **No secret material in Git:** release keys, passwords, recovery files, generated APKs, and decrypted private files must remain outside source control.

## Suggested reading order

For a first pass through the codebase:

1. Read `src/domain/types.ts` to learn the data model.
2. Skim the top of `src/App.tsx`, then locate the screen you care about.
3. Read `src/services/contracts.ts` and `documentRepository.ts`.
4. Follow one saved document through `processingQueue.ts`, `ocrService.ts`, and `pdfService.ts`.
5. Read `sqliteRepository.ts` alongside `documentStorageService.ts` to understand persistence.
6. Open `MainActivity.java`, then inspect only the native plugin relevant to your task.
7. Use the “Where do I change...?” table above as the ongoing index.
