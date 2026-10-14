# Contract: Photo step UI

The user-visible contract that component and e2e tests target. Roles and accessible names are the
contract. Exact visual styling is not. States are defined in [data-model.md](../data-model.md#photo-step-state).

All buttons are ≥ 44×44 CSS px, reachable by keyboard (Tab and Enter/Space), and usable at 360 px wide
(FR-015). Status changes ("Starting camera…", "Preparing photo…", "Camera paused") are announced with
`role="status"`. Errors use `role="alert"`.

## Controls

| Accessible name | Role | Shown in states | Action |
|-----------------|------|-----------------|--------|
| `Take photo` | button | `empty`, `rejected`, `selected` (library source) | `live` support → start in-app camera. `camera-app` → open the capture input. `no-camera` → **disabled**, with description "No camera found on this device." Disabled for the few milliseconds until camera detection finishes |
| `Choose existing photo` | button | `empty`, `rejected`, `camera-error`, `paused`, `selected` (camera source) | Opens the library input |
| `Use camera app` | button | `camera-error` when `offerCameraApp` | Opens the capture input |
| `Take snapshot` | button | `live` | Captures a frame, turns off the camera |
| `Switch camera` | button | `live`, only when ≥ 2 cameras | Restarts on the next camera |
| `Cancel` | button | `starting`, `live`, `paused`, `camera-error` | Turns off the camera, returns to the previous photo or `empty` |
| `Resume camera` | button | `paused` | Restarts the camera |
| `Try again` | button | `camera-error` when `canRetry` | Restarts the camera |
| `Retake` | button | `selected` (camera source) | Discards the photo, restarts the camera (or reopens the capture input) |
| `Replace photo` | button | `selected` (library source) | Opens the library input. The old photo stays until the new one decodes |
| `Remove photo` | button | `selected` | Back to `empty` |
| `Camera preview` | video (labelled region) | `live` | `autoplay playsinline muted`, not mirrored |
| `Selected photo` | img (alt) | `selected` | Shows the re-encoded JPEG |
| `Note (optional)` | textbox | always (disabled while loading) | Unchanged from 001, max 300 |
| `Estimate` | button | always | With no photo → alert "Choose or take a photo first." Otherwise sends the Selected Photo |

In `camera-error`, the camera view shows only `Try again` (when `canRetry`), `Use camera app` (when
`offerCameraApp`) and `Choose existing photo`. `Take photo` isn't shown there.

In `selected`, both sources stay available: the button for the photo's own source is renamed
(`Retake` or `Replace photo`) and the other keeps its normal name. After a snapshot, **Estimate is
the "use it" action** of FR-005. There is no separate "Use photo" step, so SC-002 doesn't need an
extra tap.

Hidden inputs (`hidden` attribute, so they're out of the tab order and the touch-target check, opened by `input.click()` from the buttons, and labelled for tests via `aria-label`):

| Label | Element |
|-------|---------|
| `Existing photo file` | `<input type="file" accept="image/*">`, **no** `capture` |
| `Camera app photo file` | `<input type="file" accept="image/*" capture="environment">` |

Hint under "Take photo" when support is `camera-app`: "Opens your device's camera app."

## Messages

| Situation | Text (role) |
|-----------|-------------|
| Camera denied | "Camera access is blocked. Allow camera access for this site in your browser settings, then try again." (alert) |
| No camera | "No camera found on this device. You can choose an existing photo instead." (alert) |
| In use | "The camera is being used by another app. Close it and try again." (alert) |
| Unsupported | "The live camera isn't available here. You can use your device's camera app or choose an existing photo." (alert) |
| Disconnected | "The camera was disconnected." (alert) |
| Unknown | "The camera couldn't start." (alert) |
| Decode/type failure | "This photo couldn't be used. Choose another photo." (alert) |
| Hidden while live | "Camera paused" (status) |

## Unchanged from feature 001 (FR-016)

Progress with `Cancel` during analysis; on an unrecognized photo or an error: `Retry`, `Describe in
text`, `Enter manually`; the review and confirm screen. Retry resends the same Selected Photo.
