# LOCAL 1.0.1

This update improves PDF compatibility and document organisation while keeping all processing on the device.

## Improvements

- Imports PDFs on a background worker so complex files no longer freeze or black out the interface.
- Uses Android's native PDF renderer for broader compatibility with valid PDFs containing unusual embedded images.
- Refreshes the complete folder list whenever **Move to folder** opens, including newly created and empty folders.
- Adds **Create & move** directly to the folder picker.
- Extends document zoom from 25% to 400%.
- Renames **Download PDF** to **Save a copy** to distinguish exporting from private in-app storage.
- Removes the duplicate **Compress PDF** command from the document menu; compression remains in the Actions tab.

LOCAL remains offline-first: document import, rendering, OCR, organisation, and search run locally on your device.
