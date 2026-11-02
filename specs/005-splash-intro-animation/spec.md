# Feature Specification: Splash Intro Animation

**Feature Branch**: `claude/macro-counter-loading-graphic-5e85b1`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "let's add this design to the application." — the design is the "Macro Counter Splash" canvas (https://claude.ai/artifact/TKWHmsASNjBf4dK8e7UxgT), a 10-second typeface-shuffle intro that lands on the "Macro Counter" logo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the branded intro when the app opens (Priority: P1)

When someone opens Macro Counter, a full-screen black intro plays. The letters of "Macro Counter" appear in a sequence of changing typefaces: first the "M" in a sans-serif together with both "C"s in a second typeface, then a hard cut to only the vowels, each in a random typeface, then several more random shifts. During the shifts, lit shapes (circles, squares, diamonds) pop in behind different letters. The final shift lands on the complete "Macro Counter" logo: every letter in a different typeface, with the "M" and both "O"s sitting inside lit shapes that flicker like a failing light bulb and then settle at a dim glow. The whole intro lasts 10 seconds, after which the person arrives on the screen they would normally see.

**Why this priority**: This is the feature. It gives the app a recognisable identity at the moment it opens.

**Independent Test**: Open the app in a fresh browser session and watch it. The intro plays in the order described, ends on the logo with the M and O's in shapes, and hands over to the normal first screen after 10 seconds.

**Acceptance Scenarios**:

1. **Given** the app is opened and the intro is due to play, **When** it starts, **Then** the screen is black and, within the first second, only the "M" (sans-serif) and both "C"s (one shared second typeface) are visible.
2. **Given** the intro is playing, **When** the opening frame ends, **Then** the view cuts to only the vowels (a, o, o, u, e), each in a typeface chosen at random.
3. **Given** the intro is in its shuffle phase, **When** each shift happens, **Then** letters change typeface at random, and lit shapes may appear behind different letters each time.
4. **Given** the shuffle is finishing, **When** the final shift happens, **Then** "Macro Counter" is fully spelled out, every letter is in a different typeface, and the lit shapes sit only behind the "M" and both "O"s, each a different one of circle, square and diamond.
5. **Given** the final logo is showing, **When** the flicker phase runs, **Then** the M and O shapes, their glow and the light they cast flicker unevenly and come to rest at a dim, steady glow by the 10-second mark.
6. **Given** the intro has reached 10 seconds, **When** it ends, **Then** the person is on the screen they would have reached without the intro (sign-in screen if signed out, Today screen if signed in).
7. **Given** the intro has played twice, **When** the two runs are compared, **Then** the typefaces and the shapes used are chosen fresh each time, so the runs differ.

---

### User Story 2 - Get to the app without waiting (Priority: P2)

Someone who wants to log food straight away can dismiss the intro with a single tap, click or key press and go directly to the screen they would normally see.

**Why this priority**: Logging food fast is a core principle of the app. A 10-second wait every time would work against it, so a way past the intro is required for the feature to be acceptable, but it builds on Story 1.

**Independent Test**: Open the app, tap anywhere (or press a key) during the intro, and confirm the normal first screen appears at once with nothing lost.

**Acceptance Scenarios**:

1. **Given** the intro is playing, **When** the person taps, clicks, or presses Enter, Space or Escape, **Then** the intro ends within a fraction of a second and the normal first screen appears.
2. **Given** the intro is playing, **When** the person uses a keyboard or screen reader, **Then** there is a clearly labelled way to skip it.
3. **Given** the intro was skipped, **When** the app continues, **Then** nothing about the person's session or data differs from letting it run to the end.

---

### User Story 3 - Intro that respects reduced-motion settings (Priority: P3)

Someone whose device asks apps to reduce motion sees a still version of the final logo, with no flicker or shuffle, before the app continues.

**Why this priority**: The flickering and fast cuts can be uncomfortable or harmful for some people. It's an accessibility requirement, but most people won't see it.

**Independent Test**: Turn on the device's reduce-motion setting, open the app, and confirm only a still logo is shown and the app moves on promptly.

**Acceptance Scenarios**:

1. **Given** the device asks for reduced motion, **When** the app opens and the intro is due, **Then** the final logo appears still (no shuffle, no flicker), with the M and O's in their shapes at a steady glow.
2. **Given** the device asks for reduced motion, **When** the still logo is showing, **Then** the app moves on to the normal first screen after no more than 2 seconds, or sooner if the person taps, clicks or presses a key.

---

### Edge Cases

- **App opened offline**: the intro still plays in full, using no network.
- **App ready before the intro ends**: the intro still plays to the end (or until skipped). The person is not dropped into the app mid-animation.
- **App not ready when the intro ends**: the app's normal loading state appears, rather than the intro freezing or looping.
- **Typefaces not yet available**: if a typeface can't be shown in time, that letter falls back to a plain typeface. The sequence and its timing do not stall.
- **Narrow phone screens (360 px wide)**: the logo and shapes scale down so the whole word fits on one line, with no horizontal scrolling and no letters clipped.
- **Tab hidden mid-intro**: if the person switches tabs while the intro is playing, it doesn't keep them waiting when they return. It is treated as finished.
- **Deep links and reloads**: a reload, or a direct link opened in a tab where the intro has already played, goes straight to the screen with no intro (FR-010). A direct link opened in a new session plays the intro first, then lands on the linked screen.
- **Rapid flicker safety**: the flicker never flashes more than three times in any one second.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST show a full-screen intro on a black background when the app opens, subject to FR-010.
- **FR-002**: The intro MUST last 10 seconds from the moment it first appears, ending on the final logo.
- **FR-003**: The intro MUST open with only the "M" in a sans-serif typeface and both "C"s in one shared second typeface.
- **FR-004**: The intro MUST then cut to only the vowels of "Macro Counter", each in a randomly chosen typeface.
- **FR-005**: The intro MUST follow with at least five more random shifts. In each shift, letters change typeface at random, and lit shapes (circle, square, diamond) appear behind a random selection of the visible letters.
- **FR-006**: The final shift MUST show the complete "Macro Counter" logo, every letter in a different typeface. Lit shapes sit only behind the "M" and both "O"s, and the three use one each of circle, square and diamond in random order. This final frame MUST arrive as the last step of the shuffle, not as a separate cut after it.
- **FR-007**: The final logo's shapes MUST look as if each letter is physically inside a lit box. They must have:
  - visible depth
  - glow coming from the letter
  - light cast onto the surface below
  - shadows
- **FR-008**: From the final logo until the 10-second mark, the M and O shapes MUST flicker unevenly like a failing light bulb, and then settle at a dim steady glow. The flicker MUST NOT exceed three flashes in any one-second period.
- **FR-009**: Typefaces and shape assignments MUST be chosen afresh each time the intro plays, from a pool of at least 12 visually distinct typefaces.
- **FR-010**: The intro MUST play once per browser session. It plays the first time the app is opened in a tab or window. Reloads, navigation and deep links within that same session MUST NOT replay it. Opening the app in a new session (new tab or window, or after the browser is closed) plays it again.
- **FR-011**: The person MUST be able to skip the intro at any time with a tap, a click, or Enter, Space or Escape. The intro MUST also have a labelled skip control that keyboard and screen-reader users can reach.
- **FR-012**: When the intro ends or is skipped, the system MUST show the screen the person would have reached without the intro, in the same state.
- **FR-013**: The intro MUST present the product name "Macro Counter" to assistive technology once, not letter by letter.
- **FR-014**: When the device requests reduced motion, the system MUST show a still final logo instead of the animation, for no more than 2 seconds. Skipping as in FR-011 must still work.
- **FR-015**: The intro MUST work offline and MUST NOT make any request to third-party services (including for typefaces).
- **FR-016**: The intro MUST fit on screens from 360 px wide up to desktop sizes, with the full word on one line and no clipping or horizontal scrolling.
- **FR-017**: The intro MUST NOT delay the app's startup work. The app keeps loading in the background while the intro plays.

### Key Entities

- **Intro play record**: whether the intro has already played in the current browser session. It lasts only for that session, is not tied to any user account and holds no personal data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 10 out of 10 test runs on desktop and mobile, the intro ends on the complete logo with shapes on exactly the M and both O's, and hands over to the normal first screen at 10 seconds (±0.5 s).
- **SC-002**: When the intro is skipped, the normal first screen is visible within 0.5 seconds of the tap, click or key press in every test run.
- **SC-003**: Across 10 consecutive plays, no two runs use an identical set of typefaces, and every final frame uses at least 12 different typefaces across its 12 letters.
- **SC-004**: With the device's reduced-motion setting on, no animated frame is shown, and the app continues within 2 seconds.
- **SC-005**: Measured from launch, a returning user can still log a previously used food within 3 interactions plus one skip tap.
- **SC-006**: Opening the app with the network disconnected plays the intro identically, with zero failed requests attributed to the intro.

## Assumptions

- The approved design canvas "Macro Counter Splash" is the visual reference for the following:
  - typeface pool
  - glow colour (warm amber by default)
  - shape styling
  - shift timing (first frame at 0.5 s, vowel cut at 1.7 s, shifts every 0.3–0.6 s from 2.9 s, final logo at 7.2 s, flicker to 10 s)
- The canvas's Replay button and Tweaks controls are design-review tools and are not part of the in-app intro.
- The typefaces used in the design are open-licensed and can be bundled with the app, so no third-party font service is needed.
- The intro applies to the whole web app, including the installed (home-screen) version.
- The intro stores no personal data and needs no server changes. Authentication, AI lookup and food data are unaffected.
- Skipping counts as "having seen" the intro for the purposes of FR-010.
