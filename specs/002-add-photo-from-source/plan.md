# Implementation Plan: Add Photo From Source

**Branch**: `002-add-photo-from-source` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-add-photo-from-source/spec.md`

## Summary

The feature 001 photo step has one file input with `capture="environment"`. On phones that skips the
photo library, and on desktops it offers no camera. This feature replaces it with two sources:
**Choose existing photo**, a file input without `capture` that opens the phone's photo library or the
desktop file dialog, and **Take photo**, an in-app live preview built on `getUserMedia` with snapshot,
retake and camera switching. Where the live camera can't run (for example a phone over LAN HTTP),
**Take photo** falls back to the device camera app through a `capture` input. Every photo is
re-encoded on the device as soon as it is chosen (resize, upright, EXIF stripped), shown as a preview,
and then goes through the unchanged 001 estimate → review → confirm flow. This is a frontend-only
change: the backend, API contract and stored data stay the same
([research](./research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) + React 19 frontend. Backend C# 14 / .NET 10, **unchanged**

**Primary Dependencies**: No new dependencies. Platform APIs only: `MediaDevices.getUserMedia`,
`enumerateDevices`, `HTMLVideoElement`, canvas `toBlob`, `createImageBitmap`, Page Visibility
([research R2](./research.md#r2-in-app-live-camera-fr-003-fr-005-fr-006-us2))

**Storage**: IndexedDB schema unchanged, no migration. One device-local key (`preferredCameraId`) in the existing `meta` store (FR-017). Photos and frames live only in memory
([data-model](./data-model.md))

**Testing**: Vitest (unit: `src/media/camera.ts` helpers), React Testing Library with an injected
`FakeCameraService` (component), Playwright desktop and 360 px with Chromium's fake camera device
(e2e). Claude stays mocked ([research R8](./research.md#r8-testing-the-camera-without-a-camera-principle-i))

**Target Platform**: Current Chrome, Edge, Firefox and Safari on desktop and phone, ≥ 360 px. The
live camera needs a secure context (localhost or HTTPS). LAN HTTP phones use the camera-app fallback
([research R3](./research.md#r3-capability-detection-and-fallback-fr-004-fr-008-fr-009-fr-014), [R7](./research.md#r7-serving-securely-so-the-live-camera-works-spec-assumptions))

**Project Type**: Web application (React SPA + stateless .NET API). Only `frontend/` changes

**Performance Goals**: Live preview ≤ 3 s after permission (SC-003); camera off ≤ 2 s after
accept, cancel, leave or hide (SC-004; `track.stop()` is synchronous, so in practice it is immediate);
re-encode on selection ≤ 1 s for a 12 MP library photo on a mid-range phone (measured by hand in T036)

**Constraints**: Camera requested only on an explicit tap (FR-008); no frame recorded or stored
(FR-013); same 1568 px / JPEG / EXIF-stripped upload as 001; 44 px touch targets and keyboard
operable (FR-015); capability-based, never device-type detection

**Scale/Scope**: One screen section (the photo step), about 3 new frontend modules, no backend changes

No NEEDS CLARIFICATION remain. The spec's open question (how to serve securely) is resolved in
[research R7](./research.md#r7-serving-securely-so-the-live-camera-works-spec-assumptions): no hosting
change in this feature, plus an optional documented LAN HTTPS path.

**SC-001**: Add food → Photo → Choose existing photo → select in the OS picker → Estimate = 5
interactions, which meets the clarified limit of 5 ([spec Clarifications](./spec.md#clarifications)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Test-First | Every new behavior has a failing unit, component or e2e test first (quickstart P1–P15). The changed 001 test (it asserted `capture="environment"` on the single input) is updated before the component changes | ✅ Planned. `/speckit-tasks` must order tests first |
| II. Correct Nutrition Math | No nutrition math touched. `src/domain/**` coverage at 100% is unaffected | ✅ N/A |
| III. Local-First, Sync-Ready | No schema change. One device-local setting (the last camera used, FR-017) is kept in the existing `meta` store through the `DevicePreferences` repository; it is deliberately not synced or exported. Photos are never stored. Works offline except AI lookup (unchanged) | ✅ |
| IV. Fast Logging on Desktop & Mobile | Both sources on both device types (FR-014). 44 px targets, keyboard, 360 px, checked in e2e at both viewports. SC-001 = 5 interactions (clarified limit) | ✅ |
| V. Simplicity | No new dependencies. Platform APIs over a camera library (R2). One new service seam (`CameraService`), needed because jsdom has no camera. No hosting/TLS work pulled in (R7) | ✅ |
| VI. AI-Assisted Food Lookup | Same single AI client (`src/api/estimates.ts`), same schema, validator and confirmation. Every source goes through `reencodePhoto` (EXIF stripped) before upload. A photo is sent only on an explicit Estimate tap. Existing tests for oversized, unsupported and non-food photos remain | ✅ |
| VII. Security & Authentication | No endpoints, auth or data-sent changes. Short threat model in [research R9](./research.md#r9-threat-model-principle-vii) (new camera capability). Camera hardening headers (`Permissions-Policy: camera=(self)`, CSP `img-src blob:`) are recorded as requirements for the deployment feature (R7) | ✅ for this feature. ⚠️ Pre-existing gap: constitution v2.0.0 requires invite-only auth, HTTPS and security headers, which aren't built yet. This feature neither depends on nor worsens that. It must be closed before anyone other than the owner uses the app (Governance) |
| Tech Constraints: Privacy | Only the single chosen photo (stripped) and the note are sent. Live frames never leave the device (FR-013) | ✅ |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. The design adds one in-memory state
machine ([data-model](./data-model.md)), one injected service and pure helpers
([contracts/camera-service.md](./contracts/camera-service.md)), and a UI contract with accessible names
for tests ([contracts/photo-step-ui.md](./contracts/photo-step-ui.md)). Nothing is persisted and no
server surface is added.

## Project Structure

### Documentation (this feature)

```text
specs/002-add-photo-from-source/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R9 (incl. threat model)
├── data-model.md        # Phase 1: in-memory photo-step state; no persisted changes
├── quickstart.md        # Phase 1: automated scenarios P1–P15 + manual device checks
├── contracts/
│   ├── camera-service.md   # CameraService / CameraSession seam, pure helpers, reencodePhoto change
│   └── photo-step-ui.md    # Controls, accessible names, messages per state
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── app/services.tsx               # + camera: CameraService; reencodePhoto takes Blob
│   ├── main.tsx                       # wires the real browserCameraService
│   ├── media/
│   │   ├── camera.ts                  # NEW: CameraService impl + describeCameraError, supportFrom, nextCameraId
│   │   └── reencodePhoto.ts           # + reject non-image MIME before decoding
│   └── features/add-food/
│       ├── AddFoodPhoto.tsx           # CHANGED: source buttons, hidden inputs, preview, re-encode on select
│       ├── PhotoSourcePicker.tsx      # NEW: Take photo / Choose existing photo / fallback input / hints
│       ├── CameraCapture.tsx          # NEW: live preview, snapshot, switch, cancel, pause on hide, errors
│       └── usePhotoSelection.ts       # NEW: Selected Photo state, object-URL lifecycle, decode errors
├── tests/
│   ├── unit/media/camera.test.ts      # NEW: error mapping, support detection, camera cycling
│   ├── unit/media/browserCamera.test.ts  # NEW: createBrowserCameraService with fake mediaDevices
│   ├── unit/media/reencodePhoto.test.ts  # + MIME rejection (existing computeTargetSize tests stay)
│   ├── components/
│   │   ├── AddFoodPhoto.test.tsx      # CHANGED: two sources, preview/replace/remove, early decode errors
│   │   ├── CameraCapture.test.tsx     # NEW: with FakeCameraService
│   │   ├── usePhotoSelection.test.tsx # NEW: selection, preview URL lifecycle, decode errors
│   │   ├── fakeCamera.ts              # NEW: FakeCameraService / FakeCameraSession
│   │   └── testServices.tsx           # + default fake camera
│   └── e2e/
│       ├── log-photo.spec.ts          # CHANGED: library input, non-image rejection, EXIF-rotated photo
│       ├── camera.spec.ts             # NEW: live capture, retake, camera-off checks, denied
│       └── helpers.ts                 # + recordMediaStreams, liveTrackCount, hidePage/showPage, withOrientation
├── playwright.config.ts               # + launchOptions.args ['--use-fake-device-for-media-stream'] for desktop/mobile
└── src/styles.css                     # + preview/video sizing (max 100% width, 4:3), no styles for the file inputs (they use the `hidden` attribute)

README.md                              # "Using it on your phone": camera-app fallback over HTTP; optional LAN HTTPS
```

**Structure Decision**: Same web-application layout as feature 001. All changes are in `frontend/`:
the browser-API code sits in `src/media/` next to `reencodePhoto.ts`, and the UI sits in the existing
`features/add-food/` folder. Camera support is injected through `Services`, following the
`reencodePhoto` precedent, so component tests never touch real browser media APIs. The backend is
not modified.

## Complexity Tracking

No violations. The two-codebase split recorded in feature 001 still applies and isn't extended.
