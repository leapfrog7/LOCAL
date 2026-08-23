# LOCAL camera quality roadmap

## Phase 1 — capability-aware web camera (implemented)

- Capture a photographic still with `ImageCapture.takePhoto()` at the camera's maximum reported dimensions.
- Fall back to the previous high-quality video-frame capture when the API is unavailable.
- Map viewfinder taps through `object-fit: cover` cropping into normalized sensor coordinates.
- Request autofocus, auto-exposure, and auto-white-balance metering at the tapped point when the device exposes those constraints.
- Show honest focus feedback and fall back to continuous autofocus when tap metering is unavailable.
- Expose torch control only on cameras that report torch support.
- Detect repeated soft frames and document movement, then surface short capture guidance.
- Keep capture controls one-thumb reachable and provide subtle capture haptics when supported.

## Phase 2 — physical-device compatibility pass

Test representative Android devices and record `getCapabilities()`, `getSettings()`, still dimensions, focus behavior, torch behavior, capture latency, and orientation. Tune the sharpness threshold using actual document captures rather than blocking users based on a synthetic threshold.

Success criteria:

- A tap visibly moves the metering point on supported devices.
- Still output is larger than the preview stream where the device exposes photographic capture.
- Unsupported devices never display a control that silently does nothing.
- Portrait and landscape output preserve the expected orientation.

## Phase 3 — native Android camera

If Phase 2 shows inconsistent WebView camera controls, add a Capacitor plugin backed by Android CameraX. Keep the web implementation as the desktop and unsupported-device fallback.

The native capture surface should own:

- Camera preview and lifecycle.
- CameraX focus and metering actions at the tapped point.
- High-resolution `ImageCapture` output.
- Torch, lens selection, exposure compensation, and orientation.
- Focus/metering completion events for the existing reticle UI.
- Capture-quality metadata without uploading image data.

Do not replace the current scanner processing pipeline. The native plugin should return a local image URI plus dimensions and orientation so that edge detection, perspective correction, enhancement, OCR, and storage continue through the existing LOCAL pipeline.
