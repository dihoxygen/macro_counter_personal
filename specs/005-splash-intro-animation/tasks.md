---

description: "Task list for the Splash Intro Animation feature"
---

# Tasks: Splash Intro Animation

**Input**: Design documents from `specs/005-splash-intro-animation/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/splash-intro.md](contracts/splash-intro.md), [quickstart.md](quickstart.md)

**Tests**: Required. Constitution Principle I is non-negotiable test-first, so every test task comes before the code it covers and must be seen failing first.

**Organization**: Tasks are grouped by user story: US1 is the intro, US2 is skipping, US3 is reduced motion.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on unfinished tasks)
- **[Story]**: US1, US2 or US3, from spec.md
- All paths are relative to the repository root. This feature touches only `frontend/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Font assets and offline caching that every story needs.

- [X] T001 Create subsetted font files in `frontend/public/fonts/intro/`.
  - **Source:** download the regular TTFs from the google/fonts GitHub repository (`ofl/<family>/`) for the 13 typefaces in research R2:
    - Inter 800
    - Playfair Display 700 italic
    - Bungee
    - Kaushan Script
    - Space Mono 700
    - Abril Fatface
    - Pacifico
    - Monoton
    - UnifrakturMaguntia
    - Bebas Neue
    - Cinzel 700
    - Rubik Mono One
    - Lobster
  - **Subset:** run `pyftsubset <file>.ttf --text="MacroCunte " --flavor=woff2 --output-file=<id>.woff2` for each one.
  - **File names (ids):** `inter-800`, `playfair-700i`, `bungee`, `kaushan`, `spacemono-700`, `abril`, `pacifico`, `monoton`, `unifraktur`, `bebas`, `cinzel-700`, `rubikmono`, `lobster`.
  - **Record:** write `frontend/public/fonts/intro/README.md` with the source URLs, the exact command and the commit SHA of google/fonts used.
  - **Size:** check that the total is ≤ 120 KB.
- [X] T002 [P] Add `frontend/public/fonts/intro/OFL.txt`. It holds the SIL Open Font License 1.1 text once, followed by each family's copyright line, taken from the `OFL.txt` in its google/fonts folder (research R2).
- [X] T003 [P] In `frontend/vite.config.ts`, change `workbox.globPatterns` to `'**/*.{js,css,html,svg,png,webmanifest,woff2}'` so the intro fonts are precached for offline use (FR-015).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure timeline, the session-flag adapter, and the e2e bypass. All three stories depend on these.

**⚠️ CRITICAL**: T009 must be merged before T016 wires the overlay into `main.tsx`. Otherwise the existing e2e specs hit a 10 s overlay that blocks clicks.

- [X] T004 [P] Write failing unit tests in `frontend/tests/unit/data/introSession.test.ts` for `browserIntroSession(storage)`:
  - `hasPlayed()` is `false` on fresh storage.
  - After `markPlayed()`, `hasPlayed()` is `true`, and the storage holds key `macro.introPlayed` with value `'1'`.
  - A storage whose `getItem` and `setItem` throw makes `hasPlayed()` return `false` and `markPlayed()` do nothing without throwing.
