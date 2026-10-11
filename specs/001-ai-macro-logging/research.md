# Research: AI Macro Logging

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-07

Each section records a decision made for this feature, why it was chosen, and the alternatives
that were considered.

## R1. Overall architecture: where .NET fits in a local-first app

- **Decision**: The ASP.NET Core backend is a **stateless AI proxy plus static file host**. All user
  data (entries, saved foods, goals) and all log/total math live in the React app, stored in the
  browser's IndexedDB. The backend holds the Claude API key, calls Claude, validates the result, and
  returns an estimate. It never stores anything.
- **Rationale**: The user asked for .NET + React. The constitution (III, Technical Constraints)
  requires client-side storage and allows a stateless proxy only for Claude calls. Putting the key on
  the server satisfies Principle VI ("key MUST NOT be bundled into client code").
- **Alternatives considered**:
  - *Backend owns data in a server DB (EF Core + SQLite)*: violates Principle III and the "no
    server-side storage of user data in v1" constraint.
  - *Browser calls Claude directly with a user-entered key*: no .NET role, the key sits in browser
    storage, and it contradicts the user's choice of a .NET backend.

## R2. Backend stack

- **Decision**: .NET 10 (current LTS), ASP.NET Core **Minimal APIs**, official `Anthropic` NuGet
  SDK. Tests use xUnit, with coverlet for coverage. Two projects: `backend/MacroCounter.Api` and
  `backend/MacroCounter.Api.Tests`.
- **Rationale**: Minimal APIs fit two or three endpoints with no ceremony (Principle V). .NET 10 is
  the supported LTS line. The official SDK is required by the Claude integration guidance, with no
  hand-rolled HTTP.
- **Alternatives considered**: MVC controllers (more boilerplate for 3 endpoints); .NET Framework
  4.8 (Windows-only and legacy; "the .NET framework" is read as modern .NET); separate
  Domain/Infrastructure class libraries (premature for a proxy this size).
- **Note**: No .NET SDK is installed on this machine yet (`dotnet --list-sdks` is empty). Install
  the .NET 10 SDK first (see quickstart).

## R3. Frontend stack

- **Decision**: React 19 + TypeScript (strict) built with Vite. Tests use Vitest and React Testing
  Library, with Playwright for end-to-end tests at a desktop viewport and a 360px mobile viewport.
  Storage uses the `idb` package, a thin promise wrapper over IndexedDB. Offline app loading uses
  `vite-plugin-pwa`, a generated service worker.
- **Rationale**: TypeScript is recommended by the constitution, and typed units catch unit
  mistakes (Principle II). Vite is the standard React build tool. `idb` is about 1 KB and keeps raw
  IndexedDB callbacks out of the repository code; Dexie was rejected as heavier than needed
  (Principle V). A service worker is needed to meet "fully usable offline" (Principle III), and
  writing one by hand is more code than the plugin.
- **Alternatives considered**: Create React App (deprecated); Next.js (server rendering is
  unnecessary because .NET is the server); `localStorage` (synchronous, about 5 MB, no indexes);
  Jest (slower and needs extra config with Vite).
- **Dependency justification (Principle V)**: `react`, `react-dom` (user choice); `idb` (replaces
  about 100 lines of IndexedDB wrapper code); `vite-plugin-pwa` (replaces a hand-written service
  worker); `zod` (validates the API response shape at the client boundary, used by both Principle VI
  and the repository layer when reading stored records). No UI component library: plain CSS with
  responsive layout is enough for the handful of screens here.

## R4. Claude integration

- **Decision**:
  - Model **`claude-opus-5-5`** set in exactly one place, `appsettings.json` → `Anthropic:Model`
    (Principle VI).
  - Effort `medium` (the model default) set explicitly via `Anthropic:Effort`.
  - **Structured outputs** (`OutputConfig.Format` with the JSON schema in
    [contracts/ai-estimate.schema.json](./contracts/ai-estimate.schema.json)) so Claude returns
    parseable JSON.
  - **Server-side refusal fallback** turned on (`fallbacks: "default"` with the
    `server-side-fallback-2026-07-01` beta), so a safety decline is retried on a fallback model in
    the same call.
  - Photos are sent as a base64 image content block in the same request as the optional note.
- **Rationale**: Opus 5.5 is the current default model. Food identification from photos and portion
  estimation benefit from a strong vision model. Structured outputs remove JSON-parsing fragility.
  Effort is kept configurable so latency (SC-001/002) can be tuned without code changes.
- **Alternatives considered**: Haiku or Sonnet for lower cost. These can be switched in config if
  cost or latency matters, but the plan does not pick a weaker model without being asked.
  Tool-use-based JSON was rejected as it adds a loop for no benefit.
- **Prompt rules** (system prompt, stable so it can be cached):
  - Estimate per item.
  - State the assumed portion in grams or ml.
  - Use standard reference values (USDA-style) where known.
  - Return `recognized: false` instead of guessing when no food is present.
  - Never include text outside the schema.

## R5. AI response validation and sanity checks (FR-005, Principle VI)

