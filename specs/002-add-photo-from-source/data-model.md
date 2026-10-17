# Data Model: Add Photo From Source

**Feature**: `002-add-photo-from-source` | **Plan**: [plan.md](./plan.md)

**No schema changes.** IndexedDB stores, record shapes and `schemaVersion` are unchanged, and no
migration is needed. Photo entries are saved exactly as in feature 001
([001 data-model](../001-ai-macro-logging/data-model.md)). The photo source is **not** recorded on the
entry (spec Key Entities: "not stored").

The one new persisted value is the [Device Preference](#device-preference) below, a key in the
existing `meta` key/value store. Everything else is in-memory UI state for the photo step and is
discarded when the step unmounts.

## Device Preference

| Key (`meta` store) | Value | Rules |
|--------------------|-------|-------|
| `preferredCameraId` | `string` | The `deviceId` of the camera the last snapshot was taken with (FR-017). Written after each snapshot; empty IDs are ignored. Any non-string or empty value reads as "no preference" |

Accessed only through the `DevicePreferences` repository (`src/data/devicePreferences.ts`,
Principle III). It is device-local on purpose: a camera ID means nothing on another device, so it has
no `id`/timestamps, is never synced, and is not part of a data export. It contains no personal data.

## Photo Source

```ts
type PhotoSource = 'library' | 'camera';
```

- `library`: the no-`capture` file input (photo library on phones, file dialog on desktop).
- `camera`: a frame captured from the in-app live preview, or a photo returned by the device camera
  app through the `capture` fallback input.

Used only to choose UI copy ("Replace photo" vs. "Retake") and in tests. Never sent or stored.

## Selected Photo

| Field | Type | Rules |
|-------|------|-------|
| `source` | `PhotoSource` | Required |
| `jpeg` | `Blob` | Output of `reencodePhoto`: `image/jpeg`, long edge ≤ 1568 px, no EXIF, upright. This exact Blob is what `estimateFromPhoto` sends |
| `previewUrl` | `string` | `URL.createObjectURL(jpeg)`. Revoked when the photo is replaced, removed, or the step unmounts |

At most one Selected Photo exists at a time (single photo per estimate). Replacing one revokes the old
`previewUrl` first.

## Camera Support (derived, no prompt)

```ts
type CameraSupport = 'live' | 'no-camera' | 'camera-app';
```

Computed once when the photo step mounts by `detectCameraSupport()` ([research R3](./research.md#r3-capability-detection-and-fallback-fr-004-fr-008-fr-009-fr-014)).
It never calls `getUserMedia`.

## Camera Error

```ts
type CameraErrorReason = 'denied' | 'no-camera' | 'in-use' | 'unsupported' | 'disconnected' | 'unknown';
interface CameraError { reason: CameraErrorReason; message: string; canRetry: boolean; offerCameraApp: boolean }
```

Produced only by `describeCameraError` ([research R4](./research.md#r4-camera-error-mapping-fr-009-sc-005)).
"Choose existing photo" is offered for every reason.

## Photo step state

| From | Event | To |
|------|-------|----|
| `empty`, `selected`, `rejected`, `camera-error`, `paused` | Choose existing photo → file chosen | `preparing` |
| `empty`, `selected`, `rejected` | Take photo, Camera Support = `live` | `starting` |
| `empty`, `selected`, `rejected`, `camera-error` | Take photo / Use camera app, Camera Support = `camera-app` → photo returned | `preparing` |
| `starting` | stream ready | `live` |
| `starting` | start fails | `camera-error` |
| `starting`, `live` | Cancel | previous `selected` photo if any, else `empty` |
| `live` | Take snapshot (camera turns off) | `preparing` |
| `live` | Switch camera | `starting` (old tracks stopped first) |
| `live` | page hidden (camera turns off) | `paused` |
| `live` | track `ended` | `camera-error` (`disconnected`) |
| `paused` | Resume camera | `starting` |
| `camera-error` | Try again | `starting` |
| `preparing` | decode ok | `selected` |
| `preparing` | decode fails | `rejected` |
| `selected` | Remove photo | `empty` |
| `selected` | Retake (camera source) or Take photo (library source) | `starting`, or the capture input with `camera-app` support |
| `selected` | Replace photo / Choose existing photo → file chosen | `preparing` (old photo kept until decode ok) |
| `selected` | Estimate | feature 001 flow: `loading` → `review` / `unrecognized` / `error` |

| State | Camera on? | Shows |
|-------|-----------|-------|
| `empty` | no | "Take photo", "Choose existing photo" (+ hint or disabled reason from Camera Support) |
| `starting` | requesting | "Starting camera…", Cancel |
| `live` | **yes** | Video preview, "Take snapshot", "Switch camera" (only if ≥ 2 cameras), Cancel |
| `paused` | no | "Camera paused", "Resume camera", "Choose existing photo" |
| `camera-error` | no | Error message, "Try again" (if `canRetry`), "Use camera app" (if `offerCameraApp`), "Choose existing photo" |
| `preparing` | no | "Preparing photo…" |
| `rejected` | no | "This photo couldn't be used. Choose another photo.", both source buttons |
| `selected` | no | Preview image, both source buttons (own source renamed "Retake" / "Replace photo"), "Remove photo", note, Estimate |

Rules:

- Cancelling a picker returns to the previous state without an error (the input's `change` event
  doesn't fire, or fires with no file, and both are ignored).
- Selecting a new photo while one is `selected` replaces it only after the new one decodes. If it
  fails, the state becomes `rejected` and the old photo is released.
- The note field and the 001 recovery buttons (Retry, Describe in text, Enter manually) work unchanged
  once a photo is `selected` (FR-016). Retry reuses the same `jpeg`.
- Entering any state other than `live` guarantees that no camera tracks are running
  ([research R5](./research.md#r5-turning-the-camera-off-fr-007-sc-004)).