- [X] T005 Implement `frontend/src/data/introSession.ts`: the `IntroSession` interface (`hasPlayed(): boolean; markPlayed(): void`) and `browserIntroSession(storage: Storage = window.sessionStorage)`, wrapped in try/catch as data-model.md describes. It must make T004 pass, and it is the only file that touches `sessionStorage` (Principle III).
- [X] T006 [P] Write failing unit tests in `frontend/tests/unit/splash/timeline.test.ts` for `buildIntroTimeline(rng)`. Use a small seeded PRNG (mulberry32) defined in the test, and run the rules across 1,000 seeds. Assert each data-model rule as written:
  - "Frame 0 (`at: 0`) has no visible letters."
  - "Frame 1: only indices {0, 2, 6} are visible. Index 0 uses typeface 0, indices 2 and 6 use typeface 1, and no shapes are shown." (`at` 500)
  - "Frame 2: only the vowels are visible, each in a random typeface. No shapes." (vowels {1, 4, 7, 8, 11}, `at` 1700)
  - "There are at least 5 shift frames between frame 2 and the final frame. Each shift draws typefaces at random, and its shapes go only on visible letters, never on the space."
  - "The final frame shows all letters. The 12 letters use 12 distinct typefaces. Shapes sit on exactly {0, 4, 7}, and those three shapes are one each of circle, square and diamond."
  - "The final frame's `at` is at most 7,500 ms."
  - Every frame has 13 letters, `at` values strictly increase, and only the last frame has `final: true`.
  - `INTRO_DURATION_MS === 10000`, `REDUCED_MOTION_DURATION_MS === 2000` and `TYPEFACES.length === 13`. `TYPEFACES[0]` is Inter 800 and `TYPEFACES[1]` is Playfair Display 700 italic.
  - `finalFrame(rng)` satisfies the final-frame rules.
  - 10 consecutive timelines built with `Math.random` don't all share the same typeface sequence (SC-003).