- **Decision**: These run as pure functions in the backend (`Nutrition/EstimateValidator.cs`),
  covered by Principle II's 100% coverage rule:
  1. **Schema**: structured outputs guarantee the shape. The validator still rejects
     missing/non-finite numbers, or an empty item list when `recognized: true`. Errors return
     `502 invalid_ai_response`, never partial data.
  2. **Reject**: any negative value; any item with `kcal > 5000` or any macro `> 1000 g`.
  3. **Flag (warn; the user must explicitly accept the warning before confirming)**: `|kcal − (4P + 4C + 9F)| > max(20 kcal, 15% of
     4P+4C+9F)` per item. The tolerance covers fiber and alcohol, which make the 4/4/9 rule
     inexact. Also a portion over 2000 g.
  4. **Totals**: the combined total is recomputed from the items on the server. Claude's own total
     is never trusted.
- **Rationale**: This puts a number on the spec's "implausible" and keeps every check unit-testable
  with reference values.
- **Alternatives considered**: Asking Claude to self-check (not deterministic and not testable);
  rejecting instead of flagging 4/4/9 mismatches (too many false rejections for high-fiber foods).

## R6. API key handling: answering "how do you need this info provided?"

- **Decision**: **Do not give the key to Claude Code, paste it into chat, or put it in any file in
  the repo.** The backend reads `Anthropic:ApiKey` from .NET configuration:
  - **Local development**: .NET **User Secrets**, stored outside the repo in
    `%APPDATA%\Microsoft\UserSecrets\`. You run this yourself in your own terminal (not through
    Claude Code's `!` prefix, which would write it into the conversation):
    `dotnet user-secrets set "Anthropic:ApiKey" "<your key>" --project backend/MacroCounter.Api`
  - **Any later hosted deployment**: the environment variable `Anthropic__ApiKey`.
  - If the key is missing, the backend starts normally and `GET /api/status` reports
    `aiAvailable: false`. The UI then hides AI entry and shows manual entry, which meets the spec's
    "AI unavailable" edge case.
- **Rationale**: User Secrets is the standard .NET development mechanism and is never committed.
  Unit and integration tests mock Claude (Principle VI), so the key is needed only to run the real
  app.
- **Alternatives considered**: `.env` file (easy to commit by accident); `appsettings.Development.json`
  (lives in the repo); entering the key in the browser (the key would sit in client storage).

## R7. Photo handling and privacy (FR-002, FR-015)

- **Decision**:
  - The client accepts images via `<input type="file" accept="image/*" capture="environment">`,
    which opens the camera on phones and a file picker on desktop.
  - The client **re-encodes the photo through a canvas** to JPEG (quality 0.85), with the long edge
    at most 1568 px, before upload. This removes all EXIF/GPS metadata on the device and keeps
    uploads small (typically under 500 KB).
  - The server enforces a 5 MB limit and accepts only `image/jpeg`.
  - The photo is never stored; it lives only in memory for the request.
- **Rationale**: Stripping metadata on the client means location data never leaves the device. The
  1568 px cap matches the size Claude's vision downsamples to anyway. The capture attribute works
  without HTTPS, unlike `getUserMedia`.
- **Alternatives considered**: Server-side EXIF stripping (metadata would still leave the phone);
  a live camera preview with `getUserMedia` (needs HTTPS and more UI code).

## R8. Days, time zones, and goal history (FR-012, FR-020)

- **Decision**:
  - Each entry stores `dayKey` (local `YYYY-MM-DD`) computed when it is created, plus a UTC
    `loggedAt`. Totals for a day are the sum of entries with that `dayKey`, so day logs are
    computed, not stored.
  - The protein goal is stored as a **history** of `{effectiveFrom: dayKey, grams | null}`. The goal
    for a day is the latest record with `effectiveFrom ≤ dayKey`.
  - The main screen rechecks the current `dayKey` when the page becomes visible and once a minute,
    to handle midnight.
- **Rationale**: Storing `dayKey` at creation means travel never moves entries between days (spec
  edge case). Goal history meets "previous days keep their goal" without copying goals onto each day.

## R9. Number precision and units (Principle II)

- **Decision**:
  - Values are stored as JS `number` / C# `double` at full precision and rounded only in display
    formatters (kcal to an integer, grams to 1 decimal place).
  - Quantities are a typed `{ amount, unit: 'g' | 'ml' | 'serving' }`.
  - Re-log scaling uses the factor `newAmount / referenceAmount` and is allowed only when the unit
    is the same. A different unit is a type error, or rejected at runtime for stored data.
- **Rationale**: Meets "explicit units" and "round at display time only". Conversions between units
  (g↔ml, which depend on density) are out of scope.

## R10. Hosting and phone access

- **Decision**:
  - **Development**: the Vite dev server (port 5173) proxies `/api` to ASP.NET (port 5080).
  - **Running it for real**: `npm run build` puts output in `backend/MacroCounter.Api/wwwroot`, and
    a single `dotnet run` serves both the app and the API.
  - **Phone access**: on the home network, bind to `0.0.0.0` and open `http://<pc-ip>:5080` on the
    phone.
- **Rationale**: One process, one port, no CORS. Public internet hosting is **out of scope**: an
  exposed proxy would let anyone spend the API key, so a deployment feature must add access control
  first.
- **Alternatives considered**: Separate frontend hosting with CORS (more moving parts for a
  personal tool).
