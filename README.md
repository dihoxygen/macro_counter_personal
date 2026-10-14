# Macro Counter

A protein-focused macro logger for desktop and phone browsers. Describe what you ate, or take a
photo, and Claude estimates calories, protein, carbs and fat. You review and confirm every estimate
before it is logged. Your data stays in your browser (IndexedDB). The small .NET backend only holds
the Claude API key and validates AI responses; it stores nothing.

- `frontend/`: React 19 + TypeScript (Vite), installable as a PWA, works offline except AI lookup.
- `backend/`: ASP.NET Core (.NET 10) minimal API: `/api/status`, `/api/estimates/text`, `/api/estimates/photo`.
- `specs/001-ai-macro-logging/`: the spec, plan, data model, API contracts and validation scenarios.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| .NET SDK | 10.x | `dotnet --list-sdks` |
| Node.js | 24.x | `node --version` |
| Anthropic API key | | Only needed to run the real app. Tests never use it. |

First-time setup:

```powershell
cd frontend
npm ci
npx playwright install chromium
```

## Set the API key

Run this **in your own terminal**. Never commit the key, put it in a file in this repo, or paste it
into a chat or an AI assistant:

```powershell
dotnet user-secrets set "Anthropic:ApiKey" "<your-key>" --project backend/MacroCounter.Api
```

User Secrets live outside the repo (`%APPDATA%\Microsoft\UserSecrets\`). Without a key the app
still runs: AI lookup shows as unavailable and manual entry works.

## Run

**Development** (hot reload, two terminals):

```powershell
dotnet run --project backend/MacroCounter.Api   # API on http://localhost:5080
cd frontend; npm run dev                        # app on http://localhost:5173, proxies /api
```

**Single process** (what you use day to day):

```powershell
cd frontend; npm run build                      # writes the app into backend/MacroCounter.Api/wwwroot
cd ..; dotnet run --project backend/MacroCounter.Api
```

Open http://localhost:5080.

### Using it on your phone

On the same home Wi-Fi network:

```powershell
dotnet run --project backend/MacroCounter.Api --urls http://0.0.0.0:5080
```

Then open `http://<your-PC's-LAN-IP>:5080` on the phone (find the IP with `ipconfig`). Windows
Firewall may ask you to allow the port; allow it for **private** networks only.

> **Do not expose this port to the internet.** The backend has no login. Anyone who can reach it can
> spend your Anthropic credits.

Note: browsers only install PWAs and keep service workers over HTTPS or `localhost`, so offline mode
works on the PC itself; on the phone over plain HTTP the app works while connected.

**Photos.** The photo step offers **Take photo** and **Choose existing photo** on every device:

- **Choose existing photo** opens the phone's photo library (or the file dialog on a PC).
- **Take photo** shows a live camera view inside the app wherever the browser allows it: on the PC at
  `http://localhost:5080`, or over HTTPS. Browsers block the in-app camera over plain HTTP, so on the
  phone over the LAN, Take photo opens the phone's own camera app instead.
- To try the in-app camera on the phone, serve the app over LAN HTTPS with a locally trusted
  certificate. The steps are in
  [the feature 002 quickstart](specs/002-add-photo-from-source/quickstart.md#manual-checks-on-real-devices-sc-001-sc-002-sc-003-sc-007)
  (manual check 3).

## Change the model

The model is configured in exactly one place, `backend/MacroCounter.Api/appsettings.json`:

```json
"Anthropic": { "Model": "claude-opus-5-5", "Effort": "medium" }
```

Change `Model` (for example to `claude-sonnet-5-5` for lower cost) or `Effort` (`low` to `max`) and
restart the backend.

## Production configuration

`backend/MacroCounter.Api/appsettings.Production.json` ships with placeholders that **must** be
overridden on the host (App Settings or environment variables). Never put real values in the
repository:

- `AllowedHosts`: the real host name (never `*`)
- `Security:AllowedOrigins:0`: the app's own `https://` origin

The full deployment guide is `docs/deploy.md` (added later in feature 003).

## Tests and the merge gate

```powershell
.\scripts\check.ps1
```

It runs, in order, and stops at the first failure:

1. `dotnet format` (no changes allowed)
2. Backend tests with 100% line/branch coverage on `Nutrition/`
3. Frontend lint and type check
4. Frontend unit and component tests with 100% coverage on `src/domain/`
5. Playwright end-to-end tests at a desktop (1280×800) and phone (360×740) viewport, plus an
   offline test against the production build

Claude is mocked everywhere; the test suite never calls the Anthropic API. Merge a branch into
`master` only when `check.ps1` passes.

### Accuracy check (optional, costs credits)

`scripts/accuracy-check.ps1` sends 20 common foods with known USDA calories to a running app and
reports how many estimates land within ±20% (target: at least 80%). It makes real API calls, so it
is opt-in and not part of `check.ps1`.
