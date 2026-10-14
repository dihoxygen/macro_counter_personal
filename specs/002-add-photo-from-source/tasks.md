---
description: "Task list for Add Photo From Source"
---

# Tasks: Add Photo From Source

**Input**: Design documents from `/specs/002-add-photo-from-source/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE) applies to every task.
Write and run each test task, and see it **fail**, before its implementation task starts. Claude is
always mocked. No test may call `api.anthropic.com` (Principle VI). Component tests never touch real
`navigator.mediaDevices`: the camera is reached only through `services.camera` and faked
([research R8](./research.md#r8-testing-the-camera-without-a-camera-principle-i)).

**Organization**: Tasks are grouped by user story so each story can be built and tested as its own
increment.

**Scope**: Frontend only. Do **not** modify `backend/`. No new npm dependencies (plan, Principle V).
No IndexedDB schema change.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story the task belongs to (US1–US3, from spec.md)

## Path Conventions

- Frontend source: `frontend/src/`. Tests: `frontend/tests/{unit,components,e2e}/`
- Run commands from `frontend/`: `npx vitest run <path>`, `npx playwright test <name>`, `npm run lint`, `npm run typecheck`
- UI names, roles and messages are fixed by [contracts/photo-step-ui.md](./contracts/photo-step-ui.md). Use them verbatim

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test infrastructure for a fake camera. No project scaffolding is needed (feature 001 exists)

- [X] T001 Confirm the baseline is green before changing anything: run `.\scripts\check.ps1` from the repo root. If it fails, stop and report the failure to the user instead of continuing
- [X] T002 [P] In `frontend/playwright.config.ts`, add `launchOptions: { args: ['--use-fake-device-for-media-stream'] }` to the `use` block of the `desktop` and `mobile` projects only (not `offline`). Do **not** add `--use-fake-ui-for-media-stream`: permission must be granted per test with `context.grantPermissions(['camera'])` so the denied case can be tested. Run `npx playwright test --list` to confirm the config still loads
- [X] T003 [P] In `frontend/tests/e2e/helpers.ts`, add and export:
  - `recordMediaStreams(page: Page)`: calls `page.addInitScript` to wrap `navigator.mediaDevices.getUserMedia` so every resolved `MediaStream` is pushed onto `window.__streams` (an array created by the script).
  - `liveTrackCount(page: Page): Promise<number>`: returns the number of tracks across `window.__streams` whose `readyState !== 'ended'`.
  - `hidePage(page: Page)` and `showPage(page: Page)`: use `page.evaluate` to `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' | 'visible' })`, the same for `document.hidden`, then `document.dispatchEvent(new Event('visibilitychange'))`.

  Add `declare global { interface Window { __streams?: MediaStream[] } }` so it type-checks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `Services` seam, the media helpers contract, the fake camera, and selection state
that all three stories build on ([contracts/camera-service.md](./contracts/camera-service.md))

**⚠️ CRITICAL**: No user story work starts until this phase is complete

- [X] T004 [P] Add failing tests to `frontend/tests/unit/media/reencodePhoto.test.ts`:
  - `reencodePhoto(new Blob(['x'], { type: 'text/plain' }))` rejects with `PhotoDecodeError` **without** calling `createImageBitmap` (spy on `globalThis.createImageBitmap`, expect not called).
  - A Blob with an empty `type` is still passed to `createImageBitmap`. Some pickers give no MIME type.
  - A Blob of type `image/heic` is passed to `createImageBitmap`. If that throws, the call rejects with `PhotoDecodeError`.

  Keep the existing `computeTargetSize` and `reencodePhoto` tests unchanged.
