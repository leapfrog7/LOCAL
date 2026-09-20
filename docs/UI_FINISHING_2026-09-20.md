# Home and Discover LOCAL finishing pass

Implemented compact Home tiles with forest-green Scan, blue Import PDF and violet Tools; readable wrapped labels; a neutral background; touch feedback and reduced-motion support. The import label stays specific to the supported PDF format.

The populated Home now follows one primary visual sequence: action tiles, search field, then Recent documents. Category, date range, sort, list/grid view, folder/tag/privacy filters, recent searches and advanced syntax are collapsed behind one search-options control. The default remains the last three weeks. Active non-default options appear as a small count on that control, so the screen stays quiet without hiding that filtering is in effect.

First-time Home waits for library loading to finish before showing its welcome and three-step introduction. Empty libraries do not show irrelevant search/filter controls. Populated libraries retain existing search and date filters. Explore LOCAL remains available from Home.

Discover LOCAL replaces the four-step Settings accordion with a dedicated screen containing six expandable task guides, contextual notes and working navigation to Scan, Home, Tools, Settings and Folders. It explains OCR readiness and limitations, selected-page text extraction, bookmarks, page operations, annotations, private documents versus PDF passwords, encrypted backup, recovery and the absence of automatic sync. Back returns to its entry point, including the Android custom-back event path.

Saved-document messages distinguish saved pages from searchable text, no recognised text and processing errors. New documents and annotation copies receive a Home completion message. Moving documents to Recently Deleted offers Undo; it reloads current stored records before restoring them. Privacy copy describes user-controlled export/share rather than making absolute data-transfer claims.

Verification: TypeScript and production build pass; all 83 regression tests pass. Browser automation verified Home and Discover at phone sizes, including 320px with large text; all six guide chapters expanded without horizontal overflow. Settings/Discover/Back, guide-to-Tools and guide-to-camera navigation worked. A synthetic IndexedDB document was deleted through the viewer and restored through Undo. No browser errors were reported. Screenshots were visually reviewed.

Limits: browser verification covers the shared UI and local persistence, not native Android camera permissions, biometric dialogs or physical-device haptics. Existing viewer appearance themes are unchanged. No new APK or GitHub release was published in this pass.
