---
description: "Task list for AI Macro Logging"
---

# Tasks: AI Macro Logging

**Input**: Design documents from `/specs/001-ai-macro-logging/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE) applies to every task.
Each test task MUST be written and run, and seen to **fail**, before its implementation task
starts. Claude is always mocked, and no test may call `api.anthropic.com` (Principle VI).

**Organization**: Tasks are grouped by user story so each story can be built and tested as its own
increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story the task belongs to (US1–US5, from spec.md)

## Path Conventions

- Backend: `backend/MacroCounter.Api/`, tests in `backend/MacroCounter.Api.Tests/`
- Frontend: `frontend/src/`, tests in `frontend/tests/{unit,components,e2e}/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchains, project scaffolding, and test and coverage infrastructure

- [X] T001 Verify the .NET 10 SDK is installed (`dotnet --list-sdks` shows 10.x). If it is not, stop and ask the user to install it from https://dotnet.microsoft.com/download/dotnet/10.0. Verify Node 24.x (`node --version`)
- [X] T002 Create the backend solution: `backend/MacroCounter.sln`, web project `backend/MacroCounter.Api/MacroCounter.Api.csproj` (`dotnet new web`, `net10.0`, nullable enabled, warnings as errors), and xUnit project `backend/MacroCounter.Api.Tests/MacroCounter.Api.Tests.csproj` referencing the Api project
- [X] T003 Add backend NuGet packages: `Anthropic` to the Api project; `Microsoft.AspNetCore.Mvc.Testing` and `coverlet.msbuild` to the test project. In `backend/MacroCounter.Api.Tests/MacroCounter.Api.Tests.csproj`, set the coverlet properties `Threshold=100`, `ThresholdType=line,branch` and `Include=[MacroCounter.Api]MacroCounter.Api.Nutrition.*` so a coverage drop in `Nutrition/` fails the build (Principle II)
- [X] T004 [P] Scaffold the frontend with Vite's `react-ts` template in `frontend/` (React 19, TypeScript). Set `"strict": true` and `"noUncheckedIndexedAccess": true` in `frontend/tsconfig.json`
- [X] T005 [P] Add frontend dependencies in `frontend/package.json`: runtime `idb`, `zod`; dev `vite-plugin-pwa`, `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `fake-indexeddb`, `@playwright/test`, `eslint`, `prettier`. Add scripts `dev`, `build`, `test`, `e2e`, `lint`, `typecheck`
- [X] T006 Configure `frontend/vite.config.ts`:
  - Dev server proxies `/api` to `http://localhost:5080`.
  - `build.outDir` is `../backend/MacroCounter.Api/wwwroot` with `emptyOutDir: true`.
  - Vitest uses `environment: 'jsdom'` and a setup file `frontend/tests/setup.ts` that imports `fake-indexeddb/auto` and `@testing-library/jest-dom`.
  - Coverage thresholds are 100% lines/branches/functions/statements for `src/domain/**` (nutrition, days, goals, review).
- [X] T007 [P] Create `frontend/playwright.config.ts`:
  - Two projects: `desktop` (1280×800) and `mobile` (360×740, `hasTouch: true`, `isMobile: true`).
  - `webServer` runs `npm run dev`; `baseURL` is `http://localhost:5173`.
  - Tests mock `/api/**` with `page.route()` and never reach the real backend.
