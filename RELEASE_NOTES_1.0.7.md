# LOCAL 1.0.7

- Android encrypted backups write incrementally instead of keeping the whole library in memory, and use a save-location picker with clear cancellation handling.
- Password-protected PDF import prompts for a password, supports retries and cancellation, and shows page preparation progress.
- Choose “Save an unlocked copy” to save a password-free PDF to a location you select. Import does not overwrite the selected original.
- Cleans temporary decrypted import files and validates backup contents before restore.
- Prevents failed password changes from overwriting the existing PDF and blocks compression from silently removing PDF password protection.
- Protects sensitive password/backup screens and disables bridge argument logging.

Large backup restoration still requires further memory improvements. See `docs/ANDROID_FLOW_SECURITY_REVIEW_1.0.7.md` for findings and remaining recommendations.