- [X] T005 Implement the MIME check in `frontend/src/media/reencodePhoto.ts`: before decoding, if `file.type !== '' && !file.type.startsWith('image/')`, throw `new PhotoDecodeError('This file is not an image.')`. The parameter is already `Blob`. Make T004 pass
- [X] T006 [P] Write failing unit tests in `frontend/tests/unit/media/camera.test.ts` for the pure helpers in [contracts/camera-service.md](./contracts/camera-service.md):
  - `supportFrom({ isSecureContext, hasGetUserMedia, videoInputCount })`:
    - `isSecureContext: false` → `'camera-app'`.
    - `hasGetUserMedia: false` → `'camera-app'`.
    - Secure context with `getUserMedia` and `videoInputCount: 0` → `'no-camera'`.
    - The same with `videoInputCount: 1` or `null` → `'live'`.
  - `describeCameraError(error)`: one case per row of the [research R4 table](./research.md#r4-camera-error-mapping-fr-009-sc-005). Build the errors with `new DOMException('x', name)` for `NotAllowedError`, `NotFoundError`, `OverconstrainedError`, `NotReadableError`, `AbortError` and `SecurityError`, plus a plain `TypeError`, the sentinel `'disconnected'`, and an unrelated `Error`. Assert the result's `reason`, `canRetry`, `offerCameraApp` and `message`, using the exact strings from the Messages table in [contracts/photo-step-ui.md](./contracts/photo-step-ui.md):
    - `denied`: canRetry true, offerCameraApp false.
    - `no-camera`: canRetry false, offerCameraApp false.
    - `in-use`: canRetry true, offerCameraApp false.
    - `unsupported`: canRetry false, offerCameraApp true.
    - `disconnected`: canRetry true, offerCameraApp false.
    - `unknown`: canRetry true, offerCameraApp false.
  - `nextCameraId(ids, current)`:
    - `(['a','b','c'], 'a')` → `'b'`.
    - `(['a','b','c'], 'c')` → `'a'`.
    - `(['a'], 'a')` → `'a'`.
    - `([], 'a')` → `'a'`.
    - `(['a','b'], 'zzz')` → `'a'`.
- [X] T007 Create `frontend/src/media/camera.ts` with the types `CameraSupport`, `CameraErrorReason`, `CameraError`, `CameraSession`, `CameraService` and the class `CameraStartError extends Error { constructor(readonly cameraError: CameraError) }`, exactly as in [contracts/camera-service.md](./contracts/camera-service.md). Implement the pure `supportFrom`, `describeCameraError` and `nextCameraId` so T006 passes. Don't implement the browser service yet (that's T028)
- [X] T008 [P] Create `frontend/tests/components/fakeCamera.ts` exporting:
  - `FakeCameraService implements CameraService`, constructed with `{ support?: CameraSupport (default 'live'), deviceIds?: string[] (default ['cam-rear']), startError?: CameraError }`. Its `start` is a `vi.fn` that rejects with `new CameraStartError(startError)` when `startError` is set. Otherwise it resolves a `FakeCameraSession`, using `options.deviceId ?? deviceIds[0]`.
  - `FakeCameraSession`:
    - `stream` is `{} as MediaStream`.
    - `snapshot` is a `vi.fn` resolving `new Blob(['frame'], { type: 'image/jpeg' })`.
    - `stop` is a `vi.fn`. It sets `stopped = true` and is idempotent.
    - `onEnded(listener)` stores the listener.
    - `endUnexpectedly()` calls the stored listener only if the session isn't stopped.
  - `FakeCameraService` also exposes `sessions: FakeCameraSession[]`, every session it started, and `liveSessions()`, the ones that aren't stopped.
