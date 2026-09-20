# Security fixes — 2026-09-20

Addresses the three actionable findings in the LOCAL Android 1.0.7 source audit.

- Restore assigns new page IDs for every restored page, validates page-ID uniqueness across the entire input, and rejects cross-document ownership conflicts in both the repository transaction and a SQLite insert trigger. Normal edits to a document's own pages still work.
- Unauthenticated document tools receive a display-only private-document projection, including redacted filenames, tags, classification, OCR, annotations and image references. Operations retain the original objects and their existing authentication checks. Global search excludes private content; the Home screen explains that private documents can be searched within the authenticated viewer. Tag filters and title sorting no longer expose private values.
- Successful legacy IndexedDB migration now clears source records in a committed transaction. A separate cleanup marker covers users migrated by earlier releases without reimporting stale or deleted documents. Failed migration/cleanup retains the source and can be retried. This logically removes obsolete records; it does not claim forensic secure erasure of flash storage.

Validation: 83 tests pass, including cross-document SQL collision rejection against the production schema/UPSERT, restored-page ID isolation, duplicate-page input rejection, private display/search behavior, migration failure recovery, transaction-abort recovery, and cleanup of previously migrated installations. TypeScript checks pass. No real user documents were used in the regression tests.

Large-backup streaming restore, crash-safe filesystem journaling, and authentication-bound native key use remain separate hardening work. These changes do not repair documents already corrupted by an earlier restore. No GitHub release or installable APK is published by this change alone.
