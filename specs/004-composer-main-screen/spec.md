# Feature Specification: Composer Main Screen

**Feature Branch**: `004-composer-main-screen`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "docs/design/composer/README.md" (the Composer UI direction: the AI lookup input
always on Today, estimates reviewed inline instead of on a separate Add food screen, one layout that adapts
from phone to desktop).

## Context

Today the main screen shows totals, the entry list and a row of four equal buttons (Add food, Recent,
Previous days, Account). Adding food opens a separate full screen with its own Describe / Photo / Manual
switcher and review step, and you return with "Back". Re-logging a recent food means opening the Recent
screen first.

This feature reshapes the main screen so that logging, the most frequent action, happens on Today itself.
It changes layout and navigation only. How estimates are produced, validated, reviewed, stored and totalled
(features 001, 002 and 003) stays as it is. Visual reference: `docs/design/composer/`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Describe a food and confirm it without leaving Today (Priority: P1)

On the main screen I type what I ate into the input at the bottom and send it. The estimate appears as a
card on Today, below my logged entries, showing each item with its protein, calories, carbs and fat. I
check it, edit or accept anything flagged, and confirm. The card goes away, the food joins today's list,
and the totals update. I never leave Today.

**Why this priority**: Describing food is the main way to log, and it is the reason for the redesign. On
its own it removes the separate Add food screen from the most common flow.

**Independent Test**: From Today, type "2 eggs and toast", send, confirm the card, and check that the entry
is in today's list and the totals include it, with no change of screen at any point.

**Acceptance Scenarios**:

1. **Given** I am on Today, **When** I type a description and send it, **Then** a progress indicator shows
   on Today and is replaced by an estimate card with a per-item breakdown.
2. **Given** an estimate card is showing, **When** I look at the protein summary, **Then** it shows the
   protein this estimate would add as a pending amount, separate from what is already logged.
3. **Given** an estimate card is showing, **When** I confirm it, **Then** its items are logged, the card
   closes, the input is cleared and the totals include the new items.
4. **Given** an estimate card is showing, **When** I discard it, **Then** nothing is logged, the card
   closes and the totals are unchanged.
5. **Given** an estimate item has a plausibility warning, **When** I have not accepted or corrected it,
   **Then** Confirm is unavailable, as it is today.
6. **Given** an estimate card is showing, **When** I edit, remove or add an item, **Then** the card's
   totals and the pending protein update to match.

---

### User Story 2 - Re-log a recent food from Today (Priority: P1)

Above the input I see a short row of foods I have logged before. I tap one, check or adjust the amount, and
log it. That's it.

**Why this priority**: Repeat foods are a large share of what gets logged. Putting them on Today keeps the
constitution's "previously used food in at most 3 interactions" rule easy to meet.

**Independent Test**: With at least one saved food, re-log it from Today and count the interactions.

**Acceptance Scenarios**:

1. **Given** I have saved foods, **When** I am on Today, **Then** my most recently used foods are shown as
   quick picks next to the input.
2. **Given** I tap a quick pick, **When** the amount appears pre-filled with the food's saved amount,
   **Then** I can log it with one more interaction, or change the amount first, and the macros scale.
3. **Given** I have no saved foods, **When** I am on Today, **Then** no quick-pick row is shown.
4. **Given** I want a recent food that is not among the quick picks, **When** I ask for more, **Then** I
   can reach the full recent foods list.

---

### User Story 3 - Log by photo or by hand from the same input (Priority: P2)

The input has a Describe / Photo / Manual switch. Photo lets me take a picture or choose one, then add an
optional note, and the estimate comes back as the same inline card. Manual shows the name, amount and macro
fields right there, and saving logs the food without the AI.

**Why this priority**: Both methods already exist. Moving them into the input completes the removal of the
separate Add food screen, but they are used less often than describing.

**Independent Test**: Log one food by photo and one manually, both from Today.

**Acceptance Scenarios**:

1. **Given** I switch the input to Photo, **When** I take or choose a photo and send it, **Then** the
   estimate appears as an inline card, as in User Story 1.
