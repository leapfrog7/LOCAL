# LOCAL 1.0.4

Android search, Home and PDF reading improvements:

- Prevent slower, older searches from replacing the latest results.
- Keep search results in relevance order and show search progress with retry feedback.
- Simplify Home with one search field and a consolidated Filters sheet.
- Default recent documents to the last three weeks, with an All time option. Search still covers older documents.
- Reduce native image-path lookups to speed up document loading.
- Rename Library to Home.
- Add explicit Save and Cancel controls, validation and save-error feedback when renaming documents.
- Keep PDF controls visible for 5.2 seconds instead of 3.2 seconds, and keep them visible while renaming.

Validation: 58 automated tests, production web build, Android release lint/unit tests, APK signature verification, and browser checks for out-of-order search responses, relevance, rename save/cancel, Android layout and toolbar timing. Physical-device upgrade testing was not available for this release.
