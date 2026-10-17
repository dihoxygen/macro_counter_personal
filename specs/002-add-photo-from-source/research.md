# Research: Add Photo From Source

**Feature**: `002-add-photo-from-source` | **Date**: 2026-10-14 | **Plan**: [plan.md](./plan.md)

Each decision below resolves one open question from the Technical Context. Decisions from feature 001
(especially [001 R7](../001-ai-macro-logging/research.md#r7-photo-handling-and-privacy-fr-002-fr-015),
photo handling) still apply unless this file says otherwise.

## R1. How "Choose existing photo" reaches the photo library (FR-002, US1)

- **Decision**: A visually hidden `<input type="file" accept="image/*">` **without** the `capture`
  attribute, opened by the "Choose existing photo" button. A second, separate input that *has*
  `capture="environment"` is used only for the camera-app fallback (R3).
- **Rationale**: Feature 001's single input had `capture="environment"`, which tells mobile browsers to
  skip the chooser and open the camera, so the library was unreachable. Without `capture`, Android
  Chrome opens the system photo picker and iOS Safari offers Photo Library / Take Photo / Choose File.
  On desktop it opens the normal file dialog (US3). No dependency and no permission are needed.
- **Alternatives considered**: File System Access API `showOpenFilePicker()` (Chromium desktop only,
  no phone library access); one input with no `capture` for both actions (on Android it hides the
  camera behind an extra chooser step, which hurts SC-001 for the "take photo" path).

## R2. In-app live camera (FR-003, FR-005, FR-006, US2)

- **Decision**: Use `navigator.mediaDevices.getUserMedia` directly (platform API, no library):
  - Start with `{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }`.
    `ideal` (not `exact`) so laptops with only a front webcam still work, while phones default to the
    rear camera (FR-006).
  - Show the stream in a `<video autoplay playsinline muted>` element (`playsinline` is required on
    iOS to stay inline).
  - **Snapshot**: draw the current video frame onto a canvas at the track's native size and
    `toBlob('image/jpeg', 0.92)`. That blob then goes through the existing `reencodePhoto`, so the
    1568 px resize and metadata removal are shared with every other source (FR-011).
  - **Switch camera**: after the stream starts (so labels and IDs are available),
    `enumerateDevices()` lists `videoinput` devices. If there are 2 or more, show "Switch camera".
    It stops the current tracks and restarts with `deviceId: { exact: next }`, cycling in list order.
  - The preview is **not mirrored**, so the preview and the captured image look the same.
  - **Remembered camera** (added after manual validation, FR-017): desktop webcams don't report a
    facing mode, so Chrome falls back to the first camera in its list. On the owner's PC that was a
    virtual camera (NVIDIA Broadcast) showing a black frame, while Switch camera reached the real
    C922 webcam. After each snapshot the camera's `deviceId` is saved in the `meta` store, and the
    next start asks for it with `deviceId: { exact }`. If that fails with `OverconstrainedError` or
    `NotFoundError` (the camera was unplugged or its ID changed), the start is retried once with the
    default constraints; any other error is reported as usual. The first version used
    `deviceId: { ideal }`, but on the owner's PC Chrome still opened NVIDIA Broadcast, apparently
    weighing the resolution `ideal`s against the device preference. Alternatives
    considered: showing the camera's name next to Switch camera (helps explain a black preview, but
    the user still switches every time); detecting black frames (fragile and needs frame analysis).
- **Rationale**: The platform API covers everything the spec needs (preview, still capture,
  switching). Principle V prefers the platform. `ImageCapture.takePhoto()` would give higher
  resolution, but it is Chromium-only and the 1568 px cap makes the extra resolution useless.
- **Alternatives considered**: `ImageCapture` API (not in Safari or Firefox); a camera library such
  as `react-webcam` (a dependency for about 60 lines of platform code); `facingMode: { exact }` (fails
  with `OverconstrainedError` on single-camera laptops).

## R3. Capability detection and fallback (FR-004, FR-008, FR-009, FR-014)

- **Decision**: Decide what the "Take photo" button does from capabilities, never from the device type:

  | Check (no permission prompt) | Result |
  |------------------------------|--------|
  | `window.isSecureContext && navigator.mediaDevices?.getUserMedia` present, and `enumerateDevices()` lists at least one `videoinput` | **Live camera**: "Take photo" opens the in-app preview |
  | Same API present, but no `videoinput` device | **No camera**: "Take photo" is disabled with "No camera found on this device." "Choose existing photo" still works |
  | API missing (insecure context such as LAN HTTP, or an old browser) | **Camera-app fallback**: "Take photo" opens the `capture="environment"` input. A hint says "Opens your device's camera app" |

  - `enumerateDevices()` does not prompt. Before permission it returns at most one entry per kind
    with an empty label, which is enough to tell whether a camera exists.
  - `getUserMedia` is called only when the user taps "Take photo" (FR-008).
  - If the live camera fails at start with a reason that the camera app might avoid (unsupported or
    a security error), the error message also offers "Use camera app" through the fallback input.