- [X] T007 [P] Write failing unit tests in the same folder, `frontend/tests/unit/splash/flicker.test.ts`, for the flicker data:
  - `FLICKER_KEYFRAMES` starts at `{ offset: 0, opacity: 1 }` and ends at `{ offset: 1, opacity: 0.55 }`, with offsets that don't decrease.
  - `countFlashes(FLICKER_KEYFRAMES, 2800, 1000) <= 3`. A flash is "a dip below opacity 0.4 followed by a recovery above 0.7".
  - `countFlashes` returns 5 for a known curve with five dips inside one second (the canvas's original flicker), which proves the counter can fail.
  - The curve has at least 5 flashes over its full 2.8 s, so it still reads as a failing bulb.
- [X] T008 Implement `frontend/src/features/splash/timeline.ts` to the [contract](contracts/splash-intro.md):
  - **Constants:** `WORD`, `SPACE_INDEX`, `BULB_INDICES`, `INTRO_DURATION_MS`, `REDUCED_MOTION_DURATION_MS`, `FLICKER_DURATION_MS`.
  - **`TYPEFACES`:** 13 entries `{ id, family, weight, style }`, with ids matching T001's file names.
  - **Types:** `IntroFrame` and `LetterState`.
  - **`buildIntroTimeline(rng)`:** frames at 0, 500, 1700, 2900, 3500, 4100, 4700, 5300, 5900, 6500, 6900 and 7200 ms (research R3).
    - Shift frames show 1–3 shapes on random visible letters.
    - Visibility patterns: all letters; a random ~65% subset; consonants {0, 2, 3, 6, 9, 10, 12}; M plus vowels.
  - **`finalFrame(rng)`:** a shuffled pick of 12 distinct typefaces, and shuffled circle/square/diamond on {0, 4, 7}.
  - **`FLICKER_KEYFRAMES`:** dips near 150, 500, 900, 1300, 1650, 2050 and 2450 ms, each at least 340 ms apart (research R4).
  - **`countFlashes`.**

  It must make T006 and T007 pass. No React or DOM imports.
- [X] T009 *(Done as a shared fixture instead: `frontend/tests/e2e/test.ts` exports a `test` whose `context` pre-sets the flag for every page, and all 19 specs import it. Same effect, and new pages in a context are covered automatically.)* Add `export async function skipIntro(page: Page)` to `frontend/tests/e2e/helpers.ts`. It calls `page.addInitScript(() => sessionStorage.setItem('macro.introPlayed', '1'))`.
  - Call it before the first `page.goto` in every existing spec under `frontend/tests/e2e/`:
    - top level: `camera`, `goal`, `keyboard`, `layout`, `log-photo`, `log-text`, `offline`, `recent`, `totals-persistence`, `touch-targets`
    - every spec in `auth/` and `auth-quota/`
  - Use the spec's `beforeEach` when it has one. Where a spec opens extra pages or contexts, call it for each new page too.
  - Run `npx playwright test` to confirm the suite is still green (research R9).

**Checkpoint**: The timeline, session flag and e2e bypass are ready, and the existing suite is unaffected.

---

## Phase 3: User Story 1 - See the branded intro when the app opens (Priority: P1) 🎯 MVP

**Goal**: A new session shows the 10-second intro on black. The shapes are part of the shuffle and land on the M and O's. The flicker settles dim, and then the person reaches their normal first screen.

**Independent Test**: Open the app in a new tab and watch. The sequence matches FR-003 to FR-008, and the sign-in or Today screen appears at 10 s. Reloading the tab skips the intro.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [X] T010 [P] [US1] Write failing component tests in `frontend/tests/components/SplashIntro.test.tsx`. Use `vi.useFakeTimers()` and frames from `buildIntroTimeline(seeded rng)`, and stub `HTMLElement.prototype.animate` with `vi.fn()`. Assert:
  - The overlay has `role="img"`, the accessible name "Macro Counter" and `data-testid="splash-intro"`.
  - There are 13 `[data-testid="splash-letter"]` elements, all `aria-hidden="true"`.
  - After `advanceTimersByTime(500)`, only indices 0, 2 and 6 have `data-visible="true"`.
  - At 1700 ms only the vowels are visible.
  - At 7200 ms all letters are visible, `data-shape` is set only on 0, 4 and 7, and the 12 `data-typeface` values are distinct.
  - `animate` is called on each `[data-flicker="true"]` element with `FLICKER_KEYFRAMES` and `{ duration: 2800, fill: 'forwards' }`.
  - `onDone` is called exactly once, at 10,000 ms and not at 9,999.
  - Unmounting before the end clears the timers, so `onDone` isn't called.
  - A `visibilitychange` event with `document.hidden === true` calls `onDone` at once.
  - Without the `animate` stub (jsdom has none), rendering the final frame doesn't throw.
- [X] T011 [P] [US1] Write failing component tests in `frontend/tests/components/SplashGate.test.tsx`:
  - With `play={false}`, the children render and there is no overlay.
  - With `play={true}`, the children render inside an element with the `inert` attribute and the overlay is present.
  - After 10,000 ms of fake time, the overlay is gone, `inert` is removed, the children are still the same mounted instances (a stateful child keeps its state) and `document.activeElement === document.body`.
  - Rendering inside `<StrictMode>` with `play={true}` still shows the overlay.
- [X] T012 [P] [US1] Write a failing e2e spec, `frontend/tests/e2e/splash.spec.ts`. It does not call `skipIntro`, and mocks the API signed out via `mockApi`. Cover:
  - **Full run:** from `goto('/')`, the overlay is visible within 1 s, with letters 0, 2 and 6 visible. At about 8 s the final frame has shapes on 0, 4 and 7. The overlay is gone and the sign-in screen is visible by 10.5 s (SC-001).
  - **Reload:** the overlay doesn't appear (FR-010).
  - **New session:** a new page in a new browser context shows the overlay again.
  - **360 × 800 viewport, 5 runs in fresh contexts:** at the final frame, `document.documentElement.scrollWidth <= innerWidth`, and every `[data-testid="splash-letter"]` bounding box lies within the viewport (FR-016).
  - **CSP:** no console errors containing "Content Security Policy" during a full run.

### Implementation for User Story 1

- [X] T013 [US1] Create `frontend/src/features/splash/splash.css` (research R1, R8):
  - **Fonts:** 13 `@font-face` rules, each `font-family` matching `TYPEFACES[i].family`, with `src: url('/fonts/intro/<id>.woff2') format('woff2')`, the matching `font-weight` and `font-style`, and `font-display: swap`.
  - **Overlay:** `.splash` is `position: fixed; inset: 0; z-index: 1000; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center`.
  - **Logo row:** `.splash-logo` is `display: flex; flex-wrap: nowrap; align-items: center; font-size: min(104px, calc((100vw - 32px) / 12.6)); line-height: 1.2`.
  - **Letters:** `.splash-letter` is `color: #F2F2F2`.
  - **Bulb letters:** `.splash-letter--lit` is `color: #FFD58A` with `text-shadow: 0 0 0.12em #FFD58A, 0 0 0.33em #FFD58A, 0 0.1em 0.13em rgba(0,0,0,.85)` and `font-size: 0.79em`.
  - **Shape box:** `.splash-box` is `position: relative; display: inline-flex; align-items: center; justify-content: center; width: 1.27em; height: 1.27em; margin: 0 0.12em`.
  - **Box layers**, as on the design canvas:
    - `.splash-shell`: absolute, `#0D0D0D`, `2px solid #262626`, `box-shadow: inset 0 -12px 26px rgba(0,0,0,.9), inset 0 8px 18px rgba(255,255,255,.04), 0 28px 30px -12px #000`.
    - `.splash-light`: absolute, `radial-gradient(circle at 50% 45%, #FFD58A66 0%, #FFD58A22 45%, transparent 75%)`, border `#FFD58A66`, `box-shadow: 0 0 36px #FFD58A55, inset 0 0 22px #FFD58A44`.
    - `.splash-pool`: absolute, `left/right: -0.23em; bottom: -0.5em; height: 0.35em`, `radial-gradient(ellipse at center, #FFD58A55 0%, #FFD58A18 45%, transparent 72%)`.
  - **Shape variants:**
    - `--circle`: `border-radius: 50%; inset: 0`
    - `--square`: `border-radius: 14px; inset: 4px`
    - `--diamond`: `border-radius: 12px; inset: 0.19em; transform: rotate(45deg)`
  - **Pop:** `@keyframes splash-popA` and `splash-popB`, both 180 ms, from `scale(.55)` and opacity 0 to `scale(1.1)` and then none, on `.splash-pop-a` and `.splash-pop-b`.
  - **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables the pop animations.
- [X] T014 [US1] Implement `frontend/src/features/splash/SplashIntro.tsx` to the [contract](contracts/splash-intro.md). Import `./splash.css`.
  - **Frames:** a `setTimeout` per `frames[i].at` advances the current frame, plus one at `INTRO_DURATION_MS` (or `REDUCED_MOTION_DURATION_MS`) that calls `onDone` once.
  - **Letters:** render 13 `splash-letter` spans with `data-index`, `data-typeface`, `data-visible` and `data-shape`. Set `fontFamily`, `fontWeight`, `fontStyle` and `visibility` through the React `style` prop only, never a `style` attribute string (CSP, R1).
  - **Pop class:** alternate the pop class by frame index so the animation restarts on each step.
  - **Boxed letters:** render pool, shell and light layers plus the glyph. In the final frame, the pool, light and glyph carry `data-flicker="true"`. A `useEffect` calls `el.animate(FLICKER_KEYFRAMES, { duration: FLICKER_DURATION_MS, fill: 'forwards', delay: k * 170 })` for each bulb `k`, guarded with `typeof el.animate === 'function'`.
  - **Hidden tab:** a `visibilitychange` listener calls `onDone`.
  - **Clean-up:** clear all timers and listeners on unmount.

  It must make T010 pass.
- [X] T015 [US1] Implement `frontend/src/features/splash/SplashGate.tsx`:
  - **Props:** `play`, `rng = Math.random`, `reducedMotion`, and `children`.
  - **State:** `useState(play)` holds `showing`. The frames are built once with `useState(() => buildIntroTimeline(rng))`.
  - **While showing:** render `<div inert>{children}</div>` plus `<SplashIntro … onDone={() => { setShowing(false); (document.activeElement as HTMLElement | null)?.blur(); }} />`.
  - **After:** render `<div>{children}</div>`. Keep the same wrapper element type in both cases so the children never remount (FR-012).

  It must make T011 pass.
- [X] T016 [US1] Wire it up in `frontend/src/main.tsx`:
  - Import `browserIntroSession` and `SplashGate`.
  - Before `createRoot`, compute `const introSession = browserIntroSession(); const playIntro = !introSession.hasPlayed(); if (playIntro) introSession.markPlayed();`.
  - Wrap `<ServicesProvider>…</ServicesProvider>` in `<SplashGate play={playIntro}>` inside `<StrictMode>`.
  - Comment why the decision is made outside React (StrictMode runs state initializers twice).
  - Then run T012 and see it pass.

**Checkpoint**: The MVP is complete. The intro plays once per session and hands over at 10 s.

---

## Phase 4: User Story 2 - Get to the app without waiting (Priority: P2)

**Goal**: One tap, click or key press, or the labelled Skip button, ends the intro at once.

**Independent Test**: Open the app in a new tab and tap during the intro. The normal first screen appears within 0.5 s, in the same state.

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] Add failing tests to `frontend/tests/components/SplashIntro.test.tsx`:
  - A button with the accessible name "Skip intro" exists and is `document.activeElement` after mount.
  - Clicking it calls `onDone` once.
  - `pointerdown` on the overlay calls `onDone`.
  - `keydown` on `window` with `Enter`, `' '` (Space) or `Escape` each calls `onDone`, while `'a'` does not.
  - After unmount, a `keydown` Escape doesn't call `onDone` again (the listener is removed).
