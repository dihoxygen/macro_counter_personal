# Quickstart: Add Photo From Source

How to set up, run and validate the feature. Commands run from the repository root unless a step
says `cd frontend`. The project setup is the same as in the
[001 quickstart](../001-ai-macro-logging/quickstart.md); it is repeated here so this guide works on
its own.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| .NET SDK | 10.x (LTS) | `dotnet --list-sdks`. Get it from <https://dotnet.microsoft.com/download/dotnet/10.0> |
| Node.js | 24.x | `node --version` |
| Claude API key | | Needed only to run the real app (manual checks). Tests never use it |
| A webcam (desktop) and a phone | | Needed only for the manual checks below |

## 1. Install dependencies (once per checkout or worktree)

```powershell
cd frontend
npm ci                                  # installs the locked frontend packages
npx playwright install chromium         # browsers for the e2e tests (first time on a machine)
cd ..
dotnet restore backend                  # optional: dotnet test/run also restore on first use
```

- A new git worktree has no `frontend/node_modules`, so run `npm ci` in every new checkout.
- Install Chromium with the command above, **not** with `--only-shell`. The camera e2e tests use the
  full Chromium build (`channel: 'chromium'` in `frontend/playwright.config.ts`), because the
  lightweight headless shell rejects `getUserMedia` with `NotSupportedError`. On Linux CI, use
  `npx playwright install --with-deps chromium` to also install the system libraries.
- Line endings: `.gitattributes` makes git check out text files with LF, which `dotnet format` (the
  first merge-gate step) requires. A checkout made before `.gitattributes` existed may still have CRLF
  files. Re-check them out once with `git rm --cached -r -q . ; git reset --hard` (this discards
  uncommitted changes, so commit or set them aside first).

## 2. Configure the API key (once, by you; only for the real app)

Run this in **your own terminal**. Do not paste the key into Claude Code or commit it anywhere:

```powershell
dotnet user-secrets init --project backend/MacroCounter.Api   # only if not already initialized
dotnet user-secrets set "Anthropic:ApiKey" "<your-key>" --project backend/MacroCounter.Api
```

The key is stored under `%APPDATA%\Microsoft\UserSecrets\`, outside the repo. Without it the app
still runs, but AI lookup shows as unavailable.

## 3. Automated checks (no key or network needed)

Make sure nothing else is listening on ports 5173 or 4173 (for example a dev server from another
checkout). Playwright reuses an existing server outside CI and would test that checkout's code
instead. Setting `$env:CI='1'` makes it fail loudly instead of reusing one.

```powershell
.\scripts\check.ps1          # full merge gate (format, backend, lint, unit/component, e2e)
cd frontend
npx vitest run tests/unit/media tests/components/AddFoodPhoto.test.tsx tests/components/CameraCapture.test.tsx
npx playwright test log-photo camera
```

Playwright's desktop (1280×800) and mobile (360×740) projects run Chromium with
`--use-fake-device-for-media-stream`, so a synthetic camera exists ([research R8](./research.md#r8-testing-the-camera-without-a-camera-principle-i)).
`/api` is mocked and nothing reaches Claude.

## Validation scenarios

| ID | Scenario | Covered by | Expected |
|----|----------|-----------|----------|
| P1 | Photo step shows **Take photo** and **Choose existing photo**; nothing prompts for camera on load | component + e2e (both viewports) | Both buttons visible and ≥ 44 px; no `getUserMedia` call until Take photo is pressed (FR-001, FR-008) |
| P2 | Choose existing photo uses an input **without** `capture` | component | `Existing photo file` has `accept="image/*"` and no `capture` attribute (FR-002) |
| P3 | Library photo → preview → Estimate → confirm | e2e with the GPS-tagged fixture | Preview shown; upload is JPEG, long edge ≤ 1568, **no EXIF**; totals update as in 001 V6 (FR-010, FR-011, SC-006) |
| P4 | Replace and Remove | component | Replace keeps the old photo until the new one decodes; Remove returns to empty; old preview URL revoked |
| P5 | Cancel the picker | component | No error; state unchanged (US1 AS5) |
| P6 | Non-image / undecodable file | component + e2e (`.txt` file) | "This photo couldn't be used…" at selection; `estimateFromPhoto` never called (FR-012) |
| P7 | Live camera → snapshot → preview → Estimate | e2e, camera granted | Preview video plays; after snapshot, all tracks `ended`; upload is a JPEG ≤ 1568 px (US2, FR-003, FR-005) |
| P8 | Retake | component + e2e | Still discarded, new session started, camera live again (US2 AS3) |
| P9 | Camera turns off: Cancel, switch to Describe mode, navigate away, page hidden | e2e (hiding is emulated with `page.evaluate`: override `document.visibilityState` to `'hidden'` and dispatch `visibilitychange`) | Every recorded track `readyState === 'ended'` within 2 s; hidden shows "Camera paused" + Resume (FR-007, SC-004) |
| P10 | Switch camera | component (fake with 2 devices) | Button appears only with ≥ 2 cameras; old session stopped before the new one starts (FR-006) |
| P11 | Camera errors: denied, no camera, in use, unsupported, disconnected | unit (`describeCameraError`) + component (fake rejects or emits ended) + e2e (permission not granted) | Specific message; Choose existing photo still works end to end (FR-009, SC-005) |
| P12 | Insecure context fallback | unit (`supportFrom`) + component (`camera-app` support) | Take photo opens the `Camera app photo file` input; hint "Opens your device's camera app." (FR-004) |
| P13 | No camera hardware | component (`no-camera` support) | Take photo disabled with the reason; library still works |
| P14 | Keyboard only | e2e | Tab reaches every control; Enter/Space activates; snapshot works without a pointer (FR-015) |
| P15 | 001 recovery still works for every source | component | Cancel during analysis, Retry (same JPEG, no re-decode), Describe in text, Enter manually (FR-016) |

## Manual checks on real devices (SC-001, SC-002, SC-003, SC-007)

These need the API key (step 2) and a production build served by the backend:

```powershell
cd frontend; npm run build; cd ..                                          # writes the app into backend/MacroCounter.Api/wwwroot
dotnet run --project backend/MacroCounter.Api                              # desktop: http://localhost:5080
dotnet run --project backend/MacroCounter.Api --urls http://0.0.0.0:5080   # phone on home Wi-Fi: http://<PC-IP>:5080
```

Find the PC's LAN IP with `ipconfig`. Windows Firewall may ask to allow the port; allow it for
**private** networks only, and never expose the port to the internet (the backend has no login yet).
For development with hot reload, run `dotnet run --project backend/MacroCounter.Api` and, in a second
terminal, `cd frontend; npm run dev` (http://localhost:5173, proxies `/api`).

1. **Phone over LAN HTTP** (`http://<PC-IP>:5080`), on Android Chrome and, if available, iOS Safari:
   - Choose existing photo → the system photo library opens → pick a meal photo → preview is upright
     → Estimate → Confirm. Count interactions from the main screen to Estimate: Add food, Photo,
     Choose existing photo, select in the picker, Estimate = **5** or fewer (SC-001).
   - Take photo → the hint says the camera app opens → the device camera app opens with the rear
     camera → the photo returns as the preview.
   - Pick a HEIC photo on a browser that can't decode it → "This photo couldn't be used."