- **Rationale**: This meets the spec's "depends on what the device can do" assumption. On desktop
  browsers in an insecure context, `capture` is ignored and the fallback input opens a file dialog.
  That is the best the platform allows, and it only happens when the desktop is reached over LAN HTTP
  (localhost is a secure context). The hint text keeps it from being surprising.
- **Alternatives considered**: User-agent or `pointer: coarse` detection (the spec forbids
  device-type detection, and it guesses wrong on tablets and touch laptops); hiding "Take photo"
  entirely in insecure contexts (would remove the phone camera, a regression from feature 001).

## R4. Camera error mapping (FR-009, SC-005)

- **Decision**: One pure function `describeCameraError(error)` in `src/media/camera.ts` maps failures
  to a closed set of reasons with fixed, plain-language messages:

  | Source | Reason | Message (summary) | Offers |
  |--------|--------|-------------------|--------|
  | `NotAllowedError` | `denied` | Camera access is blocked. Allow it in your browser's site settings, then try again | Try again, Choose existing photo |
  | `NotFoundError`, `OverconstrainedError` | `no-camera` | No camera found | Choose existing photo |
  | `NotReadableError`, `AbortError` | `in-use` | The camera is in use by another app. Close it and try again | Try again, Choose existing photo |
  | `SecurityError`, `TypeError`, API missing | `unsupported` | The live camera isn't available here | Use camera app, Choose existing photo |
  | Track `ended` event while live | `disconnected` | The camera was disconnected | Try again, Choose existing photo |
  | Anything else | `unknown` | The camera couldn't start | Try again, Choose existing photo |

- **Rationale**: Tests can cover every row without a browser. The UI never shows raw `DOMException`
  text. "Choose existing photo" is always offered (SC-005).
- **Alternatives considered**: Showing `error.message` (browser-specific, often technical).

## R5. Turning the camera off (FR-007, SC-004)

- **Decision**: A `CameraSession` object owns the `MediaStream`. Its `stop()` calls `track.stop()` on
  every track and clears `video.srcObject`. It is called:
  1. immediately after a snapshot is taken (the still image doesn't need the camera; "Retake" starts
     a new session),
  2. when the camera view unmounts (Cancel, leaving the photo step, switching entry mode, finishing),
  3. on `document.visibilitychange` to `hidden` (app backgrounded or tab hidden). The view then shows
     "Camera paused" with a "Resume camera" button. It does not restart on its own (spec edge case),
  4. before switching to another camera.

  A start that resolves after the view has already unmounted or been cancelled stops its stream right
  away. This guards against the race where the user cancels while the permission prompt is open.
- **Rationale**: Stopping on snapshot gives the shortest possible camera-on time and the simplest
  state. The cost is a restart on "Retake", which stays within SC-003's 3 s because permission is
  already granted.
- **Alternatives considered**: Keeping the stream alive during the still review for instant retakes
  (the camera light stays on while not needed, against FR-007).

## R6. When the photo is decoded, and the preview (FR-010, FR-012, edge cases)

