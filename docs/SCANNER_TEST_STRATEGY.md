# Scanner quality test strategy

Use Scanner Lab for every representative photograph. Keep fixtures private when they contain real documents; LOCAL does not need test documents committed to the repository.

## Required matrix

- White A4 on dark and light desks
- Warm/yellow room lighting
- Side, phone, finger, fold, and corner shadows
- Angled page and partial border contact
- Faded or noisy photocopy
- Red stamp and blue signature
- English, Hindi, and bilingual pages
- Small type, faint print, pencil, and highlighting

## Checks

1. Record detection confidence and confirm that all four corners surround the page. Low-confidence detection must remain manually correctable.
2. Compare Original, Auto, Clean Colour, Document, Grayscale, B&W, and Photocopy at full size.
3. In Clean Colour, verify neutral paper while red and blue markings remain distinguishable.
4. In Document and Photocopy, verify weak characters remain visible and background texture is reduced.
5. In B&W, inspect punctuation, Devanagari matras, thin strokes, and faint text for threshold loss.
6. Run OCR diagnostics and record worker/model state, input dimensions, duration, confidence, text, and the full error if present.
7. Repeat a 20-page batch on a mid-range physical Android device. Watch peak memory, UI responsiveness, processing time, cancellation, and foreground resume.
8. Use Android network inspection or airplane mode to confirm no OCR or document request leaves the device.

Do not tune from one ideal image. A change is accepted only if it improves the target defect without materially regressing stamps, signatures, Hindi strokes, or faint print elsewhere in the matrix.

## Automated geometry baseline

`edgeDetection.test.ts` constructs a perspective-skewed page edge map and verifies fitted boundaries. `perspective.test.ts` verifies exact mapping of all four selected corners. These tests protect geometry; they do not replace real-image quality review.
