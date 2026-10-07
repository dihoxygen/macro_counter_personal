# Quickstart & Validation: AI Macro Logging

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This guide explains how to run the feature once it is implemented and how to prove it works. Paths
match the layout in [plan.md](./plan.md#project-structure).

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| .NET SDK | 10.x (LTS) | `dotnet --list-sdks`. **Not installed yet on this machine**: get it from <https://dotnet.microsoft.com/download/dotnet/10.0> |
| Node.js | 24.x (installed: v24.19.0) | `node --version` |
| Claude API key | | Needed only to run the real app. Tests never use it |

## 1. Configure the API key (once, by you)

Run this in **your own terminal**. Do not paste the key into Claude Code or commit it anywhere:

```powershell
dotnet user-secrets init --project backend/MacroCounter.Api   # only if not already initialized
dotnet user-secrets set "Anthropic:ApiKey" "<your-key>" --project backend/MacroCounter.Api
```

The key is stored under `%APPDATA%\Microsoft\UserSecrets\`, outside the repo. To change the model or
effort, edit `Anthropic:Model` / `Anthropic:Effort` in `backend/MacroCounter.Api/appsettings.json`.

## 2. Run the tests (no key or network needed)

```powershell
dotnet test backend --collect:"XPlat Code Coverage"   # xUnit; Claude is mocked; 100% on Nutrition/
cd frontend
npm ci
npm test -- --coverage                               # Vitest; 100% on src/domain/nutrition/
npx playwright install --with-deps                   # first time only
npm run e2e                                          # Playwright, desktop + 360px mobile, mocked /api
```

Expected: all tests pass, coverage thresholds pass, and no outbound calls to `api.anthropic.com`.

## 3. Run the app

**Development (hot reload)** uses two terminals:

```powershell
dotnet run --project backend/MacroCounter.Api        # http://localhost:5080
cd frontend; npm run dev                             # http://localhost:5173 (proxies /api)
```

**Single-process / phone on home Wi-Fi**:

```powershell
cd frontend; npm run build                           # outputs to backend/MacroCounter.Api/wwwroot
dotnet run --project backend/MacroCounter.Api --urls http://0.0.0.0:5080
```

Then open `http://<your-PC-LAN-IP>:5080` on the phone. Windows Firewall may ask you to allow the
port. Do not expose this port to the public internet (research R10).

## 4. Validation scenarios

Run these with the real key configured. Each scenario lists the spec items it covers.

| # | Steps | Expected | Covers |
|---|-------|----------|--------|
| V1 | Type "1 medium banana" and request an estimate | Shows kcal, protein, carbs and fat with units, an "AI estimate" label and the assumed portion. Nothing is saved yet | Story 1 #1, FR-003 |
| V2 | Confirm V1 | The entry appears and today's totals rise by exactly the shown values | Story 1 #2, SC-003 |
| V3 | New estimate, change protein, confirm | The edited value is saved; the source is `ai-edited` | Story 1 #3, FR-007 |
| V4 | Type "2 eggs, toast with butter, coffee with milk" | Per-item breakdown with a combined total | Story 1 #5, FR-004 |
| V5 | Type "asdf" | A "couldn't identify food" message, no estimate | Edge case |
| V6 | Photo of a plate (phone camera) plus the note "fried in oil" | Identified items with portions, editable/removable before confirming | Story 3, FR-002 |
| V7 | Reload the page / close and reopen the browser | Same entries and totals | Story 2 #2, SC-004 |
| V8 | Delete an entry; edit another's quantity | Totals update immediately and exactly | Story 2 #3–4, FR-010 |
| V9 | Set protein goal 150 g; log about 90 g protein | Main screen shows "90 / 150 g, 60 g left" without scrolling (phone and desktop) | Story 5, SC-009 |
| V10 | Open "Recent", pick a food, change the quantity, log | ≤ 3 interactions; macros scaled proportionally | Story 4, SC-005 |
| V11 | Stop the backend (or remove the key) and reload | AI entry is disabled with an explanation; manual entry still logs and updates totals | FR-008, SC-006 |
| V12 | Go to the previous day | That day's entries, totals and the goal in effect then; edits affect only that day | FR-012, FR-020 |
| V13 | Browser dev tools → Network during V1/V6 | The request body contains only the description, or the photo and note. The photo has no EXIF (check with an EXIF viewer) | FR-015 |
| V14 | Start an estimate, then press Cancel | The request is aborted and nothing is added | FR-016 |

Automated equivalents of V1–V5, V7–V12 and V14 run in step 2 against a mocked `/api`.
V6 and V13 need a real photo and must be checked by hand.