- [X] T009 Add `camera: CameraService` to the `Services` interface in `frontend/src/app/services.tsx` (doc comment: "The only code that touches navigator.mediaDevices."). Change `reencodePhoto` to `(file: Blob) => Promise<Blob>`. In `frontend/tests/components/testServices.tsx`, default `camera` to `new FakeCameraService()` and type the `reencodePhoto` stub's parameter as `Blob`. In `frontend/src/main.tsx`, temporarily wire `camera` to a stub whose `detectSupport` resolves `'camera-app'` and whose `start` rejects. T029 replaces it with the real service. Run `npm run typecheck` and the existing component tests; they must still pass
- [X] T010 [P] Write failing tests in `frontend/tests/components/usePhotoSelection.test.tsx`, using `renderHook` from `@testing-library/react` inside `ServicesProvider` (via `createTestServices`), for `usePhotoSelection()` from `frontend/src/features/add-food/usePhotoSelection.ts`. Stub `URL.createObjectURL` to return `blob:1`, `blob:2`, … and spy on `URL.revokeObjectURL`. It returns `{ photo, preparing, rejected, select(file: Blob, source: PhotoSource), remove() }`, where `photo` is `{ source, jpeg, previewUrl } | null` ([data-model](./data-model.md#selected-photo)). Cases:
  - `select` calls `services.reencodePhoto(file)` once. While it's pending, `preparing` is true. Then `photo.jpeg` is the re-encoded Blob and `photo.previewUrl` is `createObjectURL(jpeg)`.
  - When `reencodePhoto` rejects with `PhotoDecodeError`, `rejected` is true, `photo` is null, any previous photo's URL is revoked, and the rejection does not propagate.
  - Replacing: the old photo stays in `photo` while the new one is preparing. On success, the old URL is revoked.
  - `remove()` revokes the URL and sets `photo` to null and `rejected` to false.
  - Unmount revokes the current URL.
  - If a second `select` starts before the first resolves, only the last selection wins (the stale result is ignored and its URL never created).
- [X] T011 Implement `frontend/src/features/add-food/usePhotoSelection.ts` (export `type PhotoSource = 'library' | 'camera'`) so T010 passes. A non-`PhotoDecodeError` rejection from `reencodePhoto` is also treated as `rejected` (the message is the same; nothing is sent)

**Checkpoint**: `npx vitest run tests/unit/media tests/components/usePhotoSelection.test.tsx` passes. `npm run typecheck` and all existing tests are green.

---

## Phase 3: User Story 1 - Log a meal from a photo already on my phone (Priority: P1) 🎯 MVP

**Goal**: The photo step offers **Take photo** and **Choose existing photo**. Choose existing photo
opens the library through an input with no `capture`. The photo is prepared when it's chosen, shown
as a preview, and can be replaced or removed before the unchanged 001 estimate flow. In this story,
Take photo always uses the camera-app input (the feature 001 behavior). US2 adds the live camera.

**Independent Test**: At the 360 px viewport, choose the GPS-tagged fixture through "Choose existing
photo", see the preview, Estimate, Confirm. The upload has no EXIF and the totals update (quickstart
P1–P6, P15).

### Tests for User Story 1 ⚠️ Write first, see them fail

- [X] T012 [US1] Rewrite `frontend/tests/components/AddFoodPhoto.test.tsx` for the new photo step. Keep every existing behavioral test (note, cancel during analysis, edit/remove/add items, cannot confirm empty, unrecognized → Retry / Describe in text / Enter manually, `image_too_large`/`unsupported_media_type` messages, ask for a photo first), but change `choosePhoto` to upload to `screen.getByLabelText('Existing photo file')` and wait for `screen.findByRole('img', { name: 'Selected photo' })` before typing the note and clicking Estimate. Replace the first test, which asserted `capture="environment"` on a single input, and change the existing "asks for a photo before estimating" assertion from `/choose a photo/i` to the exact text "Choose or take a photo first.". Add tests (labels and messages verbatim from [contracts/photo-step-ui.md](./contracts/photo-step-ui.md)):
  - Buttons `Take photo` and `Choose existing photo` are both visible. `services.camera.start` has not been called on render (FR-001, FR-008).
  - `Existing photo file` has `type="file"` and `accept="image/*"` and **no** `capture` attribute. `Camera app photo file` has `capture="environment"` (FR-002, P2).
  - Clicking `Choose existing photo` calls `.click()` on the `Existing photo file` input (spy on `HTMLInputElement.prototype.click`). With camera support `'camera-app'`, clicking `Take photo` clicks the `Camera app photo file` input and the hint "Opens your device's camera app." is shown.
  - After selecting, `services.reencodePhoto` is called once at selection time (before Estimate), and the `Selected photo` img `src` is the object URL. `Estimate` sends exactly that re-encoded Blob. Retry after an `unrecognized` result sends the same Blob again without calling `reencodePhoto` a second time (FR-016, P15).
  - With a library photo selected: `Replace photo` and `Take photo` are shown. `Remove photo` returns to the empty state, and Estimate then shows the alert "Choose or take a photo first." (P4).
  - With a camera-app photo selected: the buttons are `Retake` and `Choose existing photo`.
  - A change event with no file (picker cancelled) leaves the state unchanged and shows no alert (US1 AS5, P5).
  - `reencodePhoto` rejecting with `PhotoDecodeError` at selection shows the alert "This photo couldn't be used. Choose another photo.", shows both source buttons, and `estimateFromPhoto` is never called (FR-012, P6). This replaces the old decode-at-estimate test.
  - While `reencodePhoto` is pending, a `role="status"` with "Preparing photo…" is shown.
  - While an estimate is loading, the source buttons and inputs are disabled.
- [X] T013 [P] [US1] Update `frontend/tests/e2e/log-photo.spec.ts` (V6 + V13): replace `page.getByLabel(/photo/i).setInputFiles(fixture)` with `page.getByLabel('Existing photo file').setInputFiles(fixture)`, then `await expect(page.getByRole('img', { name: 'Selected photo' })).toBeVisible()` before filling the note. Keep every other assertion (fields `['photo','note']`, JPEG, no EXIF, `[1568, 1176]`, totals 253 kcal / 13.6 g). Add a second test: before choosing, assert that `Take photo` and `Choose existing photo` are visible and that `Existing photo file` has no `capture` attribute (`toHaveAttribute` negated via `expect(await locator.getAttribute('capture')).toBeNull()`)
- [X] T014 [US1] Add to `frontend/tests/e2e/log-photo.spec.ts` a test "a non-image file is rejected before anything is sent": track requests to `/api/estimates/photo` with `page.route`. Call `setInputFiles` on `Existing photo file` with `{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }`. Expect the alert "This photo couldn't be used. Choose another photo." Click Estimate, expect the "Choose or take a photo first." alert, and expect zero photo requests (FR-012)
- [X] T015 [P] [US1] Update `frontend/tests/e2e/touch-targets.spec.ts`: after the existing views, open Add food → Photo, choose the fixture through `Existing photo file`, wait for the `Selected photo` image, and call `expectTouchTargets(page, 'Photo step (selected)')`. The hidden file inputs must not be reported (they use the `hidden` attribute)
- [X] T016 [US1] Add a rotated-photo test to `frontend/tests/e2e/log-photo.spec.ts`, which shares that file so it runs after T013–T014:
  - Add `withOrientation(jpeg: Buffer, orientation: number): Buffer` to `frontend/tests/e2e/helpers.ts`. It removes any existing APP1 segment from the JPEG and inserts, right after SOI (`FFD8`), a minimal APP1 `Exif\0\0` segment: a big-endian TIFF header (`MM\0*`, IFD offset 8), one IFD entry with tag `0x0112` (Orientation), type SHORT, count 1, the given value, and next-IFD offset 0. No dependencies.
  - The test: build `withOrientation(readFileSync(fixture), 6)` and choose it with `setInputFiles` on `Existing photo file` as `{ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer }`. Wait for `Selected photo`, then Estimate.
  - Assert the uploaded JPEG is `[1176, 1568]` (portrait, the opposite of the unrotated `[1568, 1176]`) and `hasExif === false` (spec edge case "Rotated photos", FR-011).

### Implementation for User Story 1

- [X] T017 [US1] Create `frontend/src/features/add-food/PhotoSourcePicker.tsx`. **As built (analysis U2):** the two hidden inputs live in `AddFoodPhoto.tsx`, and `PhotoSourcePicker` only renders the buttons and hints, with props `{ support: CameraSupport | null; photoSource; disabled; onTakePhoto(); onChooseExisting() }`. The original wording follows. Props: `{ support: CameraSupport; photoSource: PhotoSource | null; disabled: boolean; onFile(file: File, source: PhotoSource): void; onLiveCamera(): void }`.
  - It renders two hidden inputs (`hidden` attribute, `type="file"`, `accept="image/*"`): `aria-label="Existing photo file"` with no `capture`, and `aria-label="Camera app photo file"` with `capture="environment"`.
  - On `change`, take `e.target.files?.[0]`. If there is none, do nothing (cancelled picker). Otherwise call `onFile(file, 'library' | 'camera')`, then reset `e.target.value = ''` so the same file can be chosen again.
  - Buttons:
    - `Take photo`, or `Retake` when `photoSource === 'camera'`: with `support === 'live'` it calls `onLiveCamera()`. With `'camera-app'` it clicks the capture input and shows the hint "Opens your device's camera app.". With `'no-camera'` it is `disabled` with `aria-describedby` pointing at "No camera found on this device.".
    - `Choose existing photo`, or `Replace photo` when `photoSource === 'library'`: clicks the library input.
  - All buttons and inputs are disabled when `disabled` is true.
- [X] T018 [US1] Rewrite `frontend/src/features/add-food/AddFoodPhoto.tsx` to use `usePhotoSelection` and `PhotoSourcePicker`:
  - On mount, get `support` from `services.camera.detectSupport()`. While it's pending, treat it as `'camera-app'`, and ignore the result after unmount.
  - Show the `role="status"` "Preparing photo…" while preparing. On `rejected`, show the alert "This photo couldn't be used. Choose another photo.".
  - When a photo is selected, show `<img alt="Selected photo" src={photo.previewUrl}>` and the `Remove photo` button.
  - Keep the note field, `SubmitOrProgress` and the recovery block unchanged.
  - `estimate()` calls `services.estimateFromPhoto(photo.jpeg, note, signal)` directly. Remove the re-encode from the request path; it now happens in `usePhotoSelection`.
  - With no photo, show the alert "Choose or take a photo first.".
  - Remove the now-unused `PhotoDecodeError` import.
  - For now, pass `onLiveCamera={() => {}}`; US2 wires it.

  Make T012 pass.
- [X] T019 [US1] Add styles to `frontend/src/styles.css`:
  - `.photo-preview img`: `display:block; max-width:100%; max-height:50vh; object-fit:contain; border-radius` (match existing tokens).
  - `.photo-sources`: a `.row` that wraps at 360 px.
  - Hint text uses the existing muted text style.

  Don't add styles for the file inputs. Make T013–T016 pass at both Playwright projects with `npx playwright test log-photo touch-targets`

**Checkpoint**: US1 is fully usable. On a phone, "Choose existing photo" reaches the library and "Take photo" still opens the camera app. `npx vitest run` and `npx playwright test log-photo touch-targets` are green. Validate the MVP here (quickstart manual check 1).

---

## Phase 4: User Story 2 - Take a meal photo with my desktop webcam (Priority: P2)

**Goal**: With support `'live'`, Take photo opens an in-app live preview with Take snapshot, Switch
camera (≥ 2 cameras) and Cancel. A snapshot turns the camera off and becomes the Selected Photo
(Retake restarts it). The camera stops on cancel, unmount and page hide. Every failure shows a
specific message and still offers Choose existing photo.

**Independent Test**: In desktop Chromium with the fake camera and permission granted: Take photo →
live preview → Take snapshot → all tracks ended → Estimate → Confirm. Totals update (quickstart P7–P14).

### Tests for User Story 2 ⚠️ Write first, see them fail

- [X] T020 [P] [US2] Write failing tests in `frontend/tests/components/CameraCapture.test.tsx` for `<CameraCapture onCaptured={(blob) => …} onCancel={…} onChooseExisting={…} onUseCameraApp={…} />` from `frontend/src/features/add-food/CameraCapture.tsx`, rendered with `renderWithServices` and a `FakeCameraService`. jsdom lacks `HTMLMediaElement.prototype.play` and `srcObject`, so stub `play` to resolve and define `srcObject` as a writable property in the test's `beforeEach`. Cases (names and messages verbatim from [contracts/photo-step-ui.md](./contracts/photo-step-ui.md)):
  - On mount, `camera.start` is called once with no `deviceId`, and `role="status"` "Starting camera…" is shown. Then the video labelled `Camera preview` is shown with `Take snapshot` and `Cancel` (FR-003).
  - `Switch camera` is absent with `deviceIds: ['a']`. With `['a','b']`, clicking it stops session 1 **before** `start({ deviceId: 'b' })` is called, then shows the preview again (FR-006, P10).
  - `Take snapshot` calls `session.snapshot(videoElement)`, then `session.stop()`, then `onCaptured(blob)` with the snapshot Blob, in that order (FR-005, FR-007).
  - `Cancel` stops the session and calls `onCancel`.
  - Unmount while live stops the session. Unmount while `start` is still pending, then resolving the start, stops the late session immediately (`liveSessions()` is empty) (research R5).
  - `hidePage` (set `document.visibilityState` to `'hidden'` and dispatch `visibilitychange`) stops the session and shows `role="status"` "Camera paused" with `Resume camera` and `Choose existing photo`. `Resume camera` starts a new session. Becoming visible again does **not** restart on its own.
  - `session.endUnexpectedly()` shows the alert "The camera was disconnected." with `Try again` and `Choose existing photo`.
  - For each `startError` reason (`denied`, `no-camera`, `in-use`, `unsupported`, `unknown`), the alert shows that reason's message. `Try again` is present only when `canRetry`, `Use camera app` only when `offerCameraApp`, and `Choose existing photo` always. Clicking each calls `camera.start` again, `onUseCameraApp` or `onChooseExisting` respectively (FR-009, P11).
  - Every button is reachable with `user.tab()` and activates with `{Enter}` (FR-015).
- [X] T021 [P] [US2] Add failing tests to `frontend/tests/components/AddFoodPhoto.test.tsx` for the live-camera integration (camera support `'live'` via `new FakeCameraService({ support: 'live' })`; stub `play`/`srcObject` as in T020):
  - Clicking `Take photo` shows `Camera preview` and **does not** click either file input.
  - `Take snapshot` → `reencodePhoto` is called with the snapshot Blob → the `Selected photo` img is shown with `Retake`. No session is live.
  - `Retake` starts a new camera session. Cancelling it returns to the previously selected photo (data-model: Cancel → previous `selected`).
  - From a camera error, `Choose existing photo` clicks the `Existing photo file` input, and choosing a file reaches `Selected photo` (SC-005).
  - `Use camera app` clicks the `Camera app photo file` input.
  - Switching entry mode in `AddFood` while the camera is live stops the session (render `<AddFood onDone={vi.fn()} />`, click `Photo`, `Take photo`, then `Describe`; `liveSessions()` is empty) (FR-007).
  - Support `'no-camera'`: `Take photo` is disabled and the description "No camera found on this device." is attached. `Choose existing photo` still works (P13).
- [X] T022 [P] [US2] Create `frontend/tests/e2e/camera.spec.ts` (runs in both `desktop` and `mobile` projects). Before each test, call `recordMediaStreams(page)` and `mockApi(page)`, and route `/api/estimates/photo` to `estimate(egg, toast)` while capturing the upload with `multipartFile`. Tests:
  - **Live capture** (`context.grantPermissions(['camera'])`): Add food → Photo → `Take photo`. `Camera preview` is visible within 3 s (SC-003) and `liveTrackCount` > 0. Click `Take snapshot`. `liveTrackCount` becomes 0 within 2 s (`expect.poll`, SC-004). `Selected photo` is visible. Estimate. The upload is `image/jpeg`, `inspectJpeg` shows `hasExif === false` and long edge ≤ 1568. Confirm. The entries list contains "Scrambled eggs" and the Calories total shows "253 kcal" (US2 AS1, AS2 and AS4; SC-006).
  - **Retake**: snapshot → `Retake` → the preview is visible and `liveTrackCount` > 0 → snapshot again → 0.
  - **Camera off on cancel, mode switch, navigation and hide**: one test per trigger. Start the camera, then trigger: `Cancel`; click `Describe`; click the `← Back` button (`page.getByRole('button', { name: /back/i })`, from `ScreenHeader` in `frontend/src/App.tsx`) to return to Today; `hidePage(page)`. Each time, poll `liveTrackCount` to 0 within 2 s. After `hidePage`, expect "Camera paused" and `Resume camera`. `showPage` doesn't restart. Clicking `Resume camera` brings the preview back (FR-007, SC-004).
  - **Permission denied** (don't grant; call `context.clearPermissions()` first so no earlier grant carries over). If headless Chromium doesn't reject `getUserMedia` with `NotAllowedError` on its own, skip this e2e case with a comment saying why. The denied path is still covered by T020's component tests: `Take photo` → alert "Camera access is blocked…". `Choose existing photo` → `setInputFiles` on `Existing photo file` with the fixture → Estimate → Confirm succeeds (SC-005).
  - **Keyboard only**: focus the Photo step with Tab, activate `Take photo` and `Take snapshot` with Enter, and reach `Estimate` (FR-015, P14).
- [X] T023 [P] [US2] Extend `frontend/tests/e2e/touch-targets.spec.ts`: grant camera permission, open the live preview, and call `expectTouchTargets(page, 'Photo step (live camera)')`. Call `recordMediaStreams` first so the test leaves no live tracks (assert `liveTrackCount` is 0 after clicking `Cancel`)

### Implementation for User Story 2

- [X] T024 [US2] Implement `frontend/src/features/add-food/CameraCapture.tsx`:
  - **States**: `starting`, `live`, `paused` and `camera-error`, per [data-model](./data-model.md#photo-step-state).
  - **Session**: keep the current `CameraSession` in a ref, and an `active` flag cleared on unmount, so a start that resolves late is stopped immediately.
  - **Video**: on `live`, set `videoRef.current.srcObject = session.stream` and call `play()`. Render `<video aria-label="Camera preview" autoPlay playsInline muted>`, unmirrored.
  - **Ended**: `session.onEnded` → `camera-error` with `describeCameraError('disconnected')`. A start rejection with `CameraStartError` → `camera-error` with its `cameraError`. Any other rejection goes through `describeCameraError(error)`.
  - **Snapshot**: `await session.snapshot(video)`, `session.stop()`, then `onCaptured(blob)`.
  - **Switch camera**: shown when `session.deviceIds.length >= 2`. Stop first, then start with `{ deviceId: nextCameraId(ids, session.deviceId) }`.
  - **Visibility**: a `visibilitychange` listener stops the session and enters `paused` when `document.visibilityState === 'hidden'`. Remove the listener on unmount. Never auto-resume.
  - **Cleanup**: unmount stops the session and clears `srcObject`.

  Make T020 pass.
- [X] T025 [US2] Wire `CameraCapture` into `frontend/src/features/add-food/AddFoodPhoto.tsx`:
  - Add a `cameraOpen` state. `onLiveCamera` sets it to true, and while it's true, `CameraCapture` replaces the source picker and preview.
  - `onCaptured(blob)` closes the camera and calls `select(blob, 'camera')`.
  - `onCancel` closes the camera and keeps any previously selected photo.
  - `onChooseExisting` and `onUseCameraApp` close the camera and click the matching hidden input. Expose the input refs from `PhotoSourcePicker` via `forwardRef`/a ref prop, or move the inputs into `AddFoodPhoto`. Pick one and keep the T012 tests green.
  - The note field and Estimate stay visible but disabled while the camera is open.

  Make T021 pass.
- [X] T026 [US2] Add `.camera-preview video { display:block; width:100%; max-height:60vh; background:#000; object-fit:contain }` and a `.camera-controls` row (wraps at 360 px; `Take snapshot` uses `button.primary`) to `frontend/src/styles.css`
- [X] T027 [P] [US2] Write failing tests in `frontend/tests/unit/media/browserCamera.test.ts` for `createBrowserCameraService(env)` from `frontend/src/media/camera.ts`, where `env` is `{ isSecureContext: boolean; mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>; document: Document }`, with hand-written fake `mediaDevices` and fake tracks (`{ kind, readyState, stop: vi.fn(), getSettings: () => ({ deviceId }), addEventListener }`):
  - `detectSupport` never calls `getUserMedia`. It counts `videoinput` entries from `enumerateDevices`. If `enumerateDevices` throws, the count is `null`.
  - `start()` calls `getUserMedia` with exactly `{ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }`. `start({ deviceId: 'b' })` uses `video: { deviceId: { exact: 'b' }, width: { ideal: 1920 }, height: { ideal: 1080 } }`.
  - After `getUserMedia` resolves, `deviceIds` comes from a second `enumerateDevices()` call (videoinput only, non-empty IDs), and `deviceId` comes from the video track's `getSettings().deviceId`.
  - A `getUserMedia` rejection becomes `CameraStartError` with `describeCameraError(error)`. A missing `mediaDevices` becomes `CameraStartError` with reason `unsupported`.
  - `stop()` calls `stop()` on every track, is idempotent, and suppresses later `ended` listeners.
  - A track `ended` event before `stop()` calls the `onEnded` listener once.
  - `snapshot(video)` draws onto a canvas sized `video.videoWidth × video.videoHeight` and resolves the `toBlob(…, 'image/jpeg', 0.92)` result. Stub `HTMLCanvasElement.prototype.getContext` and `toBlob`. It rejects with `PhotoDecodeError` when `videoWidth` is 0 or `toBlob` yields null.
- [X] T028 [US2] Implement `createBrowserCameraService(env)` in `frontend/src/media/camera.ts` so T027 passes. Also export `browserCameraService = createBrowserCameraService({ isSecureContext: window.isSecureContext, mediaDevices: navigator.mediaDevices, document })`, created lazily in a function so importing the module in jsdom doesn't touch `navigator.mediaDevices`. No `MediaRecorder`, and no frame kept other than the returned Blob (FR-013)
- [X] T029 [US2] In `frontend/src/main.tsx`, replace the T009 camera stub with the real browser camera service from T028. Run `npx playwright test camera touch-targets` at both projects; T022 and T023 must pass

**Checkpoint**: The live camera works on desktop Chromium (localhost), with the fake device in e2e. US1 still passes: `npx playwright test log-photo camera touch-targets`.

---

## Phase 5: User Story 3 - Choose a photo file on desktop (Priority: P3)

**Goal**: The same two sources on desktop. Choose existing photo opens the desktop file dialog and the
chosen file previews and estimates. This is mostly verification on top of US1's shared component.

**Independent Test**: In the `desktop` Playwright project (1280×800), the photo step shows both
buttons. Choosing a file through `Existing photo file` previews it and logs it (quickstart P1–P3).

### Tests for User Story 3 ⚠️ Write first, see them fail

- [X] T030 [P] [US3] Add to `frontend/tests/e2e/log-photo.spec.ts` a test "desktop: both sources and a file from disk", skipped unless `!isMobile`:
  - Wait for `filechooser` (`page.waitForEvent('filechooser')`) while clicking `Choose existing photo`. Assert `fileChooser.isMultiple()` is false, then `fileChooser.setFiles(fixture)`.
  - The `Selected photo` image becomes visible. Estimate → Confirm → the entries list contains "Scrambled eggs".
  - Also assert `Take photo` is enabled (the fake camera exists, so support is `live`).

  Before T032, this is expected to fail only if the button doesn't trigger the chooser. If it already passes after US1, record that in the commit message and continue.
- [X] T031 [P] [US3] Add a component test to `frontend/tests/components/AddFoodPhoto.test.tsx`: the library input has no `multiple` attribute, and choosing two files only uses the first (spec Assumptions: one photo per estimate)

### Implementation for User Story 3

- [X] T032 [US3] Make any fixes T030 and T031 need in `frontend/src/features/add-food/PhotoSourcePicker.tsx`. Expected: none beyond confirming `multiple` is absent and `files[0]` is used. Then update `README.md` "Using it on your phone": explain that over LAN HTTP "Take photo" opens the phone's camera app and "Choose existing photo" opens the photo library, that the in-app live camera works on the PC at `http://localhost:5080`, and add a link to the optional LAN HTTPS steps in `specs/002-add-photo-from-source/quickstart.md` (manual check 3). Keep the existing "Do not expose this port to the internet" warning

**Checkpoint**: All three stories pass in both Playwright projects.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature checks, privacy and cleanup

- [X] T033 [P] Privacy check (FR-013, research R9): `grep -rn "MediaRecorder\|localStorage\|indexedDB\|caches\." frontend/src/media frontend/src/features/add-food` must find nothing new. Confirm `frontend/vite.config.ts` workbox `globPatterns` and `navigateFallbackDenylist` are unchanged, so no photo is ever cached. Confirm `backend/` has no diff (`git diff --stat master -- backend` is empty)
- [X] T034 [P] **As done:** `npm run format` reformats ~40 untouched files because the existing code was formatted at width 120 while `.prettierrc` says 100. Those changes were reverted; only this feature's files were formatted (at 120, matching the code around them). Update `frontend/src/features/add-food/AddFoodPhoto.tsx`'s doc comment to reference feature 002 (both photo sources). Remove any dead code left from the old single-input design (for example the unused `missingPhoto` text if it was replaced). Run `npm run lint` and `npm run format`, then `npm run lint` again; it must be clean
- [X] T035 Run the full merge gate `.\scripts\check.ps1` from the repo root. All steps must pass, including 100% coverage on `src/domain/**` (unchanged) and `dotnet format` with no backend changes. Fix failures test-first (Principle I)
- [ ] T036 Run the manual device checks in `specs/002-add-photo-from-source/quickstart.md` ("Manual checks on real devices", items 1–2, and item 3 if a local CA is available). Ask the user to do the steps that need physical hardware (phone library, webcam light, unplugging a USB camera, Windows Camera app in use). Record the results, including the SC-001 interaction count, SC-002 time, SC-003 preview latency and the plan's re-encode goal (time from picking a 12 MP library photo to the `Selected photo` preview appearing, target ≤ 1 s on a mid-range phone), as a "Validation results" section appended to `specs/002-add-photo-from-source/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first. T002 and T003 are independent of each other
- **Foundational (Phase 2)**: Depends on Setup. Blocks all user stories
  - T004 → T005. T006 → T007. T007 → T008 (needs the types). T007 + T008 → T009. T009 → T010 → T011
- **US1 (Phase 3)**: Depends on Phase 2. T012–T016 (tests) before T017–T019
- **US2 (Phase 4)**: Depends on Phase 2 and on US1's `AddFoodPhoto`/`PhotoSourcePicker` (T017, T018), because it wires into them. Within the phase: T020, T021, T022, T023 and T027 (tests) first; T024 → T025 → T026; T027 → T028 → T029
- **US3 (Phase 5)**: Depends on US1 (shared component). Independent of US2, except that T030's "Take photo is enabled" assertion needs T029's real camera service. If US3 runs before US2, drop that one assertion and add it back after T029
- **Polish (Phase 6)**: After all stories

### User Story Dependencies

- **US1 (P1)**: Only Foundational. The MVP
- **US2 (P2)**: Builds on the US1 photo step (the same screen). Its own tests are independent
- **US3 (P3)**: Builds on the US1 photo step. Verification-heavy

### Within Each User Story

- Tests MUST be written and FAIL before implementation (Principle I)
- Pure helpers → service → component → wiring → styles
- Commit after each task or logical group, with test and implementation together once green

### Parallel Opportunities

- Phase 1: T002 ∥ T003
- Phase 2: T004 ∥ T006 ∥ T010 (test writing). T008 can be written alongside T007's tests
- US1: T013 ∥ T015 (different e2e files) while T012 is being written. T014 and T016 follow T013 (same file)
- US2: T020 ∥ T021 ∥ T022 ∥ T023 ∥ T027 (all test files). T027 → T028 can proceed in parallel with T024 → T025
- US3: T030 ∥ T031 (different files)
- Polish: T033 ∥ T034

---

## Parallel Example: User Story 2

```text
# Write all US2 tests together (different files):
Task: "CameraCapture component tests in frontend/tests/components/CameraCapture.test.tsx"      (T020)
Task: "Live-camera integration tests in frontend/tests/components/AddFoodPhoto.test.tsx"       (T021)
Task: "Camera e2e in frontend/tests/e2e/camera.spec.ts"                                        (T022)
Task: "Browser camera service unit tests in frontend/tests/unit/media/browserCamera.test.ts"   (T027)

# Then two implementation tracks in parallel:
Track A: T024 CameraCapture.tsx → T025 wire into AddFoodPhoto.tsx → T026 styles
Track B: T028 createBrowserCameraService in src/media/camera.ts
# Join: T029 wire the real service in main.tsx and run e2e
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 (US1): the library picker, preview, replace/remove, and early decode errors. Take photo
   keeps today's camera-app behavior
3. **STOP and VALIDATE** on a real phone over LAN HTTP (quickstart manual check 1). This alone closes
   the biggest gap (logging a meal photo later)

### Incremental Delivery

1. US1 → phones can log from the library (MVP)
2. US2 → in-app live camera with webcam and camera switching, and all camera-failure handling
3. US3 → desktop parity verified, README updated
4. Polish → privacy check, full gate, device validation

---

## Notes

- Never call `getUserMedia` outside `src/media/camera.ts`, and never on render (FR-008)
- Every user-visible string comes from [contracts/photo-step-ui.md](./contracts/photo-step-ui.md). If wording must change, change the contract first
- The backend contract is unchanged. If a task seems to need a backend change, stop and ask
- Avoid editing the same file in parallel: `AddFoodPhoto.tsx` (T018, T025), `AddFoodPhoto.test.tsx` (T012, T021, T031), `log-photo.spec.ts` (T013, T014, T016, T030) and `styles.css` (T019, T026) are sequential within their owners
