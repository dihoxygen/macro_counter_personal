# Macro Counter Constitution

## Core Principles

### I. Test-First (NON-NEGOTIABLE)

All production code MUST be written test-first using the Red-Green-Refactor cycle:

- A failing test MUST exist and be observed failing before the implementing code is written.
- Code MUST be written only to make a failing test pass, then refactored with tests green.
- Bug fixes MUST start with a test that reproduces the bug.
- No change may be merged to `master` with failing or skipped tests.
- UI behavior MUST be covered by component or end-to-end tests at the level of user-visible
  outcomes (e.g. "logging a food updates the daily totals").

Rationale: TDD keeps a solo project's design honest and makes refactoring safe without a
second reviewer.

### II. Correct Nutrition Math

Macro and calorie calculations are the core of the product and MUST be trustworthy:

- All nutrition calculations (per-serving scaling, daily totals, goal progress, unit
  conversions) MUST live in pure functions with no UI, storage, or I/O dependencies.
- Quantities MUST carry explicit units (g, ml, serving); implicit unit assumptions are forbidden.
- Rounding MUST happen only at display time; stored and computed values keep full precision.
- Edge cases (zero quantities, missing nutrient values, very large servings) MUST have tests.
- Every nutrition function MUST have unit tests covering typical inputs, boundary values, and
  invalid inputs (negative, non-numeric, missing units).
- Calculations MUST be checked against known reference values (e.g. hand-verified totals for
  sample meals) in addition to property checks such as "totals equal the sum of entries".
- The nutrition-math module MUST maintain 100% line and branch coverage; a drop below this
  blocks merging.

Rationale: A macro counter that gives wrong totals is worse than no tool at all.

### III. Local-First, Sync-Ready Data

User data MUST be stored on the device, and the app MUST be fully usable offline with no account.

- All persistence MUST go through a single storage abstraction (repository interface); UI and
  domain code MUST NOT call browser storage APIs directly.
- Every record MUST have a stable unique ID (e.g. UUID) and `createdAt`/`updatedAt` timestamps
  so a future sync layer can reconcile changes.
- Stored data schemas MUST be versioned, and schema changes MUST include a tested migration.
- Users MUST be able to export their data in a portable format (JSON or CSV).

Rationale: Starting local keeps v1 simple, and these rules let cloud sync be added later
without rewriting the data layer.

### IV. Fast Logging on Desktop & Mobile

The app MUST be fully usable in both desktop and mobile browsers, and logging food (the most
frequent action) MUST stay quick on both:

- Logging a previously used food MUST take no more than 3 interactions from the main screen.
- The UI MUST be usable at mobile viewport widths (≥ 360px) as well as on desktop.
- Every feature MUST work on both desktop and mobile; no feature may be desktop-only or
  mobile-only.
- The UI MUST support both mouse/keyboard and touch input, with touch targets of at least
  44×44 CSS px.
- Today's totals versus goals MUST be visible without navigating away from the main screen.

Rationale: Food gets logged wherever you are, at a desk or on a phone. If logging is slow on
either one, it stops happening and the tool is no longer useful.

### V. Simplicity (YAGNI)

- Build only what a current spec requires; speculative features and abstractions are forbidden.
- New runtime dependencies MUST be justified in the feature plan (what it replaces, why it is
  needed).
- Prefer the platform (standard Web APIs) over frameworks or libraries when the result is
  comparably simple.
- Any complexity that violates this principle MUST be recorded in the plan's Complexity Tracking
  section.

Rationale: This is a personal tool maintained by one developer; every extra moving part costs
maintenance time.

### VI. AI-Assisted Food Lookup (Claude API)

The app uses the Claude API to look up foods and return their nutritional information. Because
AI output can be wrong, it is treated as a suggestion, never as trusted data:

- All Claude API calls MUST go through a single AI client module; UI and domain code MUST NOT
  call the API directly.
- Claude MUST be asked for structured output (JSON) with explicit units, and every response
  MUST be validated against a schema before use. Invalid responses MUST surface an error, never
  partial data.
- AI-provided values MUST pass two kinds of sanity checks, with limits and tolerances stated in
  the feature plan:
  - **Hard checks**: a response with negative values, non-finite numbers, or values outside the
    plan's allowed ranges MUST be rejected and never shown.
  - **Consistency checks**: values that fail a consistency check (e.g. calories not matching
    4/4/9 kcal per gram of protein/carbs/fat within the stated tolerance, or an implausibly
    large portion) MAY be shown, but only with a clear warning. The user MUST explicitly accept
    the warning or edit the values before the data can be confirmed.
- The user MUST review and confirm (or edit) AI-provided nutrition data before it is saved.
  Saved foods MUST record that the data came from AI.
- The Claude API key MUST NOT be committed to the repository or bundled into client code that
  is publicly served.
- AI lookup MUST NOT block core functionality: when it is offline, unconfigured, or failing, the
  user MUST still be able to enter nutrition data manually.
- Automated tests MUST mock the Claude API; the test suite MUST NOT make live API calls. Tests
  MUST cover malformed, incomplete, and implausible AI responses.
- The model ID MUST be configured in exactly one place.

Rationale: AI lookup removes most of the typing from logging new foods, but the numbers feed
directly into the totals that Principle II protects, so they must be validated and confirmed.
Consistency checks warn instead of reject because the 4/4/9 rule is inexact for high-fiber foods
and alcohol; rejecting would block legitimate entries.

## Technical Constraints

- **Platform**: Browser-based web application, installable as a PWA for phone use where practical.
- **Storage**: Client-side only (e.g. IndexedDB) behind the storage abstraction in Principle III.
  No user accounts and no server-side storage of user data in v1. A stateless server-side proxy
  for Claude API calls is permitted (see AI Integration).
- **Privacy**: Food logs and personal data MUST NOT be sent to third-party services. External
  lookups, including Claude API requests, MUST send only the food query (e.g. "1 cup cooked
  rice"), never log history, goals, or other personal data.
- **AI Integration**: Nutrition lookup uses the Anthropic Claude API. The API key is either held
  by a stateless proxy (e.g. a serverless function) or entered by the user at runtime and stored
  locally on the device. The feature plan chooses between these options.
- **Language**: A typed language (e.g. TypeScript) SHOULD be used so units and data shapes are
  checked at compile time.

## Development Workflow

- Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`.
- Each plan MUST include a Constitution Check that confirms compliance with every principle above.
- Tasks MUST order test tasks before their implementation tasks (Principle I).
- Work happens on feature branches. A branch is merged to `master` only when the full test suite
  passes and lint/type checks are clean.
- Commits SHOULD be small and focused, and their messages SHOULD describe the change.

## Governance

- This constitution supersedes other development practices for this project. When a practice
  conflicts with it, the constitution wins.
- Amendments are made with `/speckit-constitution`, must be recorded in the Sync Impact Report,
  and are committed alongside any template or plan updates they require.
- Versioning follows semantic versioning:
  - MAJOR: a principle is removed or redefined incompatibly.
  - MINOR: a principle or section is added or materially expanded.
  - PATCH: clarifications and wording fixes.
- Compliance is checked during `/speckit-plan` (Constitution Check) and `/speckit-analyze`.
  Unjustified violations block implementation.

**Version**: 1.2.0 | **Ratified**: 2026-10-07 | **Last Amended**: 2026-10-08
