# LOCAL Privacy Policy

Effective date: 23 August 2026

LOCAL — Local OCR, Capture, Archive & Lookup processes documents on the user's Android device.

## Data collection

LOCAL has no account service and does not collect analytics, advertising identifiers, usage telemetry, crash reports, document contents or personal information on a developer-controlled server.

## On-device data

Scanned and imported pages, thumbnails, generated PDFs, recognised text, folders, tags and search indexes are stored in private app storage. Database records are protected with SQLCipher. Documents marked Private also have their stored page and PDF files encrypted with an Android Keystore-backed key.

## Permissions and network access

Camera access is used only to scan documents. Storage access on older Android versions is used only for an export initiated by the user. LOCAL does not upload documents for OCR, search or synchronization. Google Play services may download or update ML Kit scanning and recognition components; document processing remains on the device.

## Sharing and backups

Data leaves LOCAL only when the user explicitly exports, opens or shares a PDF or OCR text, or creates and shares an encrypted backup. The receiving app or storage provider's privacy practices then apply. Backup files are encrypted using the passphrase chosen by the user.

## Retention and deletion

Documents remain until the user deletes them or removes the application. Android backup and device-transfer extraction are disabled. Retain an encrypted backup before uninstalling if the documents are still needed.

## Contact

Questions can be raised through the repository issue tracker: https://github.com/leapfrog7/LOCAL/issues