- [X] T008 [P] Configure `backend/MacroCounter.Api/appsettings.json` with `"Anthropic": { "Model": "claude-opus-5-5", "Effort": "medium" }` and **no** `ApiKey`. Set the HTTP port to 5080 in `backend/MacroCounter.Api/Properties/launchSettings.json`. Run `dotnet user-secrets init --project backend/MacroCounter.Api` so the csproj gets a `UserSecretsId`
- [X] T009 [P] Add to the root `.gitignore`: `bin/`, `obj/`, `backend/MacroCounter.Api/wwwroot/`, `frontend/node_modules/`, `frontend/coverage/`, `frontend/test-results/`, `frontend/playwright-report/`, `coverage.*.xml`, `*.user`
- [X] T010 [P] Add `.editorconfig` at the repo root (C# and TS conventions, LF in source files). Add `frontend/eslint.config.js` (typescript-eslint + react-hooks) and `frontend/.prettierrc`

**Checkpoint**: `dotnet build backend`, `dotnet test backend` (empty), `npm test` and `npx playwright test --list` all run without errors.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared domain types, nutrition math, local storage, and the backend skeleton that every
story needs

**⚠️ CRITICAL**: No user story work starts until this phase is complete

### Frontend domain and storage

- [X] T011 [P] Write failing tests in `frontend/tests/unit/domain/types.test.ts` for the zod schemas:
  - `Unit` accepts only `'g' | 'ml' | 'serving'`.
  - `Quantity` `amount` is "finite and ≥ 0".
  - `Macros` fields `kcal`, `proteinG`, `carbsG`, `fatG` are "All finite and ≥ 0".
  - `Source` is `'ai' | 'ai-edited' | 'manual'`.
  - `DayKey` matches `YYYY-MM-DD`.
  - Cover rejection of `NaN`, `Infinity`, negative values, and missing fields.
- [X] T012 Implement the zod schemas and inferred TS types (`Unit`, `Quantity`, `Macros`, `Source`, `DayKey`) in `frontend/src/domain/types.ts` so T011 passes
- [X] T013 [P] Write failing tests in `frontend/tests/unit/domain/nutrition/totals.test.ts` for `sumMacros(list: Macros[]): Macros`:
  - An empty list returns all zeros.
  - Hand-verified reference meal: egg `{kcal:78, proteinG:6.3, carbsG:0.6, fatG:5.3}` + toast `{kcal:69, proteinG:3.6, carbsG:12, fatG:0.9}` + butter `{kcal:36, proteinG:0.04, carbsG:0, fatG:4.1}` sums to `{kcal:183, proteinG:9.94, carbsG:12.6, fatG:10.3}`; compare with `toBeCloseTo(…, 10)`.
  - Property: the total equals the field-wise sum for random lists.
  - No rounding is applied.
  - An item with a negative, `NaN` or `Infinity` field throws `RangeError`.
  - Very large values (e.g. 30 items of 5000 kcal) sum exactly.
- [X] T014 Implement `sumMacros` in `frontend/src/domain/nutrition/totals.ts` (pure, no I/O)
- [X] T015 [P] Write failing tests in `frontend/tests/unit/domain/nutrition/scale.test.ts` for `scaleMacros(macros, from: Quantity, to: Quantity): Macros`:
  - The factor is `to.amount / from.amount` (e.g. 170 g → 85 g halves every field).
  - A unit mismatch throws.
  - `from.amount === 0` throws ("a reference amount of 0 cannot be scaled").
  - `to.amount === 0` returns zeros.
  - Full precision is kept.
  - A negative, `NaN` or `Infinity` amount in `from` or `to` throws `RangeError`, and so do negative input macros.
  - A very large target (e.g. 100 g → 20 000 g) scales exactly.
- [X] T016 Implement `scaleMacros` in `frontend/src/domain/nutrition/scale.ts`
- [X] T017 [P] Write failing tests in `frontend/tests/unit/domain/nutrition/format.test.ts` and `frontend/tests/unit/domain/nutrition/plausibility.test.ts`:
  - `formatKcal` rounds to an integer; `formatGrams` rounds to 1 decimal, drops a trailing `.0`, and appends ` g` (90 → "90 g", 9.94 → "9.9 g").
  - Cover 0, .05 boundaries (e.g. 9.95 → "10 g"), and large values (99999.94).
  - Formatters are the only place rounding happens.
  - `isImplausiblyLarge(quantity, macros)` is true when a `g`/`ml` amount is > 2000, `kcal` > 5000, or any macro > 1000 g (research R5 limits). Test exactly at each limit (false) and just above it (true).
- [X] T018 Implement `formatKcal` and `formatGrams` in `frontend/src/domain/nutrition/format.ts`, and `isImplausiblyLarge` in `frontend/src/domain/nutrition/plausibility.ts`
- [X] T019 [P] Write failing tests in `frontend/tests/unit/domain/days.test.ts` for `toDayKey(date: Date): DayKey`:
  - Uses the **local** calendar date with zero padding.
  - 23:59:59.999 and 00:00:00.000 local fall on different days.
  - The result is stable across a DST transition date.
- [X] T020 Implement `toDayKey` in `frontend/src/domain/days.ts`
- [X] T021 [P] Write failing tests in `frontend/tests/unit/data/db.test.ts` (fake-indexeddb):
  - `openDb()` creates database `macro-counter`.
  - It creates the stores `entries` (index `dayKey`), `savedFoods` (index `lastUsedAt`), `proteinGoals` (unique index `effectiveFrom`) and `meta`.
  - It writes `meta.schemaVersion = 1`.
  - The migration runner applies pending migrations in version order exactly once, and fails loudly on a version gap.
- [X] T022 Implement `openDb` and the migration runner in `frontend/src/data/db.ts` and `frontend/src/data/migrations.ts` using `idb`
- [X] T023 [P] Write failing tests in `frontend/tests/unit/data/entryRepository.test.ts`:
  - `create` assigns a UUID v4 `id`, ISO UTC `createdAt`/`updatedAt` and `schemaVersion`.
  - It validates that `name` is 1–120 characters and that `macros` satisfy the `Macros` rules, rejecting invalid values instead of clamping them.
  - `listByDay(dayKey)` returns entries ordered by `loggedAt` ascending.
  - `update` never changes `dayKey` and bumps `updatedAt`.
  - `delete` removes the entry.
- [X] T024 Define the `EntryRepository` interface in `frontend/src/data/repositories.ts`. Implement the IndexedDB version in `frontend/src/data/entryRepository.ts`. The `LogEntry` fields follow data-model.md: `id, dayKey, loggedAt, name, quantity, macros, source, savedFoodId (UUID | null), createdAt, updatedAt, schemaVersion`

### Backend skeleton and AI validation

- [X] T025 [P] Create the response/request records in `backend/MacroCounter.Api/Contracts/EstimateContracts.cs`, matching `contracts/estimates-api.yaml`:
  - Records: `Quantity(double Amount, Unit Unit)`, `Macros(double Kcal, double ProteinG, double CarbsG, double FatG)`, `EstimateItem`, `Estimate(bool Recognized, IReadOnlyList<EstimateItem> Items, Macros Total, IReadOnlyList<Flag> Flags)`, `TextEstimateRequest(string Description)`.
  - JSON is camelCase.
  - `Unit` and `Flag` serialize as `g|ml|serving` and `calorie_macro_mismatch|large_portion`.
- [X] T026 [P] Write failing tests in `backend/MacroCounter.Api.Tests/Nutrition/MacroMathTests.cs`:
  - `CaloriesFromMacros(p,c,f)` = 4p + 4c + 9f, checked against reference values.
  - `Sum(items)` returns the field-wise sum.
  - `IsCalorieMismatch(kcal,p,c,f)` uses the tolerance `max(20 kcal, 15% of 4P+4C+9F)`:
    - It is not flagged exactly at the threshold.
    - It is flagged just above the threshold in both directions.
    - The all-zero case is not flagged.
  - All three methods throw `ArgumentOutOfRangeException` for negative, `NaN` or `Infinity` arguments.
  - Large values (1000 g of each macro) compute exactly.
- [X] T027 Implement `MacroMath` in `backend/MacroCounter.Api/Nutrition/MacroMath.cs` (static, pure)
- [X] T028 Write failing tests in `backend/MacroCounter.Api.Tests/Nutrition/EstimateValidatorTests.cs`. The input is the raw AI DTO shaped like `contracts/ai-estimate.schema.json`.
  - Valid cases:
    - `recognized:false` with empty items gives `Recognized=false`, empty items, zero total.
    - The total is **recomputed** from the items.
    - `Flags` is the distinct union of the item flags.
  - Rejected (result `Invalid`):
    - `recognized:true` with empty items, or `recognized:false` with items.
    - An empty name.
    - Any negative, NaN or Infinity number.
    - `kcal > 5000` for an item, or any macro `> 1000` g.
  - Flagged:
    - A 4/4/9 mismatch adds `calorie_macro_mismatch`.
    - A unit of `g`/`ml` with an amount `> 2000` adds `large_portion`.
- [X] T029 Implement `backend/MacroCounter.Api/Ai/AiEstimateDto.cs` (the raw DTO with snake_case JSON names from `ai-estimate.schema.json`) and `backend/MacroCounter.Api/Nutrition/EstimateValidator.cs` returning `ValidationResult` (`Valid(Estimate)` | `Invalid(reason)`)
- [X] T030 [P] Write failing integration tests in `backend/MacroCounter.Api.Tests/Endpoints/StatusEndpointTests.cs` using `WebApplicationFactory<Program>`. `GET /api/status` returns `{ "aiAvailable": false }` when `Anthropic:ApiKey` is empty or missing and `true` when it is set (set it via in-memory config, never a real key)
- [X] T031 Implement the backend skeleton so T030 passes:
  - `backend/MacroCounter.Api/Ai/AnthropicOptions.cs` (`ApiKey`, `Model`, `Effort`, bound from `Anthropic`).
  - `backend/MacroCounter.Api/Ai/IEstimator.cs` (`EstimateFromTextAsync(string, CancellationToken)` and `EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken)`, both returning `AiEstimateDto`).
  - Typed exceptions in `backend/MacroCounter.Api/Ai/AiExceptions.cs` (`AiUnavailableException`, `AiTimeoutException`, `InvalidAiResponseException`).
  - In `backend/MacroCounter.Api/Program.cs`:
    - `GET /api/status`.
    - RFC 9457 ProblemDetails with a `code` extension.
    - `UseDefaultFiles` + `UseStaticFiles` + `MapFallbackToFile("index.html")`.
    - `public partial class Program {}` for tests.
- [X] T031a [P] Write failing tests for the app shell:
  - `frontend/tests/unit/api/status.test.ts`: `getStatus()` returns `{aiAvailable}` from `GET /api/status`, and returns `false` on a network error, a non-2xx response or a malformed body.
  - `frontend/tests/components/App.test.tsx`: the app renders the `today` view by default and switches views through state.
  - The 44 px touch-target rule is verified later by T093.
- [X] T032 Create the frontend app shell so T031a passes:
  - `frontend/src/App.tsx` with simple state-based view switching (`today | add | recent | history | goal`, no router library, Principle V).
  - `frontend/src/styles.css` with a mobile-first responsive layout that works from 360px and a CSS variable for touch targets of at least 44×44 px applied to all buttons and inputs.
  - `frontend/src/api/status.ts` (`getStatus()` → `{aiAvailable}`, returning `false` on network error).

**Checkpoint**: All Phase 2 tests pass, coverage thresholds pass, and the app shell renders on both Playwright viewports.

---

## Phase 3: User Story 1 - Log a food by text description (Priority: P1) 🎯 MVP

**Goal**: Describe food in text, get a validated AI estimate, review or edit it, confirm, and see the
entry and today's totals update. Manual entry works when AI is unavailable.

**Independent Test**: Enter "1 medium banana", confirm, and check that the entry appears and today's
totals increase by exactly the confirmed values (quickstart V1–V5, V11, V14).

### Tests for User Story 1 ⚠️ write first, verify they fail

- [X] T033 [P] [US1] Write failing tests in `backend/MacroCounter.Api.Tests/Ai/ClaudeEstimatorTests.cs` (text path). Fake the SDK through its client interface, or a thin `IClaudeMessageSender` seam if the SDK client can't be mocked. Assert that:
  - The request uses `Model` and `Effort` from `AnthropicOptions`.
  - It sets structured output to the JSON schema in `ai-estimate.schema.json`.
  - It sends the system prompt from `EstimatePrompt`.
  - The user content is **only** the description.
  - The structured JSON maps to `AiEstimateDto`.
  - Errors map as follows: `stop_reason == "refusal"` → `InvalidAiResponseException`; SDK timeout → `AiTimeoutException`; connection or 5xx errors → `AiUnavailableException`; a cancelled token → `OperationCanceledException`.
  - The text request uses a 25 s timeout.
- [X] T034 [P] [US1] Write failing tests in `backend/MacroCounter.Api.Tests/Endpoints/TextEstimateEndpointTests.cs`, with `IEstimator` mocked. `POST /api/estimates/text`:
  - Returns 200 with the `Estimate` shape (camelCase, recomputed `total`).
  - Returns 400 `invalid_request` for a missing, whitespace-only or >500-character `description`.
  - Returns 502 `invalid_ai_response` when the validator rejects.
  - Returns 503 `ai_unavailable` when there is no key or the estimator throws `AiUnavailableException`.
  - Returns 504 `ai_timeout`.
  - An aborted request cancels the token passed to `IEstimator`.
- [X] T035 [P] [US1] Write failing tests in `frontend/tests/unit/api/estimates.test.ts` for `estimateFromText(description, signal)`:
  - It POSTs `{description}` only.
  - It parses the response with a zod `Estimate` schema mirroring `estimates-api.yaml`.
  - It maps the problem `code` to a typed `EstimateError` (`invalid_request | image_too_large | unsupported_media_type | invalid_ai_response | ai_unavailable | ai_timeout | network`), matching every code in `estimates-api.yaml`.
  - A malformed 200 body becomes `invalid_ai_response`.
  - Aborting `signal` rejects with `AbortError`.
- [X] T036 [P] [US1] Write failing tests in `frontend/tests/unit/domain/review.test.ts` for the pure review-state functions:
  - `startReview(estimate)` starts the review from an estimate.
  - `editItem(state, index, patch)` marks the item edited.
  - `reviewTotal(state)` = `sumMacros` of the current items.
  - `toEntries(state, now: Date)` creates one entry per item, with source `'ai'` if unedited and `'ai-edited'` if edited, `dayKey = toDayKey(now)` and `loggedAt = now.toISOString()`.
  - Validation rejects negative or non-finite edits.
- [X] T037 [P] [US1] Write failing component tests in `frontend/tests/components/AddFoodText.test.tsx`:
  - Submitting text shows a progress indicator with a **Cancel** button (FR-016), and Cancel aborts with nothing saved.
  - The review shows each item's name, `portionDescription`, kcal/protein/carbs/fat with units via the formatters, and an "AI estimate" label; multi-item input shows per-item rows plus a combined total (FR-004).
  - A `calorie_macro_mismatch` or `large_portion` flag shows a warning naming the item. Confirm stays disabled until the user explicitly accepts the warning ("Yes, these values are right"). Editing the item to clear the problem also enables Confirm.
  - Editing protein and confirming saves the edited value.
  - Discard saves nothing.
  - `recognized:false` shows "Couldn't identify food" with Retry and Enter manually actions.
  - Each `EstimateError` shows a clear message plus a manual-entry option.
- [X] T038 [P] [US1] Write failing component tests in `frontend/tests/components/ManualEntryForm.test.tsx`:
  - Name (1–120 characters), quantity amount and unit (`g|ml|serving`), and kcal/protein/carbs/fat are all required, finite and ≥ 0.
  - Invalid input shows inline errors.
  - Values where `isImplausiblyLarge` is true show a confirmation step before saving; cancelling it saves nothing.
  - Save creates an entry with `source: 'manual'`.
  - The form is offered directly when `aiAvailable` is false (FR-008).
- [X] T039 [P] [US1] Write failing component tests in `frontend/tests/components/TodayScreen.test.tsx` (EntryRepository seeded through fake-indexeddb):
  - Shows today's kcal/protein/carbs/fat totals (formatted) and the entry list ordered by `loggedAt`.
  - The totals update right after a confirm.
  - Shows only entries whose `dayKey` is today.
- [X] T040 [US1] Write a failing Playwright spec `frontend/tests/e2e/log-text.spec.ts` (both projects, `/api/**` mocked). It covers quickstart V1, V2, V3, V4, V5, V14, and V11 (status `aiAvailable:false` → manual entry still logs and totals update)

### Implementation for User Story 1

- [X] T041 [US1] Create `backend/MacroCounter.Api/Ai/ai-estimate.schema.json`, a copy of `contracts/ai-estimate.schema.json` embedded as a resource. Create `backend/MacroCounter.Api/Ai/EstimatePrompt.cs`, which exposes the stable system prompt (research R4 rules) and loads the schema. The system prompt says to:
  - Estimate each item separately.
  - State the assumed portion in g or ml in `portion_description`.
  - Use standard USDA-style reference values.
  - Return `recognized:false` with no items when no food is present instead of guessing.
  - Output nothing outside the schema.
- [X] T042 [US1] Implement `EstimateFromTextAsync` in `backend/MacroCounter.Api/Ai/ClaudeEstimator.cs`, the only class that references the Anthropic SDK, so T033 passes. **Before writing SDK code, read the C# SDK reference (claude-api skill `csharp/claude-api/README.md`) and do not guess type names.** The call must:
  - Use the configured model and effort, with adaptive thinking (the default, omit `Thinking`).
  - Set structured output to the schema via `OutputConfig.Format`.
  - Enable the server-side refusal fallback (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`).
  - Use a 25 s timeout for text (40 s for photos, T067), within SC-001/SC-002, and pass the `CancellationToken`.
  - Check `StopReason` before reading content.
  - Register it in DI only when `Anthropic:ApiKey` is non-empty. Otherwise register an `UnavailableEstimator` that throws `AiUnavailableException`.
- [X] T043 [US1] Implement `POST /api/estimates/text` in `backend/MacroCounter.Api/Endpoints/EstimateEndpoints.cs` (mapped from `Program.cs`) so T034 passes. The flow is: validate the request → `IEstimator` with `HttpContext.RequestAborted` → `EstimateValidator` → 200 `Estimate`, or ProblemDetails with the matching `code`
- [X] T044 [US1] Implement `estimateFromText` and the `EstimateError` type in `frontend/src/api/estimates.ts` (the only frontend `/api/estimates` caller) so T035 passes
- [X] T045 [US1] Implement the review-state functions in `frontend/src/domain/review.ts` so T036 passes
- [X] T046 [US1] Implement `frontend/src/features/add-food/AddFoodText.tsx` and `frontend/src/features/add-food/ReviewEstimate.tsx`. Confirm writes `toEntries(...)` through `EntryRepository` and returns to Today. T037 must pass
- [X] T047 [US1] Implement `frontend/src/features/add-food/ManualEntryForm.tsx` so T038 passes, and hook it into AddFood from the error, unrecognized and AI-unavailable states
- [X] T048 [US1] Implement `frontend/src/features/today/TotalsPanel.tsx`, `frontend/src/features/today/EntryList.tsx` and `frontend/src/features/today/TodayScreen.tsx` (totals, entries, "Add food" button) so T039 passes. Wire the views into `frontend/src/App.tsx` and make T040 pass

**Checkpoint**: US1 works on its own. It is the MVP: text logging, review/confirm, manual fallback, and today's totals.

---

## Phase 4: User Story 2 - See running macro totals (Priority: P1)

**Goal**: Totals persist across reloads, entries can be edited and deleted, totals reset at local
midnight, previous days can be browsed, and protein is the most prominent total.

**Independent Test**: Log two entries, reload, and verify that the entries and totals are the same.
Delete one and check that the totals drop by exactly its values (quickstart V7, V8, V12).

### Tests for User Story 2 ⚠️ write first, verify they fail

- [X] T049 [P] [US2] Add failing tests to `frontend/tests/unit/domain/days.test.ts` for `previousDay(dayKey)` / `nextDay(dayKey)`: month and year boundaries, 2028-02-28 → 2028-02-29 (leap year), and 2027-02-28 → 2027-03-01
- [X] T050 [P] [US2] Write failing component tests in `frontend/tests/components/EntryEditor.test.tsx`:
  - Editing the quantity (same unit) rescales macros with `scaleMacros`.
  - Editing macro values directly saves them, and an `'ai'` source becomes `'ai-edited'`.
  - The same validation rules apply as in `ManualEntryForm`, including the large-value confirmation.
  - Delete asks for confirmation, then removes the entry.
  - The totals reflect each change exactly (FR-010).
  - `dayKey` is unchanged after an edit.
- [X] T051 [P] [US2] Write failing tests in `frontend/tests/components/useCurrentDayKey.test.tsx` (Vitest fake timers): the hook returns today's `dayKey`, updates within 60 s of local midnight, and re-checks on `visibilitychange` to visible
- [X] T052 [P] [US2] Write failing component tests in `frontend/tests/components/DayView.test.tsx`:
  - Previous/next day navigation is available, and next is disabled on today.
  - Shows the selected day's entries and totals.
  - Editing or deleting there changes only that day's totals.
- [X] T053 [P] [US2] Add failing assertions to `frontend/tests/components/TodayScreen.test.tsx`: protein appears first and is rendered as the primary (largest) total (FR-009), and the screen switches to the new day's empty totals after the midnight rollover
- [X] T054 [US2] Write a failing Playwright spec `frontend/tests/e2e/totals-persistence.spec.ts` (both projects) covering V7 (reload keeps entries and totals), V8 (edit/delete exact totals) and V12 (using `page.clock` to move past midnight, then browse to the previous day)

### Implementation for User Story 2

- [X] T055 [US2] Implement `previousDay` and `nextDay` in `frontend/src/domain/days.ts` so T049 passes
- [X] T056 [US2] Implement `frontend/src/features/today/EntryEditor.tsx`, opened from an `EntryList` row, so T050 passes
- [X] T057 [US2] Implement `frontend/src/features/today/useCurrentDayKey.ts` and use it in `TodayScreen` so T051 and the rollover part of T053 pass
- [X] T058 [US2] Update `frontend/src/features/today/TotalsPanel.tsx` to put protein first and largest, with kcal/carbs/fat secondary, so T053 passes
- [X] T059 [US2] Implement `frontend/src/features/history/DayView.tsx`, reusing `TotalsPanel`, `EntryList` and `EntryEditor`, and add a "Previous days" entry point in `TodayScreen` so T052 and T054 pass

**Checkpoint**: US1 + US2 make a complete text-based daily tracker that keeps data across reloads.

---

## Phase 5: User Story 3 - Log a food from a photo (Priority: P2)

**Goal**: Take or choose a meal photo with an optional note, get an itemized estimate, then edit,
remove or add items and confirm.

**Independent Test**: Upload a meal photo, confirm, and check that the entries and totals update just
as for a text entry (quickstart V6, V13).

### Tests for User Story 3 ⚠️ write first, verify they fail

- [X] T060 [P] [US3] Add failing photo-path tests to `backend/MacroCounter.Api.Tests/Ai/ClaudeEstimatorTests.cs`: the request contains one base64 `image/jpeg` image block plus the note as text (only when the note is present), nothing else, the same schema, model and error mapping as the text path, and a 40 s timeout
- [X] T061 [P] [US3] Write failing tests in `backend/MacroCounter.Api.Tests/Endpoints/PhotoEstimateEndpointTests.cs`, with `IEstimator` mocked. `POST /api/estimates/photo` (multipart):
  - Returns 200 for a valid JPEG with or without a note.
  - Returns 400 `invalid_request` for a missing `photo` or a note longer than 300 characters.
  - Returns 413 `image_too_large` above 5 MB.
  - Returns 415 `unsupported_media_type` when the content type isn't `image/jpeg` **or** the bytes don't start with the `FF D8 FF` magic number.
  - Returns 502/503/504 as on the text path.
- [X] T062 [P] [US3] Write failing tests in `frontend/tests/unit/media/reencodePhoto.test.ts`:
  - The pure `computeTargetSize(w, h, maxEdge = 1568)` keeps the aspect ratio, never upscales, and rounds to integers.
  - `reencodePhoto(file)` (canvas and `createImageBitmap` mocked) decodes with `imageOrientation: 'from-image'`, draws at the target size, and outputs a `image/jpeg` Blob at quality 0.85.
- [X] T063 [P] [US3] Add failing tests to `frontend/tests/unit/api/estimates.test.ts` for `estimateFromPhoto(jpeg: Blob, note: string | undefined, signal)`: it sends multipart with `photo` and an optional `note` and nothing else, with the same parsing and error mapping as text
- [X] T064 [P] [US3] Add failing tests to `frontend/tests/unit/domain/review.test.ts`:
  - `removeItem(state, index)` removes an item.
  - `addItem(state, item)` adds a manually entered item, which becomes source `'manual'` in `toEntries`.
  - `reviewTotal` updates after each.
  - Confirming with zero items is not allowed.
- [X] T065 [P] [US3] Write failing component tests in `frontend/tests/components/AddFoodPhoto.test.tsx`:
  - The file input has `accept="image/*"` and `capture="environment"`, and there is an optional note field (max 300 characters).
  - The photo is re-encoded before upload.
  - Submitting shows a progress indicator with Cancel; Cancel aborts the upload and saves nothing (FR-016).
  - The review allows editing, removing and adding items.
  - An unrecognized photo shows a message with Retry, Describe in text and Enter manually.
  - A decode failure, `image_too_large` or `unsupported_media_type` shows "This image couldn't be used" with the reason, plus Describe in text and Enter manually.
- [X] T066 [US3] Write a failing Playwright spec `frontend/tests/e2e/log-photo.spec.ts` (both projects, `/api/**` mocked):
  - Upload the fixture `frontend/tests/e2e/fixtures/meal-with-gps.jpg`, a small JPEG that contains EXIF GPS tags.
  - Assert the intercepted upload is JPEG, its long edge is ≤ 1568 px, and it has **no `Exif` APP1 segment**. This automates the photo-metadata part of V13.
  - Then confirm, and check that entries and totals update (V6 with mocked AI).

### Implementation for User Story 3

- [X] T067 [US3] Implement `EstimateFromPhotoAsync` in `backend/MacroCounter.Api/Ai/ClaudeEstimator.cs` so T060 passes
- [X] T068 [US3] Implement `POST /api/estimates/photo` in `backend/MacroCounter.Api/Endpoints/EstimateEndpoints.cs` with a 5 MB request size limit on that endpoint, the content-type and magic-byte check, and an in-memory-only photo (never written to disk), so T061 passes
- [X] T069 [US3] Implement `computeTargetSize` and `reencodePhoto` in `frontend/src/media/reencodePhoto.ts` so T062 passes
- [X] T070 [US3] Implement `estimateFromPhoto` in `frontend/src/api/estimates.ts` so T063 passes
- [X] T071 [US3] Implement `removeItem` and `addItem` in `frontend/src/domain/review.ts`, and add remove/add-item controls to `frontend/src/features/add-food/ReviewEstimate.tsx`, so T064 passes
- [X] T072 [US3] Implement `frontend/src/features/add-food/AddFoodPhoto.tsx` and add a Text / Photo / Manual switch to the Add Food view, so T065 and T066 pass

**Checkpoint**: Photo logging works end to end, with photo metadata stripped on the device.

---

## Phase 6: User Story 4 - Re-log a food I've eaten before (Priority: P3)

**Goal**: Confirmed foods are remembered and can be re-logged from Recent in ≤ 3 interactions, with
an adjustable quantity.

**Independent Test**: Log a food through AI, re-log it from Recent in ≤ 3 interactions, and check
that the totals rise by the same values (quickstart V10).

### Tests for User Story 4 ⚠️ write first, verify they fail

- [X] T073 [P] [US4] Write failing tests in `frontend/tests/unit/data/savedFoodRepository.test.ts`:
  - `upsertFromEntry(entry)` matches an existing saved food by "same normalized name (trimmed, lowercase) and unit".
  - A match updates `macros`, `referenceQuantity`, `source` and `lastUsedAt`; no match creates a new saved food.
  - `listRecent(limit = 20)` sorts by `lastUsedAt` descending.
  - Records carry `id`/`createdAt`/`updatedAt`/`schemaVersion`.
- [X] T074 [P] [US4] Write failing tests in `frontend/tests/unit/data/logService.test.ts` for `confirmEntries(entries)`:
  - It writes the entries and upserts one saved food per entry.
  - Entries logged from Recent get `savedFoodId` set.
  - Manual entries are also saved.
- [X] T075 [P] [US4] Write failing component tests in `frontend/tests/components/RecentFoods.test.tsx`:
  - Recent is reachable from Today in 1 tap, with items most recent first.
  - Picking an item shows its reference quantity pre-filled; "Log" logs it. That is 3 interactions in total: open Recent → pick → Log.
  - Changing the amount rescales macros using `scaleMacros`.
  - The unit is fixed to the saved unit.
  - A food with reference amount 0 can only be logged at its saved values (amount editing disabled).
  - An empty state is shown when nothing has been saved.
- [X] T076 [US4] Write a failing Playwright spec `frontend/tests/e2e/recent.spec.ts` (both projects) for V10, counting user actions from Today to a logged entry (≤ 3)

### Implementation for User Story 4

- [X] T077 [US4] Add a `SavedFoodRepository` interface to `frontend/src/data/repositories.ts`. Implement it in `frontend/src/data/savedFoodRepository.ts` so T073 passes
- [X] T078 [US4] Implement `confirmEntries` in `frontend/src/data/logService.ts` and switch `ReviewEstimate.tsx` and `ManualEntryForm.tsx` to use it, so T074 passes and the earlier US1/US3 tests still pass
- [X] T079 [US4] Implement `frontend/src/features/recent/RecentFoods.tsx` and the "Recent" button on `TodayScreen`, so T075 and T076 pass

**Checkpoint**: Repeat foods are fast to log, meeting SC-005.

---

## Phase 7: User Story 5 - Daily protein goal (Priority: P3)

**Goal**: Set, change or clear a daily protein goal (grams). Today shows logged vs. goal and the
amount remaining or exceeded. Previous days keep the goal that was in effect then.

**Independent Test**: Set 150 g, log 90 g of protein, and check that Today shows "90 / 150 g" and
"60 g left" without scrolling on both viewports (quickstart V9).

### Tests for User Story 5 ⚠️ write first, verify they fail

- [X] T080 [P] [US5] Write failing tests in `frontend/tests/unit/domain/nutrition/proteinProgress.test.ts` for `proteinProgress(loggedG, goalG | null)`:
  - It returns `null` when there is no goal.
  - 90/150 gives `{loggedG:90, goalG:150, remainingG:60, exceededG:0, met:false}`.
  - Exactly 150/150 gives `remainingG:0, met:true`.
  - 170/150 gives `exceededG:20, met:true`.
  - 0 logged gives `remainingG = goalG`.
  - Full precision is kept.
  - A negative or non-finite `loggedG` throws `RangeError`. A `goalG` that is ≤ 0 or non-finite throws `RangeError` (`null` is the only way to say "no goal").
- [X] T081 [P] [US5] Write failing tests in `frontend/tests/unit/domain/goals.test.ts` for `goalForDay(history, dayKey)`:
  - It returns the `grams` of the record with "the largest `effectiveFrom ≤ D`".
  - It returns `null` when there is no such record or its `grams` is `null` (the goal was cleared).
  - A future-dated record is ignored for earlier days.
- [X] T082 [P] [US5] Write failing tests in `frontend/tests/unit/data/proteinGoalRepository.test.ts`:
  - `setGoal(dayKey, grams | null)`: `grams` must be "finite and > 0" or `null`; reject 0, negative, NaN.
  - Setting a goal twice on the same `effectiveFrom` replaces that day's record (unique index).
  - `listAll()` returns the full history.
- [X] T083 [P] [US5] Write failing component tests in `frontend/tests/components/GoalSettings.test.tsx`: set, change and clear the goal; 0 and non-numeric input show "Enter a protein goal greater than 0 g" and nothing is saved
- [X] T084 [P] [US5] Write failing component tests in `frontend/tests/components/ProteinProgress.test.tsx`:
  - With no goal it shows the totals and a "Set a protein goal" prompt.
  - With a goal it shows "90 / 150 g" and "60 g left" (matching quickstart V9).
  - When exceeded it shows "Goal met" and "+20 g".
  - `DayView` for a past day uses the goal in effect that day (FR-020).
- [X] T085 [US5] Write a failing Playwright spec `frontend/tests/e2e/goal.spec.ts` (both projects) for V9. It asserts that the protein progress element's bounding box is fully inside the initial viewport, with no scrolling, at 360×740 and 1280×800 (SC-009)

### Implementation for User Story 5

- [X] T086 [US5] Implement `proteinProgress` in `frontend/src/domain/nutrition/proteinProgress.ts` so T080 passes
- [X] T087 [US5] Implement `goalForDay` in `frontend/src/domain/goals.ts` so T081 passes
- [X] T088 [US5] Add a `ProteinGoalRepository` interface and implement it in `frontend/src/data/proteinGoalRepository.ts` so T082 passes
- [X] T089 [US5] Implement `frontend/src/features/goal/GoalSettings.tsx` so T083 passes
- [X] T090 [US5] Implement `frontend/src/features/today/ProteinProgress.tsx` and render it at the top of `TotalsPanel` in Today and `DayView`, so T084 and T085 pass

**Checkpoint**: All five user stories work.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T091 Write a failing Playwright spec `frontend/tests/e2e/offline.spec.ts`: load the app, go offline with `context.setOffline(true)`, reload, and check that Today, history and manual entry still work and AI entry shows as unavailable (Principle III)
- [X] T092 Configure `vite-plugin-pwa` in `frontend/vite.config.ts` so T091 passes:
  - Precache the app shell.
  - Use the `index.html` navigate fallback, and never cache `/api/**`.
  - Add a web manifest with name "Macro Counter" and icons in `frontend/public/icons/`.
- [X] T093 [P] Write `frontend/tests/e2e/touch-targets.spec.ts` (mobile project): every visible button, link and input on each view is at least 44×44 CSS px. Fix any violations in `frontend/src/styles.css`
- [X] T094 [P] Create `scripts/check.ps1`, which runs in order and exits non-zero on the first failure:
  1. `dotnet format backend --verify-no-changes`
  2. `dotnet test backend /p:CollectCoverage=true`
  3. `npm --prefix frontend run lint`
  4. `npm --prefix frontend run typecheck`
  5. `npm --prefix frontend test -- --coverage`
  6. `npm --prefix frontend run e2e`

  This is the merge gate from the constitution's Development Workflow.
- [X] T095 [P] Create `scripts/accuracy-check.ps1` and `scripts/accuracy-reference.json` (20 common foods with a stated portion and USDA reference kcal, e.g. "1 large egg" = 72 kcal). The script is **manual and opt-in, outside the test suite**:
  - It posts each item to a locally running app's `/api/estimates/text`.
  - It reports the percentage of items within ±20% kcal (SC-007 target: ≥ 80%).
  - Its header warns that it spends API credits.
- [X] T096 [P] Write the root `README.md` covering:
  - Prerequisites.
  - Setting the key with `dotnet user-secrets set "Anthropic:ApiKey" ...`, run in your own terminal, never committed or pasted into chat.
  - Development and single-process run commands, and phone access over the LAN.
  - A warning not to expose the port publicly.
  - Changing `Anthropic:Model`.
  - Running `scripts/check.ps1`.
- [X] T097 Run `scripts/check.ps1` and fix anything that fails. Confirm 100% line and branch coverage for `frontend/src/domain/**` and `MacroCounter.Api.Nutrition`
- [ ] T098 The user manually runs quickstart.md V1–V14 with their real key, on desktop and on a phone over the LAN. Record the results in `specs/001-ai-macro-logging/checklists/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001 (toolchain check) comes first.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories.**
- **US1 (Phase 3)**: Depends on Foundational. It is the MVP.
- **US2 (Phase 4)**: Depends on Foundational and on US1's `TodayScreen`/`TotalsPanel`/`EntryList` (T048).
- **US3 (Phase 5)**: Depends on US1's estimate API client, `ReviewEstimate` and the endpoints (T042–T046).
- **US4 (Phase 6)**: Depends on US1's confirm flow (T046–T047). Its `logService` refactor touches US1/US3 files, so do it after US3.
- **US5 (Phase 7)**: Depends on US1's `TotalsPanel` and on US2's `DayView` for the past-day goal display (T059).
- **Polish (Phase 8)**: After all desired stories.

For a solo developer, the recommended order is strictly sequential: Phase 1 → 2 → 3 → 4 → 5 → 6 →
7 → 8.

### Within Each Story

1. Test tasks first. Run them and **confirm they fail** for the right reason.
2. Then the implementation tasks, in the order listed. Each one names the test it makes pass.
3. Refactor with all tests green, then commit.

### Parallel Opportunities

- Setup: T004, T005, T007, T008, T009 and T010 can run in parallel after T002/T003.
- Foundational: the test tasks T011, T013, T015, T017, T019, T021, T023, T026, T030 and T031a are in
  separate files and can be written in parallel. Each implementation task follows its own test. T025
  can run alongside the frontend work.
- Within a story: all tasks marked [P] in its "Tests" subsection can be written in parallel.
  Backend and frontend implementation tasks in the same story can proceed in parallel, because they
  communicate only through `contracts/estimates-api.yaml`.

---

## Parallel Example: User Story 1

```text
# Write all US1 tests together (they are in different files):
T033 backend/MacroCounter.Api.Tests/Ai/ClaudeEstimatorTests.cs
T034 backend/MacroCounter.Api.Tests/Endpoints/TextEstimateEndpointTests.cs
T035 frontend/tests/unit/api/estimates.test.ts
T036 frontend/tests/unit/domain/review.test.ts
T037 frontend/tests/components/AddFoodText.test.tsx
T038 frontend/tests/components/ManualEntryForm.test.tsx
T039 frontend/tests/components/TodayScreen.test.tsx

# Then backend (T041→T042→T043) and frontend (T044→T045→T046→T047→T048) in parallel tracks.
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1: Setup. Install the .NET 10 SDK if it is missing.
2. Phase 2: Foundational.
3. Phase 3: US1.
4. **Stop and validate**: run `scripts/check.ps1` (or its steps) and quickstart V1–V5, V11 and
   V14 with the real key.

### Incremental delivery

1. US1: text logging with today's totals (MVP).
2. US2: persistence checks, edit/delete, day history, protein prominence.
3. US3: photo logging.
4. US4: recent foods.
5. US5: protein goal.
6. Polish: offline PWA, touch targets, merge-gate script, accuracy check, README.

Commit after each green test→implementation pair. Merge `001-ai-macro-logging` into `master` only
when `scripts/check.ps1` passes.

---

## Notes

- [P] = different files and no dependency on unfinished tasks.
- Rounding happens **only** in `frontend/src/domain/nutrition/format.ts`. Domain and storage keep
  full precision.
- `ClaudeEstimator.cs` is the only file that references the Anthropic SDK, and
  `frontend/src/api/estimates.ts` is the only frontend file that calls `/api/estimates`.
- Never commit an API key. Tests set `Anthropic:ApiKey` to a dummy value through in-memory
  configuration.
- Data export (constitution Principle III) is **not** part of this feature. Track it as a separate
  feature.
