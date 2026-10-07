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
| II. Correct Nutrition Math | Pure functions: frontend `src/domain/nutrition/` (totals, scaling, protein progress, rounding formatters); backend `Nutrition/` (estimate validator, 4/4/9 check, total recomputation). Typed `Quantity` units. Rounding only in formatters. Reference-value and edge-case tests. 100% line and branch coverage enforced by Vitest thresholds and coverlet `Threshold` | ✅ |
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

```text
backend/
├── MacroCounter.Api/
│   ├── Program.cs                 # Minimal API endpoints, config binding, static files (wwwroot)
│   ├── appsettings.json           # Anthropic:Model, Anthropic:Effort (no key)
│   ├── Ai/
│   │   ├── IEstimator.cs          # Seam for mocking
│   │   ├── ClaudeEstimator.cs     # The only Anthropic SDK caller (Principle VI)
│   │   └── EstimatePrompt.cs      # Stable system prompt + schema
│   ├── Nutrition/                 # Pure functions, 100% coverage
│   │   ├── EstimateValidator.cs   # Reject/flag rules (research R5)
│   │   └── MacroMath.cs           # 4/4/9 kcal, total recomputation
│   ├── Contracts/                 # Request/response records matching estimates-api.yaml
│   └── wwwroot/                   # Frontend build output (git-ignored)
└── MacroCounter.Api.Tests/
    ├── Nutrition/                 # Unit + reference-value tests
    ├── Ai/                        # ClaudeEstimator with a faked SDK response
    └── Endpoints/                 # WebApplicationFactory integration tests, IEstimator mocked

frontend/
├── src/
│   ├── domain/nutrition/          # Pure functions, 100% coverage: totals, scale, proteinProgress, format
│   ├── domain/days.ts             # dayKey, goal-for-day lookup
│   ├── data/                      # Repository interfaces + IndexedDB (idb) implementation, migrations
│   ├── api/estimates.ts           # The only /api caller; zod-validates responses
│   ├── media/reencodePhoto.ts     # Canvas re-encode: resize + strip EXIF (research R7)
│   ├── features/
│   │   ├── today/                 # Main screen: protein progress, totals, entry list
│   │   ├── add-food/              # Text / photo / manual input, review & confirm
│   │   ├── recent/                # Saved foods quick re-log
│   │   ├── history/               # Previous days
│   │   └── goal/                  # Protein goal settings
│   └── main.tsx
├── tests/
│   ├── unit/                      # Mirrors src/domain, src/data (fake-indexeddb)
│   ├── components/                # React Testing Library
│   └── e2e/                       # Playwright, desktop + 360px, /api mocked via route()
├── vite.config.ts                 # /api proxy → :5080, build outDir → ../backend/MacroCounter.Api/wwwroot
└── package.json
```

**Structure Decision**: A web application with `backend/` (.NET) and `frontend/` (React), as the
user asked. Business data and math live in the frontend because storage is local-first. The backend
holds only AI orchestration and AI-response validation.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Two codebases (.NET backend + React frontend) for a single-user app | The user chose .NET + React. A server is also the only safe place for the Claude API key (Principle VI) | A frontend-only app calling Claude directly would put the key in the browser and drop the requested .NET stack |
| Nutrition logic split across languages (C# validator, TS totals) | AI output must be validated before it leaves the trusted boundary. Totals must work offline on the client | Validating only on the client would trust whatever the proxy returns. Totals on the server would break offline use and the "no server data" rule |
