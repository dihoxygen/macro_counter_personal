# Research: Composer Main Screen

Decisions for [plan.md](./plan.md). Each one records what was chosen, why, and what else was
considered. No NEEDS CLARIFICATION remain.

## R1. Keeping a pending card across screens (FR-006)

**Decision**: `App` always renders `TodayScreen` and gives it the `hidden` attribute while another view
(Previous days, Protein goal, Recent, Account) shows. Today gets an `active` prop. When `active` turns
true it bumps a `refreshKey` so `DayLog` reloads entries and goals, which may have changed on the goal or
recent screens. When `active` turns false the composer closes the live camera, keeping feature 002's
rule that the camera is never on out of sight. Drafts, the photo selection and any pending card survive
because the components stay mounted.

**Rationale**: State already lives in `useEstimateFlow`, `usePhotoSelection`, `ManualEntryForm` and
`ReviewEstimate` (its edited `ReviewState`). Keeping them mounted preserves all of it with a few lines in
`App`. `hidden` removes Today from layout, the accessibility tree and tab order, so a hidden screen can't
be reached by mistake. The app's `.stack` and `.row` classes set `display`, which overrides the browser's
built-in `hidden` style, so `styles.css` needs a global `[hidden] { display: none !important; }` rule.

**Alternatives considered**:
- *Lift the flow, drafts and review state into `App` or a context*: this touches every input component
  and moves `ReviewEstimate`'s internal edit state out. Much more code for the same result (Principle V).
- *Store the pending card in IndexedDB*: it would survive a reload, but the spec keeps pending cards
  in memory only, like today, and storing unconfirmed AI data adds a schema migration for no stated
  need.
- *Overlay other screens on Today with CSS*: Today would stay in the tab order and the accessibility
  tree, and tests could match the wrong screen.

## R2. One composer, one estimate flow (FR-001, FR-002, FR-005, FR-009, FR-011)

**Decision**: A new `Composer` owns a single `useEstimateFlow` and the current method
(`describe | photo | manual`). It renders all three inputs and shows only the selected one (the others
get `hidden`), so each method's draft survives switching (FR-011).
- `DescribeInput` and `PhotoInput` are the input halves of today's `AddFoodText` and `AddFoodPhoto`.
  They receive `flow.run` and the loading flag instead of each owning a flow.
- While the phase is `loading` or `review`, the method switch, quick picks and send controls are
  disabled, so a second lookup can't start (FR-005).
- The phases (`loading`, `review`, `unrecognized`, `error`) render in a **card area** directly above
  the inputs. The review is the unchanged `ReviewEstimate`.
- On confirm the flow resets, the description and photo drafts clear, and Today is told to refresh.
  Discard keeps the drafts so the user can retry or adjust.

**Rationale**: One flow instance makes "one pending at a time" structural instead of a rule that has to
be checked. Splitting input from review is what moves the review onto Today. The recovery actions that
exist today (Retry, Describe in text, Enter manually) carry over to the card area unchanged (FR-019).

**Alternatives considered**: Keeping one flow per method, as today, needs extra cross-method
coordination to block a second lookup, and two review cards could exist.

## R3. One responsive layout (FR-013, FR-014, FR-016)

**Decision**:
- Today's root is a CSS grid with areas `header`, `summary`, `entries` and `composer`.
- Below 960 px it is a single column. The composer is `position: sticky; bottom: 0` with a surface
  background, so it stays at the bottom of the viewport while entries scroll above it.
- From 960 px up the grid is `minmax(0, 1fr) minmax(360px, 420px)`. Header and summary span both
  columns, entries sit on the left, and the composer is in the right column (sticky to the top, with no
  max height, so the card can scroll with the page).
- `.app` widens from 720 px to 1120 px at that breakpoint.
- The viewport meta tag gets `interactive-widget=resizes-content`, so Chromium browsers shrink the
  layout viewport for the on-screen keyboard and the sticky composer sits above it.
- When the description or note field gets focus, the composer calls
  `scrollIntoView({ block: 'nearest' })` on itself. This covers Safari, which ignores the key.

**Rationale**: This is plain CSS with one breakpoint, needs no JavaScript layout code, and keeps the DOM
the same at every width, so one set of tests covers both. `position: sticky` stays in normal flow, so it
doesn't hide the last entry the way `position: fixed` would. 960 px is the narrowest width at which a
420 px composer and a readable entry list fit side by side with 16 px gutters.

**Alternatives considered**:
- *`position: fixed` bottom bar*: overlaps content, needs bottom padding equal to its variable height,
  and fights the iOS keyboard more.
- *The `VirtualKeyboard` API*: Chromium-only and opt-in. The meta key does the same with no code.
- *Separate desktop and mobile components*: doubles the UI and the tests (Principle V).

## R4. Theme (FR-017)

**Decision**: Keep the existing token approach in `styles.css`: `:root` holds the light palette, and the
`prefers-color-scheme: dark` block holds the dark one. The dark values change to the Composer tokens in
`docs/design/composer/README.md` (background `#111312`, surface `#1a1d1b`, raised `#2a2e2b`, borders
`#262927` and `#333734`, text `#ececea`, muted `#a8a8a3`, accent `#5cc493` with `#0d1f17` text, and the
warning colours). New tokens: `--surface-raised`, `--border-strong` and `--warn-text`. Light values stay
as they are. `index.html` gets two `theme-color` metas, one per `media` scheme.

**Rationale**: The design's dark palette is already almost master's dark palette, so this is a token
edit, not a theming system. Following the device setting matches the current app.

**Alternatives considered**: An in-app theme toggle. Not asked for (Principle V).

