# Implementation Plan: Composer Main Screen

**Branch**: `claude/eager-goldberg-glbayv` (feature `004-composer-main-screen`) | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-composer-main-screen/spec.md`

## Summary

Logging moves onto Today. A **composer** at the bottom of Today holds the Describe / Photo / Manual
switch, the existing inputs for each, and up to 5 recent foods as quick picks. Text and photo lookups
share **one** estimate flow owned by the composer, so at most one estimate is pending. Its review
appears as the existing `ReviewEstimate` card on Today, and the protein bar shows the card's protein as
a pending segment. The separate Add food screen and Today's row of four buttons go away. History, goal
and account move to icon buttons in Today's header.

To keep an unconfirmed card across visits to other screens (FR-006) without lifting state into `App`,
Today stays mounted and is hidden while another screen shows. It refreshes its data when it becomes
visible again and turns the live camera off while hidden. Layout is one CSS grid: one column with a
sticky composer below 960 px, and entries beside the composer from 960 px up. This is a frontend-only
change: no backend, API, schema or stored-data changes ([research](./research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) + React 19 frontend. Backend C# 14 / .NET 10, **unchanged**

**Primary Dependencies**: No new dependencies. CSS grid and media queries, `position: sticky`, the
`interactive-widget` viewport key, and the `hidden` attribute
([research R1](./research.md#r1-keeping-a-pending-card-across-screens-fr-006), [R3](./research.md#r3-one-responsive-layout-fr-013-fr-014-fr-016))

**Storage**: IndexedDB schema unchanged, no migration. The pending estimate and the composer drafts live
only in memory ([data-model](./data-model.md))

**Testing**: Vitest (unit: the new pure `proteinSegments` helper), React Testing Library with the
existing `createTestServices` fakes (component: composer, quick picks, Today, App navigation), and
Playwright at desktop 1280 px and mobile 360 px (e2e: the existing logging specs rewritten for the new
entry points, plus layout and keyboard specs). Claude stays mocked
([research R10](./research.md#r10-testing-strategy-principle-i))

**Target Platform**: Current Chrome, Edge, Firefox and Safari on desktop and phone, ≥ 360 px, as an
installable PWA

**Project Type**: Web application (React SPA + .NET API). Only `frontend/` changes

**Performance Goals**: No new network calls. Today must not refetch on every keystroke. Data reloads only
on confirm, on becoming visible, and on day rollover (already handled by `useCurrentDayKey`)

**Constraints**: Works offline except AI lookup (FR-018). No third-party fonts or resources, matching the
existing CSP (`font-src 'self'`) ([R5](./research.md#r5-typeface-fr-018)). Touch targets ≥ 44 px and
full keyboard operation (FR-015). The rule that nothing is logged without Confirm is unchanged (FR-003)

**Scale/Scope**: About 5 changed and 3 new frontend modules, about 10 e2e specs updated, and 1 Add food
view removed

No NEEDS CLARIFICATION remain. The spec's scope decisions (no typed corrections, system font, 5 quick
picks) are carried into research as decisions.

**Interaction counts** (Principle IV, SC-001, SC-002): describe = type → Estimate (or Enter) → Confirm =
3. Re-log at the saved amount = quick pick → Log = 2. With a changed amount = quick pick → edit amount →
Log = 3.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Test-First | Each behavior in the [UI contract](./contracts/today-ui.md) gets a failing component or e2e test first (quickstart Q1–Q14). Existing e2e specs that click **Add food** are rewritten to the new entry points *before* the button is removed, so they go red, then green | ✅ Planned. `/speckit-tasks` must order tests first |
| II. Correct Nutrition Math | The pending bar's percentages are a new pure function, `proteinSegments(loggedG, pendingG, goalG)`, in `src/domain/nutrition/proteinProgress.ts`. It has unit tests for typical values, zero, no goal, over-goal, negative and non-finite input, and hand-checked values (96 + 54 of 150 → 64 % + 36 %). The pending amount itself comes from the existing `reviewTotal`. Rounding stays in `format.ts`. `src/domain/**` stays at 100 % coverage | ✅ |
| III. Local-First, Sync-Ready | No schema or repository change. Confirm and re-log still go through `services.log.confirmEntries`. A pending card is never stored, as today's review step behaves. Confirming works offline because it is local | ✅ |
| IV. Fast Logging on Desktop & Mobile | This is the point of the feature. Logging takes 3 / 2 / 3 interactions (above). Totals stay visible without scrolling at 360 and 1280 px (FR-013). The same features are available at every width. Touch targets are checked by `touch-targets.spec.ts` on the new views | ✅ |
| V. Simplicity | No dependencies, no router, no global store. Today is kept mounted instead of lifting composer state (R1). The existing components are reused (`ReviewEstimate`, `ManualEntryForm`, the photo pieces, and `RelogForm` extracted from `RecentFoods`). The Add food screen is deleted, not kept alongside | ✅ |
| VI. AI-Assisted Food Lookup | Same AI client, schema, validator, warnings and confirmation. A photo is still sent only on an explicit Estimate. Estimates are still labelled "AI estimate". Manual entry stays available when AI is blocked (FR-010) | ✅ |
| VII. Security & Authentication | No endpoint, auth, session or data-sent change, so no threat model is required ([R11](./research.md#r11-security-review-principle-vii)). CSP unchanged, because no third-party font is loaded (R5). No new `innerHTML` or third-party content | ✅ |
| Tech Constraints: Privacy | What is sent to Claude is unchanged: the description, or the photo and note, for one lookup | ✅ |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. The design adds an in-memory composer
state ([data-model](./data-model.md)), one pure domain helper, and a UI contract of accessible names that
the tests use ([contracts/today-ui.md](./contracts/today-ui.md)). Nothing is persisted, and no server
surface or dependency is added.

## Project Structure

### Documentation (this feature)

```text
specs/004-composer-main-screen/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R11
├── data-model.md        # Phase 1: in-memory composer state, no stored-data change
├── quickstart.md        # Phase 1: validation scenarios Q1–Q14
├── contracts/
│   └── today-ui.md      # Phase 1: roles, accessible names and layout rules the tests rely on
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
frontend/
├── index.html                              # viewport interactive-widget; light/dark theme-color
├── src/
│   ├── App.tsx                             # Today always mounted, hidden when another view shows; 'add' view removed
│   ├── styles.css                          # Today grid, sticky composer, chips, card, dark tokens from the design
│   ├── domain/nutrition/proteinProgress.ts # + proteinSegments (pure, 100 % covered)
│   ├── features/
│   │   ├── today/
│   │   │   ├── TodayScreen.tsx             # header icon nav, grid layout, owns refresh and visibility
│   │   │   ├── DayLog.tsx                  # + refreshKey and pending props
│   │   │   ├── TotalsPanel.tsx             # passes pending protein through
│   │   │   └── ProteinProgress.tsx         # pending segment and "+N g pending"
│   │   ├── add-food/
│   │   │   ├── Composer.tsx                # NEW: method switch, single estimate flow, card area, quick picks
│   │   │   ├── DescribeInput.tsx           # from AddFoodText's input half; Enter sends
│   │   │   ├── PhotoInput.tsx              # from AddFoodPhoto's input half; camera off when inactive
│   │   │   ├── QuickPicks.tsx              # NEW: up to 5 recent foods + "More recent foods"
│   │   │   ├── useEstimateFlow.ts          # unchanged API; now one instance per composer
│   │   │   ├── ReviewEstimate.tsx          # unchanged behaviour; styling only
│   │   │   ├── ManualEntryForm.tsx         # unchanged behaviour; rendered in the composer
│   │   │   ├── AddFood.tsx                 # REMOVED
│   │   │   ├── AddFoodText.tsx             # REMOVED (split into DescribeInput + Composer)
│   │   │   └── AddFoodPhoto.tsx            # REMOVED (split into PhotoInput + Composer)
│   │   └── recent/
│   │       ├── RecentFoods.tsx             # full list screen, uses RelogForm
│   │       └── RelogForm.tsx               # NEW: extracted, shared with QuickPicks
└── tests/
    ├── unit/domain/nutrition/proteinSegments.test.ts # NEW
    ├── components/                         # Composer, QuickPicks, TodayScreen, App, ProteinProgress (new and updated);
    │                                       # AddFood/AddFoodText/AddFoodPhoto tests move to Composer tests
    └── e2e/                                # log-text, log-photo, camera, recent, goal, offline, totals-persistence,
                                            # touch-targets, auth/* rewritten for the new entry points;
                                            # NEW layout.spec.ts (both widths) and keyboard.spec.ts (desktop)
```

**Structure Decision**: Keep the existing `frontend/src/features/*` layout. The composer lives in
`features/add-food/`, next to the pieces it reuses, so the diff stays a refactor of that folder rather
than a move. The backend is untouched.

## Complexity Tracking

No violations to justify.
