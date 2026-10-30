# Macro Counter

A protein-focused macro logger for desktop and phone browsers. Describe what you ate, or take a
photo, and Claude estimates calories, protein, carbs and fat. You review and confirm every estimate
before it is logged. It is invite-only: the owner adds each person, and everyone signs in with a
password and an authenticator app.

**Where data lives.** Your food log, saved foods and goals stay in your browser (IndexedDB), in a
database of your own account. Nobody else signing in on that browser can see them. The .NET backend
holds the Claude API key, validates AI responses, and stores **identity and security data only**:
accounts, sign-in sessions, AI usage counts and a security audit log. That store is PostgreSQL
(Supabase in production). It never receives your food log, photos or goals.

**What is sent to Claude.** Only the food description or photo (and its note) that you choose to
look up, sent to Claude, Anthropic's AI model. Your name, account, food log and goals are never
sent. The owner runs the server.

- `frontend/`: React 19 + TypeScript (Vite), installable as a PWA, works offline except AI lookup.
- `backend/`: ASP.NET Core (.NET 10) minimal API: sign-in and setup (`/api/auth/*`), `/api/health`,
  `/api/status`, `/api/estimates/text`, `/api/estimates/photo`.
- `specs/001-ai-macro-logging/`, `specs/002-add-photo-from-source/`, `specs/003-auth-security-foundations/`:
  specs, plans, data models, API contracts and validation scenarios.

**Splash intro.** The first time the app opens in a browser session, a 10-second intro plays: the
letters of "Macro Counter" shuffle through typefaces and land on the logo, with the M and both Os
flickering in lit shapes. It doesn't replay on reloads in the same tab. Any tap, click, Enter, Space
or Escape skips it, and with reduce motion turned on it shows a still logo for 2 seconds instead.
The app keeps loading underneath. Its 13 fonts are small subsets bundled with the app (no font
service); regenerate them as described in `frontend/public/fonts/intro/README.md`. Spec:
`specs/005-splash-intro-animation/`.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| .NET SDK | 10.x | `dotnet --list-sdks` |
| Node.js | 24.x | `node --version` |
| PostgreSQL | 17 or later, local (`winget install PostgreSQL.PostgreSQL.17`) | `psql --version` |
| Anthropic API key | | Only needed to run the real app. Tests never use it. |

First-time setup:

```powershell
cd frontend
npm ci
npx playwright install chromium
cd ..
dotnet tool restore
```

Point the tests and local scripts at your **local** PostgreSQL superuser. Run this in your own
terminal, so the password stays out of the repo and out of chats. Never use the Supabase database
here: the tests create and drop throwaway databases.

```powershell
setx MACROCOUNTER_TEST_PG "Host=localhost;Username=postgres;Password=<your local postgres password>"
```

Then create the local development identity database. This applies the migrations and stores the
app's connection string in User Secrets:

```powershell
.\scripts\dev-db.ps1
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

### First sign-in as the owner

Invite yourself in the local database and keep the one-time code it prints:

```powershell
psql -d macro_dev -c "select macro_admin.invite_user('<you>', 'owner');"
```

Open the app and enter your username and the code, leaving the authenticator field empty. Then
choose a password, add the app to an authenticator (QR code, setup key or link), and read the note
about what is sent to Claude. After that you sign in with your password and the 6-digit code.

**Adding, resetting or removing friends** happens in the database, never in the app. See the
[owner runbook](specs/003-auth-security-foundations/contracts/owner-procedures.md#owner-runbook-sc-011-each-task-takes-under-5-minutes):
`invite_user`, `reset_user`, `disable_user`, `enable_user`, `unlock_user` and `revoke_sessions`.

### Using it on your phone

Use the deployed HTTPS site ([docs/deploy.md](docs/deploy.md)). Signing in uses `Secure`, `__Host-`
cookies, which browsers only accept over HTTPS or on `localhost`. Opening the PC's address over
plain HTTP on the home network **no longer works**.

**Photos.** The photo step offers **Take photo** and **Choose existing photo** on every device:

- **Choose existing photo** opens the phone's photo library (or the file dialog on a PC).
- **Take photo** shows a live camera view inside the app wherever the browser allows it: on the PC at
  `http://localhost:5080`, or over HTTPS, including the deployed site on a phone.

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
- `ConnectionStrings:Identity`: the Supabase pooler connection as the `macro_app` role, with
  `SSL Mode=VerifyFull;Root Certificate=certs/supabase-root-ca.crt`
- `DataProtection:CertificatePfxBase64` and `DataProtection:CertificatePassword`
- `Anthropic:ApiKey`

The app refuses to start in Production if any of these is missing or permissive. The full guide is
[docs/deploy.md](docs/deploy.md).

## Tests and the merge gate

```powershell
.\scripts\check.ps1
```

It runs, in order, and stops at the first failure:

1. A locked NuGet restore, then `dotnet format` (no changes allowed)
2. Backend tests with 100% line/branch coverage on `Nutrition/`, against a throwaway local
   PostgreSQL database, running as the least-privilege app role
3. A NuGet vulnerability scan (any high or critical finding fails)
4. Frontend lint, type check, and unit and component tests with 100% coverage on `src/domain/`
5. An npm vulnerability scan (high or critical fails)
6. Playwright end-to-end tests at a desktop (1280×800) and phone (360×740) viewport, an offline test
   against the production build, and the sign-in, quota and CSP tests against the real backend
7. A secret scan of every tracked file and of the built app

Claude, Have I Been Pwned and Supabase are never contacted: every test uses mocks, fakes and the
local database. CI (`.github/workflows/ci.yml`) runs the same script, and `master` only accepts
changes that pass it.

### Accuracy check (optional, costs credits)

`scripts/accuracy-check.ps1` sends 20 common foods with known USDA calories to a running app and
reports how many estimates land within ±20% (target: at least 80%). It makes real API calls, so it
is opt-in and not part of `check.ps1`.
