# LOCAL 1.0.5

- Extract text from a whole PDF, page ranges, or individually selected pages. Copy selections together or export TXT/Markdown while retaining original page numbers.
- Text view uses the same page selection and copying controls, with a copy button beside each page boundary.
- Continuous scrolling is the default, including a one-time migration of the old automatically saved single-page mode. New explicit reading choices remain remembered.
- Spring-style button/double-tap zoom, frame-coordinated pinch updates, bounded single-page panning and continuous-scroll momentum. Reduced-motion preferences are respected.
- Zoom and page navigation occupy separate areas in portrait and landscape. Page navigation includes page numbers and bookmarked shortcuts.
- The annotation action uses a pen-nib icon. Drafts are not written to the original automatically: Done and Back offer Save a copy, Save to original, or Discard changes.
- Existing saved annotation strokes can be erased or cleared and saved explicitly. Undo/redo remains available for the current editing session.

Validation: TypeScript checks, 67 automated tests, browser checks for selected-page copying, annotation discard/copy/original persistence, bookmarks, and 320px/390px portrait plus landscape layouts. Native touch feel and an in-place upgrade still require a physical-device check.

Editing existing PDF text, images, and layout is a separate feature and is not included.
