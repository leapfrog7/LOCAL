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
- Multi-page capture through Google ML Kit Document Scanner, with image import and a local camera fallback
- ML Kit edge detection, automatic capture, perspective correction, and native high-resolution camera output
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
- Native ML Kit OCR for English and Devanagari, barcode recognition, and bundled Tesseract fallback assets
- Durable page-level OCR jobs with restart recovery and bounded retries
- Background OCR that survives activity recreation, with immediate PDF access and bounded retries
- Smart on-device titles and metadata extraction for common receipts, bills, letters, and office documents
- Document viewer, folder browser, rename, deletion, post-save crop correction, and one-tap PDF export
- On-device scanned-page PDF generation with page rotation preserved
- Browser download and native Android save/share sheet
- App and document-level biometric locking with hidden private previews
- AES password protection for portable PDFs, independent from LOCAL's private lock
- Passphrase-encrypted local backup and restore
- Replaceable scanner, OCR, PDF, repository, and sharing contracts
- Capacitor Android shell with Filesystem and Share plugins available

Google ML Kit Document Scanner owns Android capture, edge detection, cropping, and perspective correction. LOCAL retains its own page editor, enhancement presets, storage, OCR queue, searchable-PDF generation, and browser-compatible fallback scanner. Native OCR and barcode recognition remain on the device; bundled Tesseract assets provide the browser fallback without a CDN dependency.

`@capacitor-community/sqlite` uses SQLCipher even for unencrypted databases. Before public distribution, review the applicable encryption export/self-classification obligations for the target jurisdictions and stores.

## Architecture

Domain types live in `src/domain`. UI code depends on contracts in `src/services/contracts.ts`, not OCR engines, SQLite, or native APIs directly. This keeps browser and native implementations replaceable without changing document-management screens.

No analytics, telemetry, authentication, cloud database, remote OCR, or remote storage is included.