- [X] T018 [P] [US2] Add failing e2e tests to `frontend/tests/e2e/splash.spec.ts`:
  - At about 3 s, `page.mouse.click(10, 10)`: the overlay is hidden within 500 ms and the sign-in screen is visible (SC-002).
  - In a new context, pressing `Escape` gives the same result.
  - In a new context, Tab focuses "Skip intro" (it already has focus) and Enter skips.
  - At 360 px wide, the Skip button's bounding box is at least 44×44 (Principle IV).

### Implementation for User Story 2

- [X] T019 [US2] Add skip handling to `frontend/src/features/splash/SplashIntro.tsx`:
  - a `<button type="button" className="splash-skip">Skip intro</button>`, focused in a mount effect, whose `onClick` calls `onDone`
  - `onPointerDown` on the overlay root calls `onDone`
  - a `window` `keydown` listener for Enter, Space and Escape (`preventDefault` on Space), removed on unmount
  - a guard so `onDone` fires only once
  - the skip button sits outside the `role="img"` element, so it stays reachable: wrap the img and the button in a plain container

  In `frontend/src/features/splash/splash.css`, style `.splash-skip`: `position: absolute; top: 24px; right: 16px; min-width: 44px; min-height: 44px; padding: 0 18px; border-radius: 22px; border: 1px solid #3A3A3A; background: transparent; color: #BDBDBD; font: 600 14px/1 system-ui, sans-serif`, plus a visible `:focus-visible` outline in `#FFD58A`.

  It must make T017 and T018 pass.