- **Decision**: Run `reencodePhoto` **as soon as a photo is selected or captured**, not when Estimate
  is pressed. The resulting JPEG becomes the Selected Photo. The preview `<img>` shows that JPEG through
  `URL.createObjectURL`, and the URL is revoked on replace, remove and unmount. Estimate and Retry send
  the same JPEG again without re-decoding.
  - A decode failure (non-image, HEIC the browser can't read, corrupt file) shows "This photo couldn't
    be used. Choose another photo." at selection time, and nothing is sent (FR-012).
  - A file whose `type` is set and does not start with `image/` is rejected before decoding.
  - Upright orientation: `createImageBitmap(..., { imageOrientation: 'from-image' })` already applies
    EXIF orientation (001 R7), so the preview shows the image upright exactly as it will be sent.
    Webcam frames have no EXIF and are drawn as displayed.
- **Rationale**: Users see problems before they type a note or wait for analysis. The preview shows
  exactly what will be analyzed (resized, upright, stripped). No raw library photo with GPS data is
  kept in memory longer than needed.
- **Alternatives considered**: Previewing the original file with `<img>` (can show HEIC in Safari
  that `createImageBitmap` then fails on, and it relies on `<img>` EXIF handling); decoding at
  Estimate time, as in 001 (late errors).

## R7. Serving securely so the live camera works (spec Assumptions)

- **Decision**: No server or hosting change in this feature.
  - **Desktop** at `http://localhost:5080` or `:5173` is a secure context, so the live camera works.
  - **Phone over LAN HTTP** (the current setup) uses the camera-app fallback (R3) and the library
    picker. This meets FR-004 and FR-014.
  - **Optional LAN HTTPS for trying the live camera on a phone**: Kestrel can serve HTTPS with a
    locally trusted certificate without code changes (`--urls https://0.0.0.0:5443` plus
    `Kestrel__Certificates__Default__Path/KeyPath` environment variables pointing at a certificate
    whose root CA is installed on the phone, for example one made with mkcert). This is documented in
    [quickstart.md](./quickstart.md) as a manual check only.
  - Production HTTPS (with HSTS) belongs to the deployment/authentication feature that the
    constitution (Principle VII, Technical Constraints) requires before anyone else uses the app. That
    feature MUST send `Permissions-Policy: camera=(self)`. If it adds a CSP, the CSP MUST allow
    `img-src blob:` for the photo preview.
- **Rationale**: Hosting and transport security are their own feature with their own threat model.
  Adding a half-solution here (for example a self-signed certificate plugin for Vite) would add a
  dependency and would not be the production answer anyway.
- **Alternatives considered**: `@vitejs/plugin-basic-ssl` (a dependency; untrusted certificate
  warnings on phones; dev server only); a tunnel such as Cloudflare Tunnel or Tailscale Serve
  (exposes the unauthenticated backend beyond the LAN, which the README forbids).

## R8. Testing the camera without a camera (Principle I)

- **Decision**:
  - **Unit** (Vitest): `describeCameraError`, `detectCameraSupport` (with fake `navigator` objects) and
    `nextCameraId`. These are pure or near-pure functions in `src/media/camera.ts`.
  - **Component** (RTL): the camera is reached only through a new injected service
    `services.camera: CameraService` (same seam style as `reencodePhoto`). Tests use a
    `FakeCameraService` whose sessions record `stop()` calls and can emit `ended`. jsdom has no
    `MediaStream`, so the real implementation is never loaded in component tests.
  - **E2E** (Playwright, desktop and 360 px projects): Chromium runs with
    `--use-fake-device-for-media-stream` (a synthetic test-pattern camera). Each camera test calls
    `context.grantPermissions(['camera'])`; the denied case leaves permission ungranted, so Playwright
    denies it. An init script wraps `getUserMedia` to record the returned streams on `window`, so
    tests can check that every track's `readyState` is `'ended'` after snapshot, cancel, leaving the
    step, and hiding the page (SC-004). The library path uses `setInputFiles` on the no-`capture`
    input with the existing GPS-tagged fixture (SC-006, metadata removal).
  - Real phone checks (iOS Safari photo library, Android rear camera, camera-in-use) are manual, in
    [quickstart.md](./quickstart.md).
- **Rationale**: This covers every visible outcome automatically, and only OS-owned screens are left
  to manual checks, which the spec says the app doesn't control anyway.
- **Alternatives considered**: Mocking `navigator.mediaDevices` globally in component tests (couples
  tests to the browser API's shape instead of the app's seam).

## R9. Threat model (Principle VII)

This feature adds no endpoints and doesn't change authentication, authorization or what is sent to
Claude. It does add a new sensitive browser capability (the camera) and a new data source (the photo
library), so a short threat model is recorded:

- **Assets**: live camera frames; library photos and their metadata (GPS, device, time); the single
  photo sent for analysis.
- **Trust boundaries**: browser ↔ OS camera and picker; device ↔ backend proxy ↔ Anthropic (unchanged
  from 001).
- **Top threats and mitigations**:
  1. *Camera left on, or frames captured without the user knowing* → camera starts only on an explicit
     tap (FR-008), stops on snapshot, unmount and hide (R5), and e2e tests check that tracks end
     (SC-004).
  2. *Library photo metadata leaking location* → every source goes through the canvas re-encode before
     upload (R6). The e2e test uses a GPS-tagged fixture through the library path.
  3. *Frames sent or stored beyond the chosen photo* → only the accepted snapshot becomes a Blob.
     Frames are never recorded (no `MediaRecorder`), and nothing is written to IndexedDB or the cache
     (FR-013).
  4. *Malicious or oversized files from the picker* → client type check and decode (R6). The server's
     existing 5 MB and `image/jpeg`-only validation is unchanged and still authoritative.
  5. *Embedding the app in a frame to use the camera permission* → the frame-ancestors and
     `Permissions-Policy` hardening is assigned to the deployment feature (R7). Today the backend only
     listens on localhost or a private LAN.
- **Baseline**: OWASP ASVS L2 V12 (files and resources) and V8 (data protection, client-side) are
  covered by the mitigations above. No new server attack surface.
