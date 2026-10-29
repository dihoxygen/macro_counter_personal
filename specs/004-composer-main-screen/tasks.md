---
description: "Task list for Composer Main Screen"
---

# Tasks: Composer Main Screen

**Input**: Design documents from `/specs/004-composer-main-screen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/today-ui.md](./contracts/today-ui.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE) applies to every task.
Write and run each test task, and see it **fail**, before its implementation task starts. Claude is
always mocked. No test may call `api.anthropic.com` (Principle VI). Component tests use
`createTestServices` / `renderWithServices` from `frontend/tests/components/testServices.tsx` and the
fake camera from `frontend/tests/components/fakeCamera.ts`.

**Organization**: Tasks are grouped by user story so each story can be built and tested as its own
increment. The old Add food screen keeps working until US3 removes it, so the app stays usable after
every phase.

**Scope**: Frontend only. Do **not** modify `backend/`. No new npm dependencies (plan, Principle V).
No IndexedDB schema change, no new repository, nothing new persisted ([data-model](./data-model.md)).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story the task belongs to (US1–US5, from spec.md)

## Path Conventions

- Frontend source: `frontend/src/`. Tests: `frontend/tests/{unit,components,e2e}/`
- Run commands from `frontend/`: `npx vitest run <path>`, `npx playwright test <name> --project=desktop --project=mobile`, `npm run lint`, `npm run typecheck`
- Roles, accessible names and layout rules are fixed by [contracts/today-ui.md](./contracts/today-ui.md). Use them verbatim. Names marked *(kept)* there must not change

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a green baseline and add shared e2e helpers. No scaffolding is needed

- [ ] T001 Confirm the baseline is green before changing anything. Run `.\scripts\check.ps1` from the repo root if PowerShell is available. Otherwise, from `frontend/`, run `npm run typecheck`, `npm run lint`, `npm test` and `npx playwright test --project=desktop --project=mobile --project=offline`. If anything fails, stop and report the failure to the user instead of continuing
- [ ] T002 [P] In `frontend/tests/e2e/helpers.ts`, add and export:
  - `composer(page: Page)`: returns `page.getByRole('region', { name: 'Log food' })`.
  - `describeFood(page: Page, text: string)`: fills `composer(page).getByLabel('What did you eat?')` with `text` and presses Enter.
  - `reviewCard(page: Page)`: returns `page.getByRole('region', { name: 'Review estimate' })`.

  These helpers are unused until US1. Run `npm run typecheck` to confirm they compile

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Today stays mounted while other screens show ([research R1](./research.md#r1-keeping-a-pending-card-across-screens-fr-006)), and the review card reports its edits. Every story builds on both

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 [P] Write failing tests in `frontend/tests/components/App.test.tsx`:
  - (a) Seed one entry and open its entry editor on Today. Navigate to Previous days: the **Today** heading is not visible (`toBeVisible()` is false, because Today has `hidden`). After **← Back**, the heading is visible again and the same entry editor is still open, which proves Today was not remounted.
  - (b) An entry logged while away (create it through `services.entries.create` while Previous days shows) appears in **Entries** after **← Back**, because Today refreshes when it becomes visible again.
- [ ] T004 [P] Write a failing test in `frontend/tests/components/ReviewEstimate.test.tsx` (new file): `ReviewEstimate` calls the optional `onChange(state)` prop with the updated `ReviewState` after each Edit → Done, Remove, Add item and accepted warning. It is not called on first render
- [ ] T005 Make T003 pass in `frontend/src/App.tsx`, `frontend/src/features/today/TodayScreen.tsx` and `frontend/src/features/today/DayLog.tsx`:
  - `App` always renders `<TodayScreen active={view === 'today'} … />` inside a wrapper with `hidden={view !== 'today'}`, and renders the other views as now.
  - `TodayScreen` keeps a `refreshKey` state and increments it whenever `active` goes from false to true.
  - `DayLog` takes `refreshKey: number` and adds it to its load effect's dependencies.

  Keep every existing App and TodayScreen test green
- [ ] T006 Make T004 pass in `frontend/src/features/add-food/ReviewEstimate.tsx`: add `onChange?: (state: ReviewState) => void`, called from a `useEffect` on `state` that skips the first render. No other behaviour changes

**Checkpoint**: Foundation ready. Today survives navigation, and review edits can be observed

---

## Phase 3: User Story 1 - Describe a food and confirm it without leaving Today (Priority: P1) 🎯 MVP

**Goal**: Type on Today, review the estimate as an inline card with the pending protein shown, and confirm or discard, with no screen change

**Independent Test**: quickstart Q1–Q6. From Today, describe "banana", send, confirm, and see the entry and totals update with no change of screen

### Tests for User Story 1 ⚠️

> Write these tests FIRST and confirm they FAIL before implementation

- [ ] T007 [P] [US1] Write failing unit tests in `frontend/tests/unit/domain/nutrition/proteinSegments.test.ts` for `proteinSegments(loggedG, pendingG, goalG)` from `src/domain/nutrition/proteinProgress.ts`, using the [data-model](./data-model.md#pending-projection-fr-004) rules verbatim:
  - "`goalG === null` → `{ loggedPct: 0, pendingPct: 0 }`"
  - "`loggedPct = min(loggedG / goalG, 1) × 100`"
  - "`pendingPct = min((loggedG + pendingG) / goalG, 1) × 100 − loggedPct`"
  - Reference values: (96, 54, 150) → (64, 36). (96, 0, 150) → (64, 0). (140, 30, 150) → (93.33…, 6.66…) with `toBeCloseTo`. (160, 10, 150) → (100, 0). (0, 0, 150) → (0, 0).
  - `RangeError` for negative, `NaN` or `Infinity` `loggedG` or `pendingG`, and for a `goalG` that is ≤ 0 or non-finite (matching `proteinProgress`).
  - A property check: `loggedPct + pendingPct ≤ 100` for a sweep of inputs.
- [ ] T008 [P] [US1] Write failing tests in `frontend/tests/components/ProteinProgress.test.tsx`:
  - With `loggedG=96`, `goalG=150` and `pendingG=54`, the text "+54 g pending" is shown and the **Protein toward goal** progressbar keeps `aria-valuenow="96"`.
  - With `pendingG=0` or omitted, no pending text is shown.
  - With no goal and `pendingG=54`, "+54 g pending" is shown next to the **Set a protein goal** prompt.
- [ ] T009 [P] [US1] Write failing tests in `frontend/tests/components/Composer.test.tsx` (new file), rendering `TodayScreen` with test services whose `estimateFromText` resolves to `estimateOf(bananaItem)` from `fixtures.ts`:
  - (a) A **Log food** region exists, holding **What did you eat?** and an **Estimate** button.
  - (b) Typing "banana" and pressing Enter shows **Review estimate** on Today, and the **Today** heading stays.
  - (c) Shift+Enter inserts a newline and does not send.
  - (d) Enter during IME composition does not send: fire `keyDown` with `isComposing: true`.
  - (e) **Confirm** logs the item. The card closes, **What did you eat?** is empty and has focus, and **Entries** lists "Banana".
  - (f) **Discard** logs nothing, closes the card and keeps "banana" in the field.
  - (g) While the card is open, **Estimate** and **What did you eat?** are disabled.
  - (h) When the card opens, focus moves into **Review estimate**.
  - (i) While loading, "Estimating…" and **Cancel** show in the card area. **Cancel** returns to input with the text kept.
  - (j) An `EstimateError` shows its message as an `alert` with **Retry** and **Enter manually**. **Retry** re-sends the same text. **Enter manually** shows the manual form in the composer and keeps the description draft.
  - (k) An unrecognized estimate shows "Couldn’t identify food. Try describing it differently, or enter it manually." with the same two buttons.
  - (l) With a goal of 150 g and 96 g logged, opening a 54 g card shows "+54 g pending"; editing the item's protein to 40 shows "+40 g pending".

  Port every review-related assertion from `frontend/tests/components/AddFoodText.test.tsx` into this file so nothing it covered is lost
- [ ] T010 [P] [US1] Rewrite `frontend/tests/e2e/log-text.spec.ts` to log through the composer (`describeFood`, `reviewCard` from helpers) instead of clicking **Add food**. Keep every existing scenario (multi-item, edit, warning acceptance, totals), and add an assertion in each that `page.getByRole('heading', { name: 'Today' })` stays visible throughout. Run it and confirm it fails
- [ ] T011 [P] [US1] Rewrite the describe-food steps in `frontend/tests/e2e/totals-persistence.spec.ts`, `frontend/tests/e2e/auth/flows.ts`, `frontend/tests/e2e/auth/csp.spec.ts` and `frontend/tests/e2e/auth-quota/quota.spec.ts` to use `describeFood` and `reviewCard` instead of **Add food** → **Describe**. In the quota spec, assert the quota message shows as an `alert` in the composer's card area (FR-019). Run the mocked ones and confirm they fail

### Implementation for User Story 1

- [ ] T012 [P] [US1] Make T007 pass: add `export function proteinSegments(loggedG: number, pendingG: number, goalG: number | null): { loggedPct: number; pendingPct: number }` to `frontend/src/domain/nutrition/proteinProgress.ts`. Use `assertNonNegative` from `./validate` for both amounts. Keep full precision with no rounding. Confirm `src/domain/**` coverage stays at 100 %
- [ ] T013 [US1] Make T008 pass in `frontend/src/features/today/ProteinProgress.tsx`, `frontend/src/features/today/TotalsPanel.tsx` and `frontend/src/features/today/DayLog.tsx`:
  - Add an optional `pendingG?: number` prop and thread it from `DayLog` through `TotalsPanel` to `ProteinProgress`.
  - Compute the widths with `proteinSegments`, render a second `.goal-bar-pending` segment after `.goal-bar-fill`, and show `+{formatGrams(pendingG)} pending` when `pendingG > 0`.
  - `aria-valuenow` stays at the logged amount.
- [ ] T014 [US1] Create `frontend/src/features/add-food/DescribeInput.tsx` from the input half of `AddFoodText.tsx`:
  - A form with the **What did you eat?** textarea (`maxLength={500}`, `rows={1}`, `enterKeyHint="send"`, placeholder kept) and an **Estimate** submit button.
  - Props: `value`, `onChange`, `onSend(text)`, `disabled`, and `inputRef` (so the composer can focus it).
  - In `onKeyDown`: Enter without Shift and with `!event.nativeEvent.isComposing` prevents default and sends.
  - Trimmed empty text does not send.

  `AddFoodText.tsx` stays as it is for now, because the Add food screen still uses it until US3
- [ ] T015 [US1] Create `frontend/src/features/add-food/Composer.tsx`, a `<section aria-label="Log food">` that:
  - owns one `useEstimateFlow`, a `method` state (`'describe' | 'manual'` for now; US3 adds `'photo'`) and the `describeDraft` state;
  - renders a **card area** above the inputs: progress with `SubmitOrProgress`-style "Estimating…" and **Cancel**; `ReviewEstimate` with `onConfirm={flow.confirm}`, `onDiscard={flow.reset}` and `onChange`; and the error and unrecognized messages with **Retry** and **Enter manually**, wording kept from `AddFoodText.tsx`;
  - renders `DescribeInput`, and `ManualEntryForm` when `method === 'manual'`;
  - disables the input while `phase.kind` is `loading` or `review` (FR-005);
  - on confirm, clears `describeDraft` and focuses the field; on discard, keeps the draft;
  - moves focus to the review region when it opens (R7);
  - takes props `onLogged()` (called after a confirm or a manual save) and `onPendingChange(proteinG: number)`, which reports `reviewTotal(state).proteinG` while reviewing and `0` otherwise.
- [ ] T016 [US1] In `frontend/src/features/today/TodayScreen.tsx`, render `<Composer>` after `DayLog`. Its `onLogged` increments `refreshKey`, and its `onPendingChange` sets a `pendingProteinG` state that is passed to `DayLog`. Keep the existing bottom button row (including **Add food**) for now. Make T009–T011 pass
- [ ] T017 [US1] Add styles in `frontend/src/styles.css` for `.composer` (surface background, top border, padding 12px 16px), `.card-area`, `.goal-bar` as a flex row, and `.goal-bar-pending` (accent colour at 45 % opacity, using `repeating-linear-gradient` stripes). No layout grid yet (US4). Run `npx playwright test touch-targets` and fix any new target under 44 px

**Checkpoint**: Describing, reviewing and confirming works on Today. The old Add food screen still works too

---

## Phase 4: User Story 2 - Re-log a recent food from Today (Priority: P1)

**Goal**: Up to 5 recent foods as quick picks on Today; re-log in 2 interactions

**Independent Test**: quickstart Q7–Q8. With saved foods, tap one and **Log**, and the entry is added

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Write failing tests in `frontend/tests/components/QuickPicks.test.tsx` (new file), rendering `TodayScreen` with saved foods seeded through `services.savedFoods`:
  - (a) With no saved foods, there is no **Recent foods** group.
  - (b) With 7 saved foods, **Recent foods** holds exactly 5 food buttons in `listRecent()` order, then **More recent foods**.
  - (c) Tapping a food shows the re-log form in the card area with **Amount** pre-filled with the saved reference amount, and **Log** logs it: 2 interactions, and **Entries** updates.
  - (d) Changing **Amount** scales the "Will log" macros, as `RecentFoods` does.
  - (e) **Cancel** closes the form without logging.
  - (f) While a review card or re-log form is open, the food buttons are disabled.
  - (g) After confirming a described food, it appears first in **Recent foods** without a reload.
  - (h) **More recent foods** calls navigation to the `recent` view.
- [ ] T019 [P] [US2] Run `frontend/tests/components/RecentFoods.test.tsx` and confirm it is green now. It must stay green unchanged after the extraction in T021
- [ ] T020 [P] [US2] Rewrite `frontend/tests/e2e/recent.spec.ts`:
  - re-log from **Recent foods** on Today (tap the food, then **Log**) and assert totals update;
  - keep one scenario that reaches the full list through **More recent foods** and logs from there (**Back to list** still exists there).

  Run it and confirm it fails

### Implementation for User Story 2

- [ ] T021 [US2] Extract `RelogForm` from `frontend/src/features/recent/RecentFoods.tsx` into `frontend/src/features/recent/RelogForm.tsx` unchanged, except for a new `backLabel` prop: `'Back to list'` from `RecentFoods`, `'Cancel'` from quick picks. `RecentFoods` imports it. T019 stays green
- [ ] T022 [US2] Create `frontend/src/features/add-food/QuickPicks.tsx`:
  - Props: `refreshKey`, `disabled`, `onPick(food: SavedFood)`, `onMore()`.
  - Loads `services.savedFoods.listRecent()` on mount and when `refreshKey` changes, and takes the first 5.
  - Renders nothing when the list is empty. Otherwise renders `<div role="group" aria-label="Recent foods">` with one button per food (text = `food.name`, single line, truncated with an ellipsis) and a final **More recent foods** button.
- [ ] T023 [US2] Wire quick picks into `frontend/src/features/add-food/Composer.tsx` and `frontend/src/features/today/TodayScreen.tsx`:
  - `Composer` adds a `relog: SavedFood | null` state and renders `RelogForm` (with `backLabel="Cancel"`) in the card area when it is set.
  - The [data-model](./data-model.md#composer-state) invariant is enforced: "at most one of `phase ∈ {loading, review, unrecognized, error}` or `relog ≠ null` holds at a time".
  - Quick picks are disabled while either holds.
  - `TodayScreen` passes `refreshKey` and an `onMore` that calls `onNavigate('recent')`.
  - Remove the **Recent** button from Today's bottom row.

  Make T018 and T020 pass
- [ ] T024 [US2] Style `.quick-picks` in `frontend/src/styles.css`: a single row with `overflow-x: auto`, `gap: 8px` and no wrapping. Chips are `min-height: 44px` with a pill radius, `white-space: nowrap`, and `max-width: 14rem` with an ellipsis. Run `npx playwright test touch-targets` and fix anything under 44 px

**Checkpoint**: US1 and US2 both work on their own. Recent foods are re-logged from Today

---

## Phase 5: User Story 3 - Log by photo or by hand from the same input (Priority: P2)

**Goal**: The Describe / Photo / Manual switch lives in the composer, drafts survive switching, and the separate Add food screen is removed

**Independent Test**: quickstart Q9–Q11. Log by photo and manually from Today, and check that no Add food screen exists

### Tests for User Story 3 ⚠️

- [ ] T025 [P] [US3] Add failing tests to `frontend/tests/components/Composer.test.tsx`:
  - (a) An **Entry method** group with **Describe**, **Photo** and **Manual** and correct `aria-pressed`.
  - (b) Photo: choosing a file through **Choose existing photo** and pressing **Estimate** shows **Review estimate** on Today. The `estimateFromPhoto` fake receives the re-encoded blob and the trimmed note.
  - (c) Type "banana", switch to **Manual**, then back to **Describe**, and "banana" is still there. The same holds for a typed manual name and for a selected photo (FR-011).
  - (d) When `getStatus` resolves `{ aiAvailable: false }`, Manual is selected, **Describe** and **Photo** are disabled, and "AI lookup is unavailable right now. You can still enter the food manually." is shown.
  - (e) With `aiBlockedReason: 'offline'`, the same happens with "Sign in or reconnect to use AI lookup. You can still enter the food manually."
  - (f) The method switch is disabled while a card is open.
  - (g) A photo error shows **Retry**, **Describe in text** and **Enter manually**.
  - (h) Render `App`, open the live camera in Photo (fake camera with `detectSupport` → `'live'`), then navigate to Previous days: the fake camera's stream is stopped.

  Port every remaining assertion from `frontend/tests/components/AddFood.test.tsx` and `frontend/tests/components/AddFoodPhoto.test.tsx` into this file
- [ ] T026 [P] [US3] Rewrite `frontend/tests/e2e/log-photo.spec.ts` and `frontend/tests/e2e/camera.spec.ts` to select **Photo** in `composer(page)` instead of **Add food** → **Photo**. Keep every assertion about re-encoding, EXIF stripping, camera permission and the camera stopping. Add one: after going to **Previous days** with the live camera open, `liveTrackCount(page)` is 0. Run them and confirm they fail
- [ ] T027 [P] [US3] Rewrite `frontend/tests/e2e/offline.spec.ts` so offline logging uses the composer's **Manual** form, and add a quick-pick re-log while offline (Q11). Run it and confirm it fails
- [ ] T028 [P] [US3] Add failing assertions to `frontend/tests/components/TodayScreen.test.tsx` and `frontend/tests/components/App.test.tsx`: there is no **Add food** button on Today, and `App` has no `add` view. Search for `'add'` in `View`

### Implementation for User Story 3

- [ ] T029 [US3] Create `frontend/src/features/add-food/PhotoInput.tsx` from the input half of `AddFoodPhoto.tsx`: the file inputs, `PhotoSourcePicker`, `CameraCapture`, preview, **Remove photo** and the **Note (optional)** textarea (`maxLength={300}`). Props:
  - `selection` (from a `usePhotoSelection` owned by `Composer`, so it survives method switches);
  - `note` and `onNoteChange`;
  - `onSend(jpeg, note)`, `disabled`, and `active: boolean`.

  When `active` becomes false, `cameraOpen` is set to false so `CameraCapture` unmounts and stops its tracks
- [ ] T030 [US3] Extend `frontend/src/features/add-food/Composer.tsx`:
  - add `'photo'` to `method` and render the **Entry method** group with `aria-pressed` buttons;
  - keep all three inputs mounted and hide the unselected ones with `hidden` (FR-011);
  - move the AI-availability logic from `AddFood.tsx` (`getStatus`, `aiBlockedReason`, messages kept verbatim);
  - add the photo recovery buttons;
  - take an `active` prop from `TodayScreen` and pass it to `PhotoInput`, which closes the camera when inactive.

  Make T025–T027 pass
- [ ] T031 [US3] Remove the separate Add food screen:
  - delete `frontend/src/features/add-food/AddFood.tsx`, `AddFoodText.tsx` and `AddFoodPhoto.tsx`, after moving `SubmitOrProgress` (if still used) into `Composer.tsx`;
  - delete `frontend/tests/components/AddFood.test.tsx`, `AddFoodText.test.tsx` and `AddFoodPhoto.test.tsx`, whose assertions were ported in T009 and T025;
  - remove `'add'` from `View` and `titles` in `frontend/src/App.tsx`;
  - remove the **Add food** button from `frontend/src/features/today/TodayScreen.tsx`.

  Make T028 pass and run the full component suite

**Checkpoint**: All three methods work from Today. There is no Add food screen

---

## Phase 6: User Story 4 - The same screen works at a desk (Priority: P2)

**Goal**: Two columns from 960 px, one column with a sticky composer below it, full keyboard use, and the composer kept above the phone keyboard

**Independent Test**: quickstart Q12–Q13

### Tests for User Story 4 ⚠️

- [ ] T032 [P] [US4] Write failing `frontend/tests/e2e/layout.spec.ts`, run in the `desktop` and `mobile` projects, using `mockApi` and one seeded entry:
  - **desktop (1280 × 800)**: the `boundingBox()` of **Log food** has `x ≥` the right edge of **Entries**, and both have `y >` the bottom of **Totals**.
  - **mobile (360 × 740)**: the top of **Log food** is below the top of **Entries**, and **Log food** touches the viewport bottom: `y + height` is within 1 px of 740 when the page is scrolled to the top with 10 seeded entries.
  - **both**: **Totals** is fully in the viewport at scroll 0, and `document.documentElement.scrollWidth <= innerWidth`.
- [ ] T033 [P] [US4] Write failing `frontend/tests/e2e/keyboard.spec.ts` (desktop project only; skip in mobile with `test.skip(testInfo.project.name !== 'desktop')`):
  - focus **What did you eat?** with Tab presses from the page start, type "banana" and press Enter;
  - assert focus is inside **Review estimate**;
  - press Tab until **Confirm** is focused (at most 15 presses) and press Enter;
  - assert the entry is logged and focus is back in **What did you eat?**. Use no mouse calls.
- [ ] T034 [P] [US4] Rewrite `frontend/tests/e2e/touch-targets.spec.ts` to walk the new views per [quickstart](./quickstart.md#scenarios): Today empty; Today with quick picks; the composer in Describe, Photo (live camera open) and Manual; the review card with a warning and the item editor open; and the re-log form. Remove the **Add food** steps. Confirm it fails only where the new layout is missing (or passes; then note that in the task)

### Implementation for User Story 4

- [ ] T035 [US4] Implement the layout in `frontend/src/styles.css` per [research R3](./research.md#r3-one-responsive-layout-fr-013-fr-014-fr-016):
  - `.today` is a grid with areas `header`, `summary`, `entries` and `composer`.
  - Below 960 px it is a single column, and `.composer` is `position: sticky; bottom: 0` with `background: var(--surface)`.
  - `@media (min-width: 960px)`: `.app { max-width: 1120px }` and `.today { grid-template-columns: minmax(0, 1fr) minmax(360px, 420px) }`. Header and summary span both columns, entries go left and the composer right with `position: sticky; top: 12px`.
  - Assign the classes in `TodayScreen.tsx` and `DayLog.tsx`. Split `DayLog`'s totals and list into separately placeable children through a `layout="split"` prop, or by rendering `TotalsPanel` and `EntryList` from `TodayScreen`; choose the smaller diff, and `DayView` must stay unchanged visually.

  Make T032 pass
- [ ] T036 [US4] In `frontend/index.html`:
  - change the viewport meta tag to `width=device-width, initial-scale=1.0, interactive-widget=resizes-content`;
  - replace the single `theme-color` with two metas: `media="(prefers-color-scheme: light)" content="#1f6f50"` and `media="(prefers-color-scheme: dark)" content="#111312"`.

  In `frontend/src/features/add-food/Composer.tsx`, on focus of **What did you eat?** or **Note (optional)**, call `composerRef.current?.scrollIntoView({ block: 'nearest' })` (FR-016)
- [ ] T037 [US4] Fix the focus order and any remaining gaps until T033 and T034 pass. DOM order must be header → summary → entries → composer (card area, quick picks, method switch, input), as in [research R7](./research.md#r7-keyboard-fr-015)
- [ ] T038 [US4] Update the dark palette in `frontend/src/styles.css` (`@media (prefers-color-scheme: dark)`) to the tokens in `docs/design/composer/README.md`:
  - `--bg: #111312`, `--surface: #1a1d1b`, `--text: #ececea`, `--muted: #a8a8a3`, `--border: #333734`;
  - `--accent: #5cc493`, `--accent-text: #0d1f17`;
  - `--warn-bg: #3a3014`, `--warn-border: #d9b13a`;
  - add `--surface-raised: #2a2e2b`, `--border-subtle: #262927` and `--warn-text: #f2dd9a`, and use `--warn-text` for `.warning` text in dark mode.

  Add light-mode values for the new tokens (`--surface-raised: #efefeb`, `--border-subtle: #e5e5e0`, `--warn-text: inherit`). Light values otherwise stay unchanged (FR-017, R4)

**Checkpoint**: The layout works at 360 px and at 1280 px, with the keyboard, and in both colour schemes

---

## Phase 7: User Story 5 - Reach history, goal and account from Today (Priority: P3)

**Goal**: Compact header controls replace the remaining bottom buttons, and a pending card survives visiting them

**Independent Test**: quickstart Q14

### Tests for User Story 5 ⚠️

- [ ] T039 [P] [US5] Add failing tests to `frontend/tests/components/TodayScreen.test.tsx`:
  - the header holds buttons **Previous days**, **Goal settings** and **Account**, each calling `onNavigate` with `'history'`, `'goal'` and `'account'`;
  - each contains an `svg` with `aria-hidden="true"` and has no visible text;
  - no other navigation buttons remain below the entries.
- [ ] T040 [P] [US5] Add a failing test to `frontend/tests/components/App.test.tsx` (Q14): open a review card, edit its protein, click **Goal settings**, save a new goal and go back. Today shows the same card with the edit, and the progress bar uses the new goal (`aria-valuemax`)
- [ ] T041 [P] [US5] Update `frontend/tests/e2e/goal.spec.ts` to reach the goal through **Goal settings** in the header (and the kept **Set a protein goal** / **Change goal** buttons). Check that `frontend/tests/e2e/auth/first-sign-in.spec.ts`, `auth/password-change.spec.ts`, `auth/disable.spec.ts` and `auth/flows.ts` still find **Account** and **Previous days** by name and need no change; if they do, update them. Run and confirm the goal spec fails

### Implementation for User Story 5

- [ ] T042 [US5] In `frontend/src/features/today/TodayScreen.tsx`:
  - replace the bottom button row with a header holding the **Today** heading, the local date (`Intl.DateTimeFormat` with weekday, day and month), and three 44 × 44 icon buttons with `aria-label`s **Previous days**, **Goal settings** and **Account**;
  - the icons are inline stroke SVGs with `aria-hidden="true"` (calendar, target, person, as in `docs/design/composer/ComposerToday.dc.html`).

  Add `.icon-button` styles in `frontend/src/styles.css`. Make T039–T041 pass

**Checkpoint**: All five stories are complete

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Search `README.md`, `docs/` and the `frontend/src` comments for "Add food" as a screen name, and update them to describe logging from Today
- [ ] T044 [P] Run `npm run format` and `npm run lint` in `frontend/`, and fix anything they report. Delete any now-unused exports (for example `SubmitOrProgress` if it is unused) and unused CSS classes from the removed screen
- [ ] T045 Run the full check: `.\scripts\check.ps1`, or the npm equivalents from T001 plus the `auth-*` Playwright projects when PostgreSQL is available. Confirm `src/domain/**` coverage is 100 % line and branch. Report any project that couldn't run and why
- [ ] T046 Walk the manual checks in [quickstart.md](./quickstart.md#manual-checks-not-automated): phone keyboard on Android Chrome and the iOS Safari PWA, dark-mode contrast at 4.5:1, and the camera light off after leaving Today. Record the results in `specs/004-composer-main-screen/checklists/validation.md`, including anything that couldn't be checked

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. **Blocks all stories.**
- **US1 (Phase 3)**: after Foundational. The MVP.
- **US2 (Phase 4)**: after Foundational. Its quick picks render inside the composer, so T023 needs T015 (US1). T018–T022 can start in parallel with US1.
- **US3 (Phase 5)**: after US1, because it extends `Composer.tsx` and removes `AddFoodText`, whose tests US1 ported.
- **US4 (Phase 6)**: after US1. Best done after US2 and US3, so the touch-target walk (T034) and the layout cover the full composer.
- **US5 (Phase 7)**: after Foundational. T040 needs US1's review card. T042 can come before or after US4, but if done after it, it fits the grid header area directly.
- **Polish (Phase 8)**: after all chosen stories.

### Within each story

- Test tasks first, observed failing (Principle I), then implementation in the listed order.
- Tasks touching the same file run in sequence: `Composer.tsx` (T015 → T023 → T030 → T036), `TodayScreen.tsx` (T005 → T016 → T023 → T031 → T035 → T042), `styles.css` (T017 → T024 → T035 → T038 → T042).

## Parallel Opportunities

- **Phase 2**: T003 ∥ T004, then T005 ∥ T006.
- **US1 tests**: T007 ∥ T008 ∥ T009 ∥ T010 ∥ T011. Then T012 ∥ T014, before T013 → T015 → T016 → T017.
- **US2**: T018 ∥ T019 ∥ T020, then T021 → T022 → T023 → T024.
- **US3 tests**: T025 ∥ T026 ∥ T027 ∥ T028.
- **US4 tests**: T032 ∥ T033 ∥ T034.
- **US5 tests**: T039 ∥ T040 ∥ T041.
- **Polish**: T043 ∥ T044.

### Example: User Story 1 test batch

```text
T007 proteinSegments unit tests        → tests/unit/domain/nutrition/proteinSegments.test.ts
T008 pending protein component tests   → tests/components/ProteinProgress.test.tsx
T009 composer describe flow tests      → tests/components/Composer.test.tsx
T010 log-text e2e rewrite              → tests/e2e/log-text.spec.ts
T011 other describe-path e2e rewrites  → totals-persistence, auth/flows, auth/csp, auth-quota/quota
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 → Phase 2 → Phase 3.
2. **Stop and validate**: quickstart Q1–Q6. Describing and confirming works on Today, and the old Add food screen still works as a fallback, so this can ship on its own.

### Incremental delivery

1. US1: describe on Today (MVP).
2. US2: quick picks. Logging repeat foods takes 2 taps.
3. US3: Photo and Manual move in, and the Add food screen is deleted.
4. US4: desktop layout, keyboard and dark tokens.
5. US5: header navigation. The old button row is gone.

Each step leaves every test green and the app usable.