**Checkpoint**: US1 and US2 both work. The intro can always be skipped.

---

## Phase 5: User Story 3 - Intro that respects reduced-motion settings (Priority: P3)

**Goal**: With reduced motion on, show a still final logo for at most 2 s, then hand over. Skip still works.

**Independent Test**: Turn on reduce motion and open a new tab. A still logo shows, with no shuffle or flicker, and the app appears within 2 s.

### Tests for User Story 3 ⚠️

- [X] T020 [P] [US3] Add failing tests to `frontend/tests/components/SplashGate.test.tsx`:
  - With `play` and `reducedMotion={true}`, the overlay renders the final frame immediately: all letters visible and shapes on 0, 4 and 7.
  - The stubbed `animate` is never called.
  - The overlay is gone at 2,000 ms and still present at 1,999 ms.
  - "Skip intro" still ends it.
  - With `reducedMotion` left undefined, the gate reads `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. Stub `matchMedia` to return `true` and assert the reduced path.
- [X] T021 [P] [US3] Add a failing e2e test to `frontend/tests/e2e/splash.spec.ts`. Use `page.emulateMedia({ reducedMotion: 'reduce' })` before `goto('/')`. Assert the overlay shows letters with `data-shape` on 0, 4 and 7 within 500 ms, and that it is gone and the sign-in screen visible by 2.5 s (SC-004).

### Implementation for User Story 3

- [X] T022 [US3] Update `frontend/src/features/splash/SplashGate.tsx`:
  - Resolve `reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false` once, on first render.
  - When it's true, pass `frames={[{ ...finalFrame(rng), at: 0 }]}` and `reducedMotion` to `SplashIntro`.

  In `frontend/src/features/splash/SplashIntro.tsx`, when `reducedMotion` is true:
  - use `REDUCED_MOTION_DURATION_MS` for `onDone`
  - skip the `animate` calls
  - add no pop class

  It must make T020 and T021 pass.

**Checkpoint**: All three stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 Add an offline intro test to `frontend/tests/e2e/offline.spec.ts`, which runs against the production build. The test must not call `skipIntro`:
  1. Load once online, with `skipIntro`, and wait for the service worker to activate.
  2. `context.setOffline(true)`.
  3. Open a new page in the same context (a new tab is a new session).
  4. Assert the overlay plays and its letters render.
  5. Assert that no request to `/fonts/intro/` failed, using `page.on('requestfailed')` (FR-015, SC-006).
- [X] T024 [P] Add a short "Splash intro" note to `README.md`. It says the intro plays once per browser session, can be skipped, respects reduced motion, and that fonts are regenerated per `frontend/public/fonts/intro/README.md`.
- [X] T025 Run the full gate from `frontend/`:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test -- --coverage` (the `src/domain/**` 100% threshold is unaffected)
  - `npx playwright test`

  Fix any failure. If the local gate can't finish under memory pressure, push and let PR CI be the gate.
