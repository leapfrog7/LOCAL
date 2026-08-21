# LOCAL

**Local OCR, Capture, Archive & Lookup** is an Android-first, private document vault. Document images, metadata, OCR text, and searches remain on the device.

## Run locally

```sh
npm install
npm run dev
```

## Android

The Capacitor Android project is included in `android/`.

```sh
npm run build
npm run android:sync
npm run android:open
```

Android Studio and an Android SDK are required to build the APK.

## Current implementation

- Mobile-first document library and local keyword search
- Multi-page camera capture or image import
- LOCAL-owned document processing pipeline with automatic boundary estimation
- Four-corner touch adjustment and perspective correction
- Clean Colour, Grayscale, and adaptive B&W rendering presets
- Local illumination normalization, bright-region white balance, conservative denoise, percentile contrast, and subtle sharpening stages
- Separate OCR-optimized page derivative independent of the visible preset
- Scanner Lab for processing representative documents and downloading side-by-side results
- Original capture retained separately from the processed scan
- Page review, crop correction, rotation, reordering, removal, title, and folder assignment
- Immediate local save with resumable page-by-page processing states
- Native Capacitor filesystem storage for original, processed, OCR, and thumbnail files on Android
- Stable file-path metadata with automatic migration from earlier embedded-image records
- Versioned native SQLite metadata, folders, pages, processing jobs, and FTS5 search index
- Automatic one-time IndexedDB-to-SQLite metadata migration on native platforms
- IndexedDB metadata repository and browser-development fallback, with no backend or network calls
- Bundled Tesseract LSTM runtime with English and Hindi traineddata; no runtime language download
- Durable page-level OCR jobs with restart recovery and bounded retries
- Document viewer, folder browser, rename, deletion, and one-tap PDF export
- On-device scanned-page PDF generation with page rotation preserved
- Browser download and native Android save/share sheet
- Explicit privacy status screen
- Replaceable scanner, OCR, PDF, repository, and sharing contracts
- Capacitor Android shell with Filesystem and Share plugins available

The current boundary detector uses a lightweight, fully local classical edge-energy pass and the image pipeline uses Canvas-based processing. The next scanner-quality phase will benchmark these stages against representative office documents and selectively introduce bundled OpenCV/WASM where it materially improves quadrilateral detection, illumination correction, or denoising. Google ML Kit Document Scanner is not used.

OCR uses a bundled local worker, WASM core, and compressed English/Hindi language assets from `public/ocr`. Explicit local paths and disabled OCR caching prevent CDN fallback and silent language downloads.

`@capacitor-community/sqlite` uses SQLCipher even for unencrypted databases. Before public distribution, review the applicable encryption export/self-classification obligations for the target jurisdictions and stores.

## Architecture

Domain types live in `src/domain`. UI code depends on contracts in `src/services/contracts.ts`, not OCR engines, SQLite, or native APIs directly. This keeps browser and native implementations replaceable without changing document-management screens.

No analytics, telemetry, authentication, cloud database, remote OCR, or remote storage is included.
