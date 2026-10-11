# Feature Specification: AI Macro Logging

**Feature Branch**: `001-ai-macro-logging`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "macro logging: I want to track macro content throughout the day as I eat meals. I want AI to search a food that I've entered into the application (via text or picture) analyze it's content and provide me a macro estimate. I want it to remember the totals for that session"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log a food by text description (Priority: P1)

While eating or just after a meal, I type a short description of what I ate (e.g. "2 scrambled
eggs and a slice of whole wheat toast with butter"). The app uses AI to estimate the calories,
protein, carbohydrates, and fat. I review the estimate, adjust anything that looks wrong, and
add it to my log. My running totals update right away.

**Why this priority**: This is the core loop of the product: describe food, get macros, keep a
running total. On its own it already replaces manual macro math.

**Independent Test**: Enter a text description, confirm the estimate, and check that the entry
appears in the log and the running totals increase by exactly the confirmed values.

**Acceptance Scenarios**:

1. **Given** an empty log, **When** I enter "1 medium banana" and request an estimate, **Then**
   I see an estimate showing calories, protein, carbs, and fat with units, marked as an AI
   estimate, before anything is saved.
2. **Given** an estimate is shown, **When** I confirm it, **Then** the entry is added to my log
   and the running totals increase by exactly the confirmed amounts.
3. **Given** an estimate is shown, **When** I edit the protein value and then confirm, **Then**
   the edited value (not the original AI value) is saved and counted in the totals.
4. **Given** an estimate is shown, **When** I cancel, **Then** nothing is added and the totals
   are unchanged.
5. **Given** a description containing several foods, **When** I request an estimate, **Then**
   I see a per-item breakdown along with the combined total.

---

### User Story 2 - See running macro totals (Priority: P1)

At any point I can see my total calories, protein, carbs, and fat logged so far, and the list of
entries that make up those totals. The totals are remembered: closing and reopening the app does
not lose them.

**Why this priority**: The user explicitly wants totals remembered. Without persistent totals,
logging individual foods has little value.

**Independent Test**: Log two entries, close and reopen the app, and verify both entries and the
correct totals are still shown.

**Acceptance Scenarios**:

1. **Given** I have logged entries, **When** I open the main screen, **Then** I see the current
   totals for calories, protein, carbs, and fat without navigating elsewhere.
2. **Given** I have logged entries, **When** I close and reopen the app, **Then** the same
   entries and totals are shown.
3. **Given** I have logged entries, **When** I delete one, **Then** the totals decrease by
   exactly that entry's values.
4. **Given** I have logged an entry, **When** I edit its quantity or macro values, **Then** the
   totals reflect the edited values.
5. **Given** I logged entries yesterday, **When** I open the app after local midnight, **Then**
   today's totals start at zero and yesterday's entries and totals are still available to view.
6. **Given** I am viewing today, **When** I go to a previous day, **Then** I see that day's
   entries and totals and can edit or delete them.

---

### User Story 3 - Log a food from a photo (Priority: P2)

Instead of typing, I take or upload a photo of my meal. The AI identifies the foods it can see,
estimates portion sizes, and gives me a macro estimate that I can review, adjust, and confirm
just like a text entry.

**Why this priority**: Photo input makes logging faster, especially on a phone. It builds on the
same estimate-review-confirm flow as Story 1, so it comes second.

**Independent Test**: Upload a photo of a simple meal, confirm the estimate, and check that the
entry and updated totals appear just like a text entry.

**Acceptance Scenarios**:

1. **Given** I am on the main screen on a phone, **When** I choose to add food by photo,
   **Then** I can take a new photo with the camera or pick an existing image.
2. **Given** I submitted a photo, **When** the estimate is shown, **Then** it lists each food
   identified, with its estimated portion and macros, and I can edit, remove, or add items
   before confirming.
3. **Given** I submitted a photo, **When** I add a text note (e.g. "cooked in olive oil"),
   **Then** the note is taken into account in the estimate.
4. **Given** a photo where no food can be identified, **When** the analysis finishes, **Then**
   I see a clear message and can retry or switch to text or manual entry.

---

### User Story 4 - Re-log a food I've eaten before (Priority: P3)

Foods I have confirmed before are remembered. When I eat the same thing again, I can pick it
from a recent foods list and log it without asking the AI again.

**Why this priority**: This meets the constitution's "≤ 3 interactions" rule for repeat foods
and saves time and AI usage. It is not needed for the first usable version.

**Independent Test**: Log a food via AI, then re-log it from the recent foods list in 3 or fewer
interactions and check that the totals increase by the same values.

**Acceptance Scenarios**:

1. **Given** I previously confirmed "Greek yogurt, 170 g", **When** I open recent foods and
   select it, **Then** it is logged with its saved values in no more than 3 interactions from
   the main screen.
2. **Given** I select a recent food, **When** I change the quantity before logging, **Then** the
   macros are scaled in proportion to the new quantity.

---

### User Story 5 - Daily protein goal (Priority: P3)

This is a protein-focused app. I set a daily protein target in grams, and the main screen shows
how much protein I've logged today against that target and how much is left.

**Why this priority**: Protein is the main number I care about, so progress toward the protein
target is the most useful thing on the main screen. Logging and totals (Stories 1–2) still work
without it, so it can come after them.

**Independent Test**: Set a protein goal of 150 g, log entries totaling 90 g of protein, and check
that the main screen shows 90 / 150 g with 60 g remaining.

**Acceptance Scenarios**:

1. **Given** no goal is set, **When** I open the main screen, **Then** I see protein and other
   totals without a progress indicator, plus a prompt to set a protein goal.
2. **Given** I set a protein goal of 150 g, **When** I have logged 90 g of protein today,
   **Then** the main screen shows 90 g of 150 g and 60 g remaining.
3. **Given** I have logged more protein than my goal, **When** I view the main screen, **Then**
   I see that the goal is met and by how much it is exceeded.
4. **Given** I change my goal, **When** I view today or a previous day, **Then** today uses the
   new goal, and previous days keep the goal that was in effect on that day.

---

### Edge Cases

- **AI unavailable** (offline, not configured, error, or timeout): the user is told clearly and
  can still enter calories and macros manually; totals keep working.
- **Unrecognizable input** (e.g. "asdf", or a photo with no food): the user gets a "couldn't
  identify food" message, not a made-up estimate.
- **Implausible AI estimate** (e.g. negative values, or calories inconsistent with
  protein/carbs/fat): the estimate is rejected or flagged before it can be confirmed.
- **Vague portion** (e.g. "some pasta"): the estimate states the portion it assumed (e.g.
  "assumed 1 cup cooked, ~140 g") so the user can correct it.
- **Very large or zero quantities**: zero is accepted and adds nothing. Implausibly large values
  require confirmation.
- **Large or unsupported image files**: the user is told the image could not be used and why.
- **Midnight rollover while the app is open**: entries are assigned to the day on which they
  were logged, and the main screen switches to the new day's totals.
- **Editing or deleting an entry from an earlier day**: only that day's totals change.
- **Time zone change (travel)**: entries keep the day they were logged on, and new entries use
  the device's current local date.
- **Protein goal of zero or a non-numeric value**: rejected with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to describe a food or meal in free text and request an AI macro
  estimate.
- **FR-002**: Users MUST be able to submit a photo (taken with the camera or chosen from the
  device) and request an AI macro estimate, optionally with a text note.
- **FR-003**: Each estimate MUST include calories (kcal), protein (g), carbohydrates (g), and fat
  (g), plus the food name(s) and the portion size assumed, with units.
- **FR-004**: When the input contains several foods, the estimate MUST show a per-item breakdown
  and a combined total.
- **FR-005**: The system MUST validate each AI estimate before showing it. It MUST reject
  negative values and flag estimates whose calories are not consistent with protein × 4 + carbs
  × 4 + fat × 9 (within a tolerance set during planning). A flagged estimate MUST NOT be
  confirmed until the user explicitly accepts the warning or edits the values.
- **FR-006**: Users MUST review each estimate and confirm, edit, or discard it. Nothing is added
  to the log without explicit confirmation.
- **FR-007**: Confirmed entries MUST record whether their values came from AI (unedited), AI
  (user-edited), or manual entry.
- **FR-008**: Users MUST be able to enter calories and macros manually without the AI, for
  example when the AI is unavailable.
- **FR-009**: The main screen MUST show today's running totals of calories, protein, carbs, and
  fat, plus the list of entries that make them up. Protein MUST be the most prominent total.
- **FR-010**: Users MUST be able to edit and delete logged entries, and totals MUST update
  immediately to match.
- **FR-011**: Entries and totals MUST be stored on the device and remain after the app is closed
  or the device restarts.
- **FR-012**: Running totals MUST cover one calendar day in the device's local time zone. Totals
  MUST start at zero at local midnight. Entries from previous days MUST be kept, and users MUST
  be able to view, edit, and delete them by going to that day.
- **FR-013**: Each entry MUST record the time it was logged.
- **FR-014**: Confirmed foods MUST be saved to a recent foods list from which they can be re-logged
  with an adjustable quantity, scaling macros proportionally.
- **FR-015**: Only the food description and/or photo (and optional note) MUST be sent for AI
  analysis. Log history, totals, and any other personal data MUST NOT be sent. Location and
  other identifying metadata MUST be removed from photos before sending.
- **FR-016**: While an estimate is being produced, the user MUST see a progress indicator and be
  able to cancel.
- **FR-017**: All features MUST work in both desktop and mobile browsers.
- **FR-018**: Users MUST be able to set, change, and clear a daily protein goal in grams. No goals
  exist for calories, carbs, or fat.
- **FR-019**: When a protein goal is set, the main screen MUST show today's protein against the
  goal: amount logged, goal, and amount remaining (or the amount exceeded, once the goal is met).
- **FR-020**: Changing the protein goal MUST apply from the current day forward. Previous days
  MUST keep the goal that was in effect on that day.

### Key Entities

- **Log Entry**: one confirmed food logged by the user. Has food name, quantity and unit,
  calories, protein, carbs, fat, data source (AI / AI-edited / manual), time logged, and the
  day it belongs to.
- **Food Estimate**: an unconfirmed AI result for one text or photo submission. Has one or more
  estimated items (name, assumed portion, macros), a combined total, and any validation flags.
  It is never counted in totals until confirmed.
- **Saved Food**: a previously confirmed food available for quick re-logging. Has name,
  reference quantity and unit, macros for that quantity, and when it was last used.
- **Day Log**: one calendar day (local time) and its entries. Its totals are the sum of its
  entries, and it records the protein goal in effect that day, if any.
- **Protein Goal**: the user's daily protein target in grams and the date from which it applies.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from describing a food in text to a confirmed log entry in under 30
  seconds, excluding typing time.
- **SC-002**: A user can go from taking a photo to a confirmed log entry in under 45 seconds.
- **SC-003**: Running totals always equal the sum of the logged entries. This holds in 100% of
  add, edit, and delete cases tested.
- **SC-004**: 100% of logged entries and totals are still present after closing and reopening
  the app.
- **SC-005**: A previously logged food can be re-logged in 3 or fewer interactions from the main
  screen.
- **SC-006**: When AI lookup is unavailable, the user can still log a food manually, and 100% of
  AI failures show a clear message instead of silently failing.
- **SC-007**: For common single foods with a stated portion (e.g. "1 large egg"), AI calorie
  estimates fall within ±20% of standard reference values in at least 80% of a test sample.
- **SC-008**: All flows can be completed on both a desktop browser and a phone browser (≥ 360px
  wide).
- **SC-009**: Today's protein total and remaining protein to goal are visible on the main screen
  without scrolling, on both phone and desktop.

## Assumptions

- Single user, personal tool. No accounts or multi-user support.
- This is a protein-focused app. Calories, protein, carbohydrates, and fat are tracked, but only
  protein has a goal. Fiber, sugar, sodium, and micronutrients are out of scope for this feature.
- Viewing previous days is a simple per-day view. Charts, trends, and weekly summaries are out of
  scope.
- "Search a food" means the AI estimates nutrition from its own knowledge. Integration with an
  external nutrition database is out of scope.
- Photos are of the food itself (a plate or meal). Reading printed nutrition labels may work but
  is not a requirement.
- AI estimates are approximations. The user is responsible for reviewing them, and the app shows
  them as estimates.
- Meal categories (breakfast/lunch/dinner/snack) are out of scope; entries are ordered by time
  logged.
- AI lookup needs an internet connection. Viewing totals and manual entry work offline.
- Photos are used only for analysis and are not stored long-term in the log.
- Data export (required by the constitution) is handled by a separate feature.
