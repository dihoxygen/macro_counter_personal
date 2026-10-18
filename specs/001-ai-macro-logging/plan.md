# Implementation Plan: AI Macro Logging

**Branch**: `001-ai-macro-logging` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ai-macro-logging/spec.md`

## Summary

Build a protein-focused macro logger as a React web app (desktop and mobile) backed by a small
ASP.NET Core service. The user describes food in text or with a photo. The backend sends only that
input to Claude (`claude-opus-5-5`) using structured outputs, validates the response with
deterministic sanity checks, and returns a per-item estimate. The user reviews, edits and confirms
it. All user data (entries, saved foods, protein goal history) stays in the browser's IndexedDB.
Daily totals and protein progress are computed with pure, fully tested functions. The backend is
stateless and exists to keep the API key secret ([research R1](./research.md)).

## Technical Context

**Language/Version**: C# 14 / .NET 10 (LTS) backend; TypeScript 5.x (strict) + React 19 frontend

**Primary Dependencies**: ASP.NET Core Minimal APIs, `Anthropic` (official .NET SDK); Vite, `idb`,
`zod`, `vite-plugin-pwa` (justified in [research R3](./research.md#r3-frontend-stack))

**Storage**: Browser IndexedDB (stores `entries`, `savedFoods`, `proteinGoals`, `meta`). No
server-side storage

**Testing**: xUnit + coverlet (backend); Vitest + React Testing Library + Playwright (frontend).
Claude is always mocked

**Target Platform**: Current desktop and mobile browsers (Chrome, Edge, Firefox, Safari), ≥ 360px
wide; backend on Windows (dev), portable to Linux

**Project Type**: Web application (React SPA + stateless .NET API)

**Performance Goals**: Text estimate shown in ≤ 15 s p90 and photo estimate in ≤ 25 s p90 (leaves
room inside SC-001's 30 s and SC-002's 45 s). Totals update in < 100 ms after confirm, edit or delete

**Constraints**: Works offline except for AI lookup; the photo is at most 1568 px on its long edge,
JPEG, ≤ 5 MB with EXIF stripped on the device; the API key never reaches the client; 100% line and
branch coverage on the nutrition math modules

**Scale/Scope**: Single user; about 10–30 entries per day; a few years of history (≈ 30k entries);
about 4 screens (Today, Add/Review, Day history, Goal settings)

All earlier unknowns (backend role, key handling, model, validation thresholds, photo pipeline,
day/time-zone semantics, hosting) are resolved in [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Test-First | Tasks put each failing test before its implementation. Bug fixes start with a reproducing test. CI blocks merges with failing or skipped tests | ✅ Planned. `/speckit-tasks` must order tests first |
| II. Correct Nutrition Math | Pure functions: frontend `src/domain/nutrition/` (totals, scaling, protein progress, plausibility, rounding formatters) plus `src/domain/review.ts`, `goals.ts` and `days.ts`, all under the 100% threshold; backend `Nutrition/` (estimate validator, 4/4/9 check, total recomputation). Typed `Quantity` units. Rounding only in formatters. Reference-value and edge-case tests. 100% line and branch coverage enforced by Vitest thresholds and coverlet `Threshold` | ✅ |
| III. Local-First, Sync-Ready | IndexedDB behind repository interfaces (`src/data/`). UUIDs, `createdAt`/`updatedAt`, `schemaVersion` plus a migration runner. The app shell works offline through the service worker | ✅. ⚠️ Data export is required by the constitution but deferred to a separate feature (spec Assumptions); no violation here, but it must be built before v1 is considered complete |
| IV. Fast Logging on Desktop & Mobile | Re-log in ≤ 3 interactions; ≥ 360px layout; touch targets ≥ 44px; protein, totals and goal visible without scrolling. Playwright runs at both viewports | ✅ |
| V. Simplicity | Two deployables only. Minimal APIs with no controllers or MediatR. No UI library. Every dependency is justified in research R3 | ✅. The two-project structure is recorded under Complexity Tracking |
| VI. AI-Assisted Food Lookup | One AI client module (`Ai/ClaudeEstimator.cs`; frontend `src/api/estimates.ts`). Structured outputs plus a schema and sanity validator. User confirmation before saving, with the source recorded. Key in User Secrets or env, never in the repo or bundle. Manual-entry fallback. Claude mocked in all tests. Model set only in `appsettings.json` | ✅ |
| Tech Constraints: Privacy | Only the description, or the photo and note, is sent. EXIF stripped on the device. No logs or goals sent | ✅ |
| Tech Constraints: Storage | No user data on the server; the proxy is stateless | ✅ |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. The data model has no server
entities. The contracts carry no personal data. The validator thresholds are fixed numbers and can
be tested.

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-macro-logging/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R10
├── data-model.md        # Phase 1: IndexedDB entities, derived values, estimate lifecycle
├── quickstart.md        # Phase 1: setup, tests, validation scenarios V1–V14
├── contracts/
│   ├── estimates-api.yaml        # OpenAPI 3.1: /api/status, /api/estimates/text, /api/estimates/photo
│   └── ai-estimate.schema.json   # Structured-output schema Claude must return
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

As built (updated after implementation to match the code):

```text
backend/
├── MacroCounter.Api/
│   ├── Program.cs                     # Config binding, DI, GET /api/status, static files + SPA fallback
│   ├── appsettings.json               # Anthropic:Model, Anthropic:Effort (no key)
│   ├── Ai/
│   │   ├── IEstimator.cs              # Seam the endpoints depend on (mocked in endpoint tests)
│   │   ├── ClaudeEstimator.cs         # The only Anthropic SDK caller (Principle VI); IClaudeMessageSender seam
│   │   ├── UnavailableEstimator.cs    # Registered when no API key is set → 503 ai_unavailable
│   │   ├── EstimatePrompt.cs          # Stable system prompt + schema loader
│   │   ├── ai-estimate.schema.json    # Embedded copy of contracts/ai-estimate.schema.json
│   │   ├── AiEstimateDto.cs           # Raw structured-output shape (snake_case)
│   │   ├── AnthropicOptions.cs        # ApiKey, Model, Effort
│   │   └── AiExceptions.cs            # AiUnavailable / AiTimeout / InvalidAiResponse
│   ├── Endpoints/
│   │   ├── EstimateEndpoints.cs       # POST /api/estimates/text and /api/estimates/photo
│   │   └── Problems.cs                # RFC 9457 problem responses with `code`
│   ├── Nutrition/                     # Pure functions, 100% coverage
│   │   ├── EstimateValidator.cs       # Hard checks (reject) + consistency flags (research R5)
│   │   └── MacroMath.cs               # 4/4/9 kcal, total recomputation
│   ├── Contracts/EstimateContracts.cs # Request/response records matching estimates-api.yaml
│   └── wwwroot/                       # Frontend build output (git-ignored)
└── MacroCounter.Api.Tests/
    ├── Nutrition/                     # Unit + reference-value tests
    ├── Ai/                            # ClaudeEstimator text/photo tests via FakeClaudeSender
    └── Endpoints/                     # WebApplicationFactory tests (ApiFactory), FakeEstimator