- [X] T026 Walk through [quickstart.md](quickstart.md) manual checks 1–7 in the browser, including no CSP violations in the console and the 360 × 800 layout. Record the results in the PR description.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T003)**: T002 and T003 can run alongside T001. T013 needs T001's file names.
- **Foundational (T004–T009)**: depends on nothing in Setup except where noted. It blocks every story.
  - T005 needs T004.
  - T008 needs T006 and T007.
  - T009 is independent, but must land before T016.
- **US1 (T010–T016)**: needs T005 and T008 (and T009 before T016).
  - T010, T011 and T012 run in parallel.
  - The order is T013 → T014 → T015 → T016.
- **US2 (T017–T019)**: needs T014, since it extends the same component. It is independently testable once done.
- **US3 (T020–T022)**: needs T015, since it extends the gate. It can run alongside US2: the tests are in different files, and the implementation touches `SplashGate.tsx`, plus a small, separate branch of `SplashIntro.tsx`.
- **Polish (T023–T026)**: after the stories you plan to ship are done.

### Within each story

The order is always: tests first (seen failing), then CSS and components, then wiring, then the tests pass.

---

## Parallel Examples

```text
# Foundational, all at once:
T004 introSession.test.ts
T006 timeline.test.ts
T007 flicker.test.ts
T009 e2e skipIntro helper + existing specs

# User Story 1 tests, all at once:
T010 SplashIntro.test.tsx
T011 SplashGate.test.tsx
T012 splash.spec.ts

# After US1, run the US2 and US3 tests in parallel:
T017 (SplashIntro.test.tsx)
T020 (SplashGate.test.tsx)
T018 / T021 (splash.spec.ts; same file, so make them sequential edits if one person does both)
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 (T001–T003), then Phase 2 (T004–T009).
2. Phase 3 (T010–T016).
3. **Stop and validate**: run quickstart checks 1, 2, 5 and 7.

US1 alone forces a 10 s wait per session, so don't ship it to friends without US2 (Principle IV, SC-005).

### Incremental delivery

1. US1 + US2 is the first shippable increment: the intro, with skip.
2. US3 adds reduced-motion safety.
3. Polish adds offline proof, docs and the full gate.

---

## Notes

- **CSP:** never write `style="…"` strings or inline `<style>`. Use React `style` objects, class names and `element.animate` (research R1).
- **Storage:** `sessionStorage` is used only in `frontend/src/data/introSession.ts` (Principle III). The e2e helper sets it directly because it is test code.
- **Commits:** commit after each task or checkpoint.
