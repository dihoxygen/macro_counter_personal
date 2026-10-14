# Contract: Camera service and photo media helpers

The backend HTTP API is **unchanged**: `POST /api/estimates/photo` keeps the contract in
[001 estimates-api.yaml](../../001-ai-macro-logging/contracts/estimates-api.yaml) (multipart `photo`
as `image/jpeg` ≤ 5 MB, optional `note` ≤ 300 chars). This file defines the new frontend seams.

## `Services` additions (`src/app/services.tsx`)

```ts
interface Services {
  // ...existing members unchanged; reencodePhoto keeps its signature:
  reencodePhoto: (file: Blob) => Promise<Blob>;   // widened from File to Blob (camera snapshots are Blobs)
  /** The only code that touches navigator.mediaDevices. Replaced by a fake in component tests. */
  camera: CameraService;
}
```

## `CameraService` (`src/media/camera.ts`)

```ts
type CameraSupport = 'live' | 'no-camera' | 'camera-app';

interface CameraService {
  /** Never prompts for permission (FR-008). Uses isSecureContext, getUserMedia presence, enumerateDevices. */
  detectSupport(): Promise<CameraSupport>;
  /**
   * Prompts for permission if needed and starts a stream. With no deviceId, prefers the rear camera
   * (facingMode ideal 'environment'). Rejects with CameraStartError (carries a CameraError).
   */
  start(options?: { deviceId?: string }): Promise<CameraSession>;
}

interface CameraSession {
  readonly stream: MediaStream;          // attached to <video>.srcObject by the view
  readonly deviceId: string;             // current camera
  /** videoinput devices known after permission; length ≥ 2 ⇒ show "Switch camera" (FR-006). */
  readonly deviceIds: readonly string[];
  /** Draws the current frame of `video` at native size → image/jpeg Blob (quality 0.92). */
  snapshot(video: HTMLVideoElement): Promise<Blob>;
  /** Stops every track. Idempotent. After stop, `ended` listeners are not called. */
  stop(): void;
  /** Called once if a track ends unexpectedly (device unplugged, OS revoked access). */
  onEnded(listener: () => void): void;
}
```

Guarantees:

- `start()` is the only call that can trigger a permission prompt.
- A session's tracks are all stopped after `stop()`, `snapshot()` resolving (the view calls `stop()`
  right after), or the owning view unmounting.
- No frame is kept other than the one returned by `snapshot()`. No `MediaRecorder`, no storage.

## Pure helpers (`src/media/camera.ts`, unit tested)

```ts
function describeCameraError(error: unknown): CameraError;               // research R4 table
function nextCameraId(ids: readonly string[], current: string): string;  // cycles; returns current if < 2
function supportFrom(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  videoInputCount: number | null;        // null when enumerateDevices is unavailable or throws
}): CameraSupport;                                                         // research R3 table
```

`supportFrom` rules: no secure context or no `getUserMedia` → `camera-app`; `videoInputCount === 0` →
`no-camera`; otherwise (including `null`) → `live`. With `null` the app optimistically offers the live
camera, and a later failure is handled by `describeCameraError`.

## `reencodePhoto` (`src/media/reencodePhoto.ts`)

Behavior unchanged (decode with `imageOrientation: 'from-image'`, long edge ≤ 1568, JPEG 0.85, no
metadata). New: rejects with `PhotoDecodeError` without decoding when `file.type` is non-empty and
doesn't start with `image/` (FR-012).