frontend/
├── src/
│   ├── domain/                        # Pure functions, 100% coverage across src/domain
│   │   ├── nutrition/                 # totals, scale, proteinProgress, plausibility, validate, format
│   │   ├── types.ts                   # zod schemas: Unit, Quantity, Macros, Source, DayKey
│   │   ├── days.ts                    # toDayKey, previousDay, nextDay
│   │   ├── goals.ts                   # goalForDay over the goal history
│   │   └── review.ts                  # Estimate review state → entries
│   ├── data/
│   │   ├── db.ts, migrations.ts       # IndexedDB (idb) + schema migration runner
│   │   ├── repositories.ts            # Repository interfaces
│   │   ├── records.ts                 # Persisted record schemas (sync-ready metadata)
│   │   ├── entryRepository.ts, savedFoodRepository.ts, proteinGoalRepository.ts
│   │   ├── logService.ts              # confirmEntries: write entries + upsert saved foods
│   │   └── ids.ts                     # UUID v4 that also works over plain HTTP on the LAN
│   ├── api/
│   │   ├── estimates.ts               # The only /api/estimates caller; zod-validates responses
│   │   └── status.ts                  # GET /api/status
│   ├── app/services.tsx               # Services context (repositories + API) for injection in tests
│   ├── media/reencodePhoto.ts         # Canvas re-encode: resize + strip EXIF (research R7)
│   ├── features/
│   │   ├── today/                     # TodayScreen, DayLog, TotalsPanel, ProteinProgress, EntryList,
│   │   │                              #   EntryEditor, useCurrentDayKey
│   │   ├── add-food/                  # AddFood (Text/Photo/Manual switch), AddFoodText, AddFoodPhoto,
│   │   │                              #   ReviewEstimate, ManualEntryForm, useEstimateFlow
│   │   ├── shared/                    # FormBits, entryForm, numberField (shared form validation)
│   │   ├── recent/RecentFoods.tsx     # Saved foods quick re-log
│   │   ├── history/DayView.tsx        # Previous days
│   │   └── goal/GoalSettings.tsx      # Protein goal settings
│   ├── App.tsx, main.tsx, styles.css
├── tests/
│   ├── unit/                          # Mirrors src/domain, src/data, src/api, src/media (fake-indexeddb)
│   ├── components/                    # React Testing Library
│   └── e2e/                           # Playwright, desktop + 360px, /api mocked via route(); fixtures/
├── vite.config.ts                     # /api proxy → :5080, build outDir → ../backend/MacroCounter.Api/wwwroot, PWA
├── playwright.config.ts
└── package.json

scripts/
├── check.ps1                          # Merge gate: format, tests + coverage, lint, typecheck, e2e
├── accuracy-check.ps1                 # Manual, opt-in SC-007 accuracy + SC-001 latency check (spends credits)
└── accuracy-reference.json
```

**Structure Decision**: A web application with `backend/` (.NET) and `frontend/` (React), as the
user asked. Business data and math live in the frontend because storage is local-first. The backend
holds only AI orchestration and AI-response validation.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Two codebases (.NET backend + React frontend) for a single-user app | The user chose .NET + React. A server is also the only safe place for the Claude API key (Principle VI) | A frontend-only app calling Claude directly would put the key in the browser and drop the requested .NET stack |
| Nutrition logic split across languages (C# validator, TS totals) | AI output must be validated before it leaves the trusted boundary. Totals must work offline on the client | Validating only on the client would trust whatever the proxy returns. Totals on the server would break offline use and the "no server data" rule |
