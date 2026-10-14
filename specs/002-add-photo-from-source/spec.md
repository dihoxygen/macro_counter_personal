# Feature Specification: Add Photo From Source

**Feature Branch**: `002-add-photo-from-source`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "New feature branch: `002-add-photo-from-source`. Feature to add previously taken pictures from a camera's photo (for mobile), and from a live web cam (for web versions on the desktop)."

## Context

Feature 001 added logging a meal from a photo. Today the photo step works differently on each
device:

- **Phone**: the photo button goes straight to the camera, so a meal photo taken earlier (for
  example at a restaurant) can't easily be picked from the photo library.
- **Desktop**: the only option is a file picker. A webcam can't be used to take a photo of the
  meal on the spot.

This feature lets the user choose where the photo comes from: an existing photo from the device's
library or files, or a new photo taken through a live camera view inside the app. Everything after
the photo is chosen (note, AI estimate, review, confirm) stays the same as in feature 001.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log a meal from a photo already on my phone (Priority: P1)

I took a picture of my lunch earlier, but didn't log it then. Later, on my phone, I choose to add
food by photo, pick "Choose existing photo", select the lunch picture from my photo library, and
get a macro estimate that I review and confirm as usual.

**Why this priority**: Logging later is very common: people eat first and log afterwards. On
phones, the photo flow currently only opens the camera, so this case is blocked. This is the
biggest gap and is useful on its own.

**Independent Test**: On a phone, put a meal photo in the photo library ahead of time, open the
photo flow, pick that photo, and confirm the estimate. Check that the entry is added and the
totals update just like with a newly taken photo.

**Acceptance Scenarios**:

1. **Given** I am adding food by photo on a phone, **When** the photo step opens, **Then** I see
   separate options to take a new photo and to choose an existing photo.
2. **Given** I choose "Choose existing photo", **When** the device's picker opens, **Then** I can
   select a photo from my photo library (not only from the camera).
3. **Given** I selected an existing photo, **When** I return to the app, **Then** I see a preview
   of the selected photo and can replace it or remove it before requesting an estimate.
4. **Given** I selected an existing photo and requested an estimate, **When** the estimate is
   shown, **Then** I review, edit, and confirm it exactly as in the feature 001 photo flow.
5. **Given** I open the picker, **When** I cancel without choosing a photo, **Then** I return to
   the photo step with nothing selected and no error.

---

### User Story 2 - Take a meal photo with my desktop webcam (Priority: P2)

I'm at my desk with my meal in front of me. I choose to add food by photo, pick "Use camera", and
see a live view from my webcam inside the app. I hold the plate up, take a snapshot, check the
captured image, retake it if needed, and then request an estimate.

**Why this priority**: Without this, desktop users must take a photo with another device and move
the file to the computer first. It adds value, but desktop users can already log by text or by
uploading a file, so it comes after Story 1.

**Independent Test**: On a desktop computer with a webcam, open the photo flow, start the live
camera, capture a frame of a meal, and confirm the estimate. Check that the entry and totals
update.

**Acceptance Scenarios**:

1. **Given** I am adding food by photo on a device with a camera, **When** I choose "Use
   camera", **Then** the app asks for camera permission (if not already granted) and shows a live
   preview.
2. **Given** the live preview is showing, **When** I take a snapshot, **Then** the preview is
   replaced by the captured still image with options to retake or use it.
3. **Given** I captured an image, **When** I choose retake, **Then** the live preview comes back
   and the previous capture is discarded.
4. **Given** I accepted a captured image, **When** I request an estimate, **Then** the flow
   continues exactly as with any other photo.