## R5. Typeface (FR-018)

**Decision**: Keep the system font stack. Use `font-variant-numeric: tabular-nums` for figures and
weight 700 at 40 px for the protein figure, as in the design.

**Rationale**: The CSP sets `font-src 'self'`, and the app must work offline. Loading DM Sans from
Google Fonts would break both. Self-hosting it adds a font file, a licence and a cache entry for a small
visual difference. That can be decided later.

**Alternatives considered**: Self-hosting DM Sans as a `woff2` under `public/` (allowed by the CSP).
Deferred, not rejected.

## R6. Quick picks (FR-007, FR-008)

**Decision**: `QuickPicks` reads `services.savedFoods.listRecent()`, shows the first 5 as buttons in a
horizontally scrollable row (`overflow-x: auto`, no wrapping, each ≥ 44 px high), and ends with a
**More recent foods** button that opens the existing Recent screen. Tapping a food opens `RelogForm`
(extracted unchanged from `RecentFoods.tsx`) in the card area, with the amount pre-filled. **Log**
confirms it, and **Back to list** becomes **Cancel**. With no saved foods, the row isn't rendered. The
list reloads after every confirm so a newly saved food appears.

**Rationale**: It reuses the tested re-log behaviour and scaling (`scaleMacros`). Two interactions at
the saved amount meets SC-002.

**Alternatives considered**: A one-tap log that skips the amount step. Faster, but it would log a
repeated food with no chance to check the amount. The constitution allows 3 interactions and the spec
requires the amount to be pre-filled and editable.

## R7. Keyboard (FR-015)

**Decision**: In the description field, Enter with no modifier submits and Shift+Enter adds a new line.
Enter is ignored while an IME composition is in progress (`event.nativeEvent.isComposing`). The field
gets `enterKeyHint="send"`. DOM order is header → summary → entries → composer (card area, then method
switch, then input), which gives a sensible tab order at both widths. When a card appears, focus moves
to its heading so keyboard and screen-reader users land on it. When it closes, focus returns to the
description field.

**Rationale**: This matches chat inputs, which the design is modelled on. Moving focus is what makes an
inline card discoverable without a screen change.

## R8. Header navigation (FR-012, User Story 5)

**Decision**: Today's header has the title, the date, and three icon buttons with `aria-label`s
**Previous days**, **Goal settings** and **Account** (not "Protein goal", which already names the progress region), each 44 × 44 px with an inline SVG icon
(`aria-hidden`). The existing **Set a protein goal** and **Change goal** buttons in the totals stay. The
`add` view, the `titles.add` entry and the bottom button row are removed from `App` and `TodayScreen`.

**Rationale**: The other screens are reached less often. Icons keep the header compact at 360 px, and
`aria-label`s keep them testable and accessible.

## R9. Pending protein (FR-004)

**Decision**: When the card area holds a review, `Composer` reports
`pendingProteinG = reviewTotal(state).proteinG` up to `TodayScreen`. Edits inside `ReviewEstimate` are
reported through a new optional `onChange(state)` prop. `ProteinProgress` takes `pendingG` and:
- shows a second, striped bar segment;
- shows the text "+N g pending" (formatted by `formatGrams`);
- keeps `aria-valuenow` at the logged amount only.

Segment widths come from a new pure function:

```text
proteinSegments(loggedG, pendingG, goalG) → { loggedPct, pendingPct }
  loggedPct  = min(loggedG / goalG, 1) × 100
  pendingPct = min((loggedG + pendingG) / goalG, 1) × 100 − loggedPct
```

It throws on negative or non-finite input and returns 0 / 0 when the goal is missing. With no goal,
only the "+N g pending" text shows.

**Rationale**: The arithmetic belongs in `src/domain/nutrition` with full coverage (Principle II). The
UI only formats the result.

## R10. Testing strategy (Principle I)

**Decision**:
- **Unit**: `proteinSegments` (typical, zero, no goal, over goal, invalid input, and the reference value
  96 + 54 of 150 → 64 / 36).
- **Component** (RTL with `createTestServices`): Composer (describe → card → confirm → totals refresh;
  discard; blocked second lookup; method switch keeps drafts; AI unavailable → Manual; Enter and
  Shift+Enter; errors with Retry and Manual), QuickPicks (empty, ≤ 5, More, re-log in 2 interactions),
  TodayScreen (header nav, pending text), App (pending card survives a visit to Protein goal; camera is
  stopped while hidden). The existing AddFood, AddFoodText and AddFoodPhoto tests are ported to the
  composer; their assertions about review behaviour stay.
- **E2E** (Playwright, desktop and mobile projects): rewrite `log-text`, `log-photo`, `camera`, `recent`,
  `goal`, `offline`, `totals-persistence`, `touch-targets` and the auth helpers in `auth/flows.ts` to use
  the composer instead of **Add food**.
  - New `layout.spec.ts`: at 1280 px the composer's box is right of the entries list; at 360 px it is
    below; at both, the Totals region is in the viewport with no scrolling.
  - New `keyboard.spec.ts` (desktop): describe → Enter → Tab to Confirm → Enter, with no mouse.

**Rationale**: Tests drive each user-visible outcome in the spec. E2E specs are rewritten before the old
screen is removed, so they fail first (red) and pass once the composer exists (green).

## R11. Security review (Principle VII)

**Decision**: No threat model is needed. The feature changes no endpoint, authentication,
authorization, session, stored data or external call. What is sent to Claude, and when, is unchanged.
No third-party resource is added, so the CSP is unchanged. No new raw-HTML rendering is introduced.
Food names stay text nodes. The existing `csp.spec.ts` keeps guarding the policy.