2. **Given** I switch the input to Manual, **When** I fill in valid values and save, **Then** the food is
   logged directly with no estimate card.
3. **Given** AI lookup is unavailable or I am offline, **When** I am on Today, **Then** the input opens in
   Manual, Describe and Photo are unavailable, and a short message says why.
4. **Given** I switch method while a description or values are half entered, **When** I switch back,
   **Then** what I entered is still there.

---

### User Story 4 - The same screen works at a desk (Priority: P2)

On a wide screen the same main screen uses the space: today's summary and entries on one side, and the
input and estimate card on the other. Everything is reachable with the keyboard.

**Why this priority**: The constitution requires every feature to work on desktop and mobile. This story
makes sure the new layout is good on desktop, not just usable.

**Independent Test**: At a desktop width, log a described food using only the keyboard. Then resize to
phone width and check that nothing is lost or hidden.

**Acceptance Scenarios**:

1. **Given** a wide window, **When** I open Today, **Then** the entries and the input with any estimate
   card are side by side, and the protein summary is visible without scrolling.
2. **Given** a phone-width window, **When** I open Today, **Then** the layout is one column with the input
   at the bottom.
3. **Given** the keyboard only, **When** I describe, send, review and confirm a food, **Then** each control
   can be reached and used in a sensible order, and pressing Enter in the description sends it.
4. **Given** a phone, **When** the on-screen keyboard opens for the input, **Then** the input and the
   latest content stay visible above it.

---

### User Story 5 - Reach history, goal and account from Today (Priority: P3)

The header of Today has compact controls for previous days, the protein goal and my account, in place of
the row of buttons under the list.

**Why this priority**: These screens already exist and are used less often. They only need a clear,
compact way in.

**Independent Test**: From Today, open Previous days, Protein goal and Account, and return to Today from
each one.

**Acceptance Scenarios**:

1. **Given** I am on Today, **When** I use the history, goal or account control in the header, **Then** the
   matching screen opens.
2. **Given** I am on one of those screens, **When** I go back, **Then** I return to Today, with any
   unconfirmed estimate card still there.

### Edge Cases

- **Estimate pending when I leave Today**: The unconfirmed card and its edits are kept until I return,
  confirm or discard it, for as long as the app stays open. It is never logged automatically.
- **Sending another description while a card is open**: The user must confirm or discard the open card
  first, so two estimates are never pending at once.
- **Estimate fails, times out or is rejected by validation**: The card area shows the error and offers to
  retry or to switch to Manual with the description kept, as the current Add food screen does.
- **Midnight passes while a card is open**: Confirming logs it to the new current day, following the
  existing day rules (FR-012).
- **Goal not set**: The protein summary shows protein logged and a prompt to set a goal, without a goal
  bar.
- **Session expires or I go offline while a card is open**: The card stays, so I can confirm it locally,
  because confirming does not need the server.
- **Many entries**: The list scrolls, and the protein summary and input stay visible.
- **Long food names**: They are truncated on a single line in the entry list and quick picks, and shown in
  full in the card and editor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The main screen MUST provide a food input for describing a food, which sends a description for
  an AI estimate without leaving the main screen.
- **FR-002**: An AI estimate (from a description or a photo) MUST be shown as a card on the main screen,
  with the same review abilities as the current review step: edit, remove and add items, accept warnings,
  confirm and discard.
- **FR-003**: Nothing MUST be logged until the user confirms the card (existing FR-006 of feature 001).
- **FR-004**: While an estimate card is open, the protein summary MUST show the card's protein as pending,
  visibly distinct from protein already logged.
- **FR-005**: At most one estimate card MUST be pending at a time. A new lookup MUST be blocked until the
  open card is confirmed or discarded.
- **FR-006**: An unconfirmed card and its edits MUST survive moving to another screen and back while the
  app stays open.
- **FR-007**: The main screen MUST show up to 5 of the user's most recently used saved foods as quick picks
  when any exist. Picking one MUST let the user log it, at its saved amount or a changed one, in no more
  than 3 interactions from the main screen.
