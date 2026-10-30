# Implementation Plan: Splash Intro Animation

**Branch**: `claude/macro-counter-loading-graphic-5e85b1` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-splash-intro-animation/spec.md`

## Summary

When the app opens in a new browser session, show a full-screen intro that lasts 10 seconds on a black background:

- **Shuffle:** the letters of "Macro Counter" cycle through random typefaces.
- **Lit shapes:** shapes jump between letters during the shuffle.
- **Landing:** the last step puts a circle, square and diamond behind the M and both O's.
- **Flicker:** those three shapes flicker and settle at a dim glow.

People can skip the intro with a tap, click or key press. With reduced motion turned on, they see a still logo for at most 2 seconds instead.

The app mounts and loads underneath the overlay the whole time. This is how the intro is built:

- **Timeline:** a pure, seeded function produces the sequence of frames.
- **Component:** a small React component renders the current frame on timers.
- **Flicker:** the Web Animations API runs it from keyframe data, so it works under the app's strict CSP.
- **Fonts:** 13 subsetted, OFL-licensed woff2 files are served from the app's own origin and precached for offline use.
- **"Already played" flag:** kept in `sessionStorage` behind a small storage interface.

## Technical Context

**Language/Version**: TypeScript ~6.0 (frontend only), React 19.2

**Primary Dependencies**: existing only (React, Vite 8, vite-plugin-pwa). No new runtime dependencies.

- The animation uses CSS, the Web Animations API and timers.
- Fonts are static files. A one-time subsetting step uses `fonttools` as a dev-machine tool. It is not added to package.json; see [research.md](research.md) R2.

**Storage**: `sessionStorage` key `macro.introPlayed`, reached only through a new `IntroSession` interface (Principle III). No IndexedDB or schema change, and nothing on the server.

**Testing**:

- **Vitest + Testing Library**: unit tests for the timeline and flicker data, and component tests with fake timers.
- **Playwright e2e**: the full run, skipping, reduced motion, 360 px layout, and offline.

**Target Platform**: desktop and mobile browsers, plus the installed PWA.

**Project Type**: web application (`frontend/` SPA served by `backend/MacroCounter.Api`). This feature touches the frontend only.

**Performance Goals**:

- 60 fps on mid-range phones. Only `transform` and `opacity` are animated; layout changes happen only at frame steps, at most about every 300 ms.
- The intro adds no more than about 120 KB of font files (subsetted to the 10 distinct glyphs used: M a c r o C u n t e).

**Constraints**:

- **CSP:** `style-src 'self'` and `font-src 'self'` stay unchanged. No inline `<style>`, no style attributes in HTML, no third-party fonts. Dynamic values go through React `style` props (CSSOM) and `element.animate()`, which CSP allows.
- **Flashing:** the flicker has at most 3 flashes in any 1-second window (FR-008, WCAG 2.3.1).
- **Timing:** the handover happens at 10 s ± 0.5 s (SC-001).

**Scale/Scope**: one overlay component, one timeline module, one storage adapter, 13 font files, CSS, and an update to the e2e helper so existing specs skip the intro.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|-----------|--------|------------------------|
| I. Test-First | ✅ | Tasks write failing tests before code, in this order:<br>1. Unit tests: the timeline rules (FR-003–FR-009) and the flash-count rule.<br>2. Component tests: skip, the 10 s handover, reduced motion, the session flag, a hidden tab, and accessibility naming.<br>3. E2E: SC-001, SC-002, SC-004, SC-006 and the 360 px layout.<br>Existing e2e specs keep passing because they get the intro flag pre-set. |
| II. Correct Nutrition Math | ✅ N/A | No nutrition code is touched. |
| III. Local-First, Sync-Ready | ✅ | The "played" flag lives in `sessionStorage`, on the device only, and is reached only through the `IntroSession` interface. UI code never touches `sessionStorage` directly. It is not user data, so it needs no user-ID scope, record ID, timestamps, schema version or export. Nothing is sent to the server. |
| IV. Fast Logging | ✅ | It plays only once per session (FR-010) and can be skipped with one tap or key (FR-011), so a quick log costs at most one extra interaction (SC-005).<br>The skip button is 44×44 px or larger.<br>Sizing is checked at 360 px (FR-016).<br>It works with mouse, keyboard and touch.<br>The app keeps loading underneath (FR-017). |
| V. Simplicity | ✅ | No new runtime dependencies and no animation library. The platform APIs used are CSS, `element.animate` and `setTimeout`. One component and one pure module. |
| VI. AI Lookup | ✅ N/A | No AI calls. |
| VII. Security | ✅ | Authentication, sessions, endpoints and outbound calls are unchanged. The CSP stays exactly as it is: fonts are same-origin, and inline styles are applied only through CSSOM. No threat model is needed, because nothing here changes authentication, authorization, data exposure or external calls. Font files are committed static assets, so the supply-chain step is a license and provenance note in R2. |

**Gate result**: PASS. Nothing goes in Complexity Tracking.

**Post-design re-check**: Still PASS after Phase 1.

- No new runtime dependencies were added.
- Storage goes through the `IntroSession` interface.
- The CSP is unchanged.
- The flash limit is enforced by a unit test over the keyframe data, per research R4.
- All 19 existing e2e specs pre-set the session flag through the same code path a reload uses, so production code needs no test hook (R9).

## Project Structure

### Documentation (this feature)

```text
specs/005-splash-intro-animation/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── splash-intro.md  # UI + module contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code

```text
frontend/
├── public/fonts/intro/              # 13 subsetted .woff2 files + OFL.txt (licence texts, per family)
├── src/
│   ├── main.tsx                     # wraps the tree in <SplashGate> (outermost, above AuthGate)
│   ├── data/
│   │   └── introSession.ts          # IntroSession interface + sessionStorage adapter
│   └── features/splash/
│       ├── timeline.ts              # pure: buildIntroTimeline(rng) → frames; FLICKER_KEYFRAMES; typeface pool
│       ├── SplashGate.tsx           # decides whether to show the intro; renders children + overlay
│       ├── SplashIntro.tsx          # overlay: frame rendering, timers, skip, reduced motion, visibility
│       └── splash.css               # @font-face (font-display: swap), overlay, letter/shape styling
├── vite.config.ts                   # workbox globPatterns gains woff2 (offline, FR-015)
└── tests/
    ├── unit/splash/timeline.test.ts
    ├── components/SplashIntro.test.tsx
    ├── components/SplashGate.test.tsx
    └── e2e/
        ├── splash.spec.ts           # full run, skip, reduced motion, 360px, offline (uses base test)
        └── helpers.ts               # skipIntro(page): addInitScript sets macro.introPlayed for other specs
```

**Structure Decision**: this is a frontend-only change in the existing web-app layout.

- **Where the code lives:** the intro is a feature folder, `src/features/splash`. Its storage adapter sits with the other adapters in `src/data`.
- **Where it mounts:** `SplashGate` goes in `main.tsx` above `AuthGate`, so it covers the sign-in screen and the Today screen alike (acceptance scenario US1-6).
- **Backend:** no changes.

## Complexity Tracking

No violations.