2. **Desktop with a webcam** at `http://localhost:5080` (Edge or Chrome, plus Firefox):
   - Take photo → permission prompt → live preview within **3 s** (SC-003) → Take snapshot → the
     webcam light goes off → Estimate. Time from opening the photo step to Estimate is **< 20 s**
     (SC-002).
   - Deny permission once → the blocked message appears → Choose existing photo still logs a meal.
   - Open the webcam in another app first (Windows Camera) → the "in use" message appears.
   - Unplug a USB webcam while it's live → the "disconnected" message appears.
   - Minimize the window while live → the webcam light goes off; back in the app it shows "Camera
     paused" → Resume.
3. **Optional: live camera on a phone over LAN HTTPS** ([research R7](./research.md#r7-serving-securely-so-the-live-camera-works-spec-assumptions)).
   Create a certificate for the PC's LAN IP with a local CA (for example `mkcert <PC-IP>`), install
   the CA's root certificate on the phone, then:

   ```powershell
   $env:Kestrel__Certificates__Default__Path = "<cert>.pem"
   $env:Kestrel__Certificates__Default__KeyPath = "<cert>-key.pem"
   dotnet run --project backend/MacroCounter.Api --urls https://0.0.0.0:5443
   ```

   Open `https://<PC-IP>:5443` on the phone. Take photo now shows the in-app preview with the rear
   camera, and Switch camera toggles front and rear. Keep the certificate files outside the repo.

## Validation results

### 2026-10-14: phone over LAN HTTP (`http://192.168.1.30:5080`, production build)

All checks below were done on the phone (mobile browser).

| Check | Result |
|-------|--------|
| Choose existing photo opens the photo library; a photo taken earlier loads, previews and gets a Claude estimate (US1, FR-002, SC-006) | ✅ Pass |
| Opening the picker and backing out without choosing returns to the photo step with no error (US1 AS5) | ✅ Pass |
| Interaction count from the main screen to Estimate is 5 or fewer (SC-001) | ✅ Pass: 4 interactions |
| Take photo opens the phone's camera app over HTTP (FR-004) | ✅ Pass |
| HEIF photo is decoded and estimated | ✅ Pass |
| HEIC photo is decoded or rejected with "This photo couldn't be used" | Not tested: no HEIC photos on the phone |
| Phone and browser used | Not recorded |

### 2026-10-14: desktop, Chrome, `http://localhost:5080`

| Check | Result |
|-------|--------|
| Desktop opened at `http://192.168.1.30:5080` (LAN address): Take photo opened the file dialog, the same as Choose existing photo | Expected: the LAN address is not a secure context on the PC either, so the live camera is blocked. Use `http://localhost:5080` on the PC |
| At `http://localhost:5080`, the photo step first showed only the old single file box | Chrome showed the feature 001 version cached by the service worker. Fixed by reloading. DevTools → Application → Service workers → Unregister also works. See the note below |
| Live preview appears after allowing the camera | ✅ Pass |
| First start showed a black preview; Switch camera showed the webcam | ❌ Fixed. Chrome listed the virtual camera "Camera (NVIDIA Broadcast)" before the "c922 Pro Stream Webcam" and opened it first. The app now remembers the camera of the last snapshot (FR-017, tasks T037–T039) |
| Recheck: after a snapshot with the C922, a new visit still opened NVIDIA Broadcast | ❌ Fixed. Diagnosed in the DevTools console: the new build was loaded and the saved camera was the C922, but Chrome ignored `deviceId: { ideal }`. The remembered camera is now requested with `exact`, falling back to the default only if it's gone (task T040). Recheck pending |

**Testing after a rebuild:** at `localhost`, the service worker can keep serving the previous build
for a load or two. If the photo step looks out of date, reload, or unregister the service worker in
DevTools. The LAN address never has a service worker, so it always shows the latest build.

### Still to do

- Desktop webcam checks (manual check 2): recheck the remembered camera (switch to the C922, take a snapshot, reload, Take photo should open the C922), preview within 3 s (SC-003), time to Estimate under 20 s (SC-002), webcam light off after snapshot and when minimized, permission denied, camera in use, unplugged camera.
- Optional: in-app live camera on the phone over LAN HTTPS (manual check 3).
