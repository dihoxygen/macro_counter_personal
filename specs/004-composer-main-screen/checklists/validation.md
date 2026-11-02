# Validation: Composer Main Screen (004)

**Date**: 2026-10-29 · **Branch**: `claude/eager-goldberg-glbayv` · **Where**: cloud container (Linux, Chromium only)

## Automated

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npm test` (unit + component) | ✅ 630 passed, exit 0 |
| `src/domain/**` coverage | ✅ 100 % lines, branches, functions, including `proteinSegments` |
| `npm run build` | ✅ |
| Playwright `desktop`, `mobile`, `offline` (mocked API) | ✅ 63 passed, including `layout.spec.ts`, `keyboard.spec.ts`, `touch-targets.spec.ts` |
| Playwright `auth-desktop`, `auth-mobile`, `auth-quota` | ⚠️ **Not run.** They need PowerShell (`scripts/e2e-db.ps1`) and `MACROCOUNTER_TEST_PG`, which this container doesn't have. `auth/csp`, `auth/disable`, `auth/flows.ts` and `auth-quota/quota` were rewritten for the composer; they **must pass on the owner's machine** (`.\scripts\check.ps1`) before merging |

Playwright ran against the container's preinstalled Chromium through an uncommitted local config
(`playwright.local.config.ts`, which only sets `executablePath`), because the installed Playwright expected
a browser build that wasn't present.

## Manual checks (quickstart)

| Check | Result |
|-------|--------|
| **Phone keyboard** (FR-016): Android Chrome and the installed iOS Safari PWA keep the composer above the on-screen keyboard | ⚠️ **Not checked.** There's no real device here. Automated cover: the viewport has `interactive-widget=resizes-content` (layout spec), and the composer calls `scrollIntoView({ block: 'nearest' })` on focus (component test) |
| **Dark mode** (FR-017): matches the design tokens; text 4.5:1 | ✅ Screenshot at 360 px in emulated dark mode looks right. Token contrast (WCAG, calculated): text `#ececea` on `#1a1d1b` 14.4:1; muted `#a8a8a3` on `#1a1d1b` 7.1:1; warning text `#f2dd9a` on `#3a3014` 9.7:1; `#0d1f17` on accent `#5cc493` 8.0:1; accent on `#1a1d1b` 7.9:1. Not checked on a real device |
| **Camera off when leaving Today** (feature 002 rule) | ✅ Automated with Chromium's fake camera: `camera.spec.ts` ("leaving Today turns the camera off", via `liveTrackCount`) and `Composer.test.tsx` (h). The physical camera light wasn't checked |

## Found while validating

- On a phone, the sticky composer in Manual mode was 488 px tall and covered the log after a save. Fixed: the
  composer returns to Describe after a manual save when AI is available, and the sticky composer is capped at
  60vh (tests in `Composer.test.tsx` and `layout.spec.ts`).
- With a review card open on a 740 px phone, the card scrolls inside the composer (capped at 60vh) instead of
  covering the totals. Worth a look on a real phone: Confirm can be below the fold of the composer until you
  scroll it.
- `CameraCapture.test.tsx` › "starts the default camera if the preference cannot be read" failed once in about
  ten full-suite runs and never in isolation. That component and test are unchanged by this feature. Probably a
  timing-sensitive wait under load; not addressed here.