5. **Given** the live preview is showing, **When** I leave the photo step, cancel, or finish
   capturing, **Then** the camera turns off (the device's camera-in-use indicator goes off).
6. **Given** the device has more than one camera, **When** the live preview is showing, **Then**
   I can switch between cameras.

---

### User Story 3 - Choose a photo file on desktop (Priority: P3)

On my desktop I already have a meal photo saved (for example, synced from my phone). I choose
"Choose existing photo" and select the file from my computer.

**Why this priority**: This mostly exists already (feature 001 has a desktop file picker). It is
listed so the source choice looks and works the same on every device.

**Independent Test**: On a desktop computer, choose an image file from disk through the photo
step and confirm the estimate.

**Acceptance Scenarios**:

1. **Given** I am adding food by photo on a desktop, **When** the photo step opens, **Then** I
   see the same two options as on a phone: take a photo with the camera and choose an existing
   photo.
2. **Given** I choose "Choose existing photo" on desktop, **When** I select an image file,
   **Then** I see its preview and can continue to an estimate.

---

### Edge Cases

- **Camera permission denied or blocked**: the user sees a clear message that explains how to
  allow camera access, and the "Choose existing photo" option still works.
- **No camera on the device** (for example, a desktop without a webcam): the camera option is
  hidden or disabled with a short explanation, and choosing an existing photo still works.
- **Live camera not supported in the current context** (for example, the browser blocks camera
  access because the page isn't on a secure connection): the camera option is unavailable with an
  explanation, and choosing an existing photo still works. On phones, taking a new photo through
  the device's own camera app stays available whenever the device supports it.
- **Camera already in use by another app**: the user gets a clear message and can retry or choose
  an existing photo.
- **Camera disconnected while the preview is showing**: the preview stops, the user is told, and
  can retry or choose an existing photo.
- **Selected file isn't an image, or is a format the app can't read** (for example, some HEIC
  photos on browsers that can't decode them): the user is told the photo couldn't be used and can
  pick another. Nothing is sent for analysis.
- **Very large photo** (for example, a high-resolution photo from the library): it is accepted
  and shrunk on the device before analysis, as in feature 001.
- **Picker or camera cancelled**: the user goes back to the photo step without an error.
- **Rotated photos**: library photos and webcam captures appear upright in the preview and are
  sent upright for analysis.
- **Photo metadata**: library photos often contain location and other metadata. Like all photos,
  they are stripped of this metadata before being sent (feature 001, FR-015).
- **App moved to the background or tab hidden while the camera is live**: the camera turns off.
  When the user comes back, they can restart it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The photo step MUST offer two clearly labeled photo sources: **take a new photo
  with the camera** and **choose an existing photo** from the device's photo library or files.
- **FR-002**: On phones, "choose an existing photo" MUST let the user select a photo from the
  device's photo library, not only take a new one.
- **FR-003**: On devices with a camera the app is allowed to use, "take a new photo" MUST show a
  live camera preview inside the app, from which the user can capture a still image.
- **FR-004**: On phones where an in-app live preview can't be used, "take a new photo" MAY fall
  back to the device's own camera app instead. The user MUST still end up with a captured photo
  ready to use.
- **FR-005**: After capturing a frame, the user MUST be able to retake it or use it.
- **FR-006**: When the device has more than one camera, the user MUST be able to switch between
  them in the live preview. On phones, the rear (outward-facing) camera MUST be the default.
- **FR-007**: The camera MUST turn off as soon as it is no longer needed: after a capture is
  accepted, when the user cancels or leaves the photo step, and when the app is hidden or moved to
  the background.
- **FR-008**: Camera access MUST be requested only when the user chooses to use the camera, never
  when the screen loads.
- **FR-009**: When the camera can't be used (no camera, permission denied, unsupported, in use
  elsewhere, or disconnected), the user MUST see a specific, plain-language message, and "choose
  an existing photo" MUST remain available.
- **FR-010**: Whatever the source, the chosen or captured photo MUST be shown as a preview before
  an estimate is requested, and the user MUST be able to replace or remove it.
- **FR-011**: Photos from every source MUST go through the same processing as feature 001 photos
  (resizing, upright orientation, metadata removal) and the same estimate, review, and confirm
  flow. No source may skip validation or confirmation.
- **FR-012**: Files that aren't images or can't be read MUST be rejected with a clear message
  before anything is sent for analysis.
- **FR-013**: Photos and camera frames MUST stay on the device except for the single selected
  photo sent for analysis. Live camera frames MUST NOT be recorded, stored, or sent anywhere.
- **FR-014**: Both photo sources MUST be available on phones and on desktops wherever the device
  supports them (constitution Principle IV: no desktop-only or mobile-only features).
- **FR-015**: All controls in the photo step (source choice, capture, retake, use, switch camera)
  MUST work with touch, mouse, and keyboard, with touch targets of at least 44×44 px, at screen
  widths of 360 px and up.
- **FR-016**: The note field, cancel during analysis, and recovery options from feature 001
  (retry, switch to text, enter manually) MUST keep working for every photo source.

### Key Entities

- **Photo Source**: how the user provides a photo: *existing photo* (from the library or files)
  or *camera capture* (from the live in-app preview or the device camera app). Used only during
  the photo step and not stored.
- **Selected Photo**: the single image waiting to be analyzed, from either source. It has a
  preview and can be replaced or removed. It is used only for analysis and is not stored long-term
  (as in feature 001).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a phone, a user can go from the main screen to an estimate request for a photo
  already in their library in 4 or fewer interactions (not counting scrolling in the library).
- **SC-002**: On a desktop with a webcam, a user can go from opening the photo step to an
  estimate request using a live capture in under 20 seconds.
- **SC-003**: The live camera preview appears within 3 seconds of granting permission (or of
  choosing the camera, if permission was already granted).
- **SC-004**: In 100% of tested cases (capture accepted, cancel, leave the step, hide the app),
  the camera turns off within 2 seconds.
- **SC-005**: In 100% of tested camera failures (denied, missing, in use, unsupported), the user
  sees an explanation and can still finish logging with an existing photo.
- **SC-006**: Photos from every source give entries that behave the same as feature 001 photo
  entries: same review steps, same metadata removal, same effect on totals.
- **SC-007**: Both photo sources can be used successfully on at least one current phone browser
  and one current desktop browser.

## Assumptions

- This feature changes only how a photo is chosen. The AI estimate, validation, review, and
  confirm steps from feature 001 are reused unchanged.
- One photo per estimate, as in feature 001. Selecting several photos at once is out of scope.
- Video, burst capture, flash or zoom controls, filters, and cropping/editing of the photo are out
  of scope.
- Photos are still not stored in the log after analysis (feature 001 assumption).
- In-app live camera access needs a secure connection in most browsers. When the app is reached
  over plain local-network HTTP (as with the current phone setup), the in-app live preview may be
  unavailable on that device. Phones then fall back to the device's camera app (FR-004), and
  choosing an existing photo always works. How to serve the app securely is decided during
  planning.
- The camera permission prompt and the photo library picker are the browser's or operating
  system's own screens. The app doesn't control how they look.
- "Phone" and "desktop" describe typical device types. The source options depend on what the
  device can do, not on detecting the device type.