- **FR-008**: The full recent foods list MUST stay reachable from the main screen.
- **FR-009**: The input MUST offer Describe, Photo and Manual methods. Photo MUST support taking and
  choosing a photo, as feature 002 does, and Manual MUST provide the current manual entry fields.
- **FR-010**: When AI lookup is unavailable or the user is offline, the input MUST default to Manual, mark
  Describe and Photo unavailable, and say why.
- **FR-011**: Switching method MUST keep any text or values already entered in each method until the food
  is logged, the card is discarded or the user clears them.
- **FR-012**: The main screen MUST give access to previous days, the protein goal and the account, and the
  separate Add food screen MUST be removed.
- **FR-013**: Today's protein against the goal, plus calories, carbs and fat, MUST be visible on the main
  screen without scrolling, at phone and desktop widths.
- **FR-014**: At widths of 960 CSS px and above, the main screen MUST show the entries beside the input and
  card. Below that it MUST be a single column with the input at the bottom. It MUST be usable from
  360 CSS px wide.
- **FR-015**: Every control MUST be operable by keyboard and by touch, with touch targets of at least
  44×44 CSS px. Pressing Enter in the description MUST send it, and Shift+Enter MUST add a new line.
- **FR-016**: On phones, the input MUST stay visible above the on-screen keyboard while it is in use.
- **FR-017**: The main screen MUST follow the device's light or dark setting. The dark appearance MUST
  match the Composer design reference, and the light appearance MUST use the app's existing light colours.
- **FR-018**: The app MUST keep working offline (except AI lookup) and MUST NOT load fonts or other
  resources from third-party servers.
- **FR-019**: Errors from a lookup (failure, timeout, validation rejection, quota reached) MUST be shown in
  the card area with options to retry or to switch to Manual with the description kept.

### Key Entities

No new stored data. The feature reuses existing entities:

- **Log entry**: A confirmed food on a day. Unchanged.
- **Saved food**: A previously confirmed food, source of the quick picks. Unchanged.
- **Pending estimate**: The unconfirmed card's items and edits. Held only while the app is open and never
  stored, as today's review step behaves.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A described food can be logged from the main screen in 3 interactions (type, send, confirm),
  with no change of screen.
- **SC-002**: A recent food can be re-logged in at most 2 interactions from the main screen at its saved
  amount, and at most 3 with a changed amount.
- **SC-003**: At 360 CSS px and at 1280 CSS px wide, today's protein against goal is visible on the main
  screen without scrolling, with 0 controls under 44×44 CSS px.
- **SC-004**: The full describe, review and confirm flow can be completed with the keyboard alone on
  desktop.
- **SC-005**: Every existing logging path (describe, photo, manual, re-log, edit entry) still works, and
  the existing end-to-end scenarios pass once updated for the new layout.
- **SC-006**: With the network off, the app opens and manual logging and re-logging work, with no
  requests to third-party servers.

## Assumptions

- **Typed corrections are out of scope.** Sending a follow-up like "half the guac" to revise an open
  estimate needs a new kind of AI request. The mockup's correction input is not part of this feature, and
  the input is blocked while a card is open (FR-005).
- **Enter sends on every device.** Food descriptions don't need line breaks, so on touch keyboards
  Enter sends the description and there is no way to type a newline. Shift+Enter adds a newline on
  physical keyboards (FR-015).
- The system font stack is used instead of DM Sans, which keeps the app offline-capable and the content
  security policy unchanged. Self-hosting a font can come later.
- "Most recently used" saved foods follow the existing recent foods order, and up to 5 are shown.
- The quick-pick flow reuses the existing re-log behaviour (amount pre-filled, macros scale).
- Previous days, Protein goal, Account and the full Recent list stay as separate screens with a way back,
  so only Today and adding food change.
- The entry editor for logged entries is unchanged apart from styling.
- Sign-in, setup and session-expired screens are out of scope, apart from picking up shared colours.
- No new runtime dependencies are needed. Layout adaptation is handled by the browser.
