# Research: Splash Intro Animation

Technical Context has no open NEEDS CLARIFICATION items. This file records the decisions behind the plan.

## R1. Rendering under the strict CSP

- **Decision**: Static styling lives in `splash.css`, a bundled `'self'` stylesheet. Values that change per frame (font family, weight, style, visibility, shape) go through React `style` props or class names. The flicker uses `element.animate(keyframes, options)`.
- **Rationale**: The CSP is `style-src 'self'` with no `'unsafe-inline'`. That blocks inline `<style>` elements and `style="…"` attributes parsed from HTML. CSSOM writes are allowed, and React's `style` prop and the Web Animations API both write through CSSOM. `ProteinProgress.tsx` already sets inline widths this way under the same CSP.
- **Alternatives considered**:
  - Adding `'unsafe-inline'` or hashes to the CSP was rejected, because it weakens Principle VII for a cosmetic feature.
  - Pure CSS `@keyframes` for the flicker would work, but the flash-count rule (FR-008) couldn't be unit-tested against CSS text. Keeping the keyframes as data in `timeline.ts` lets one source drive both the test and the animation.

## R2. Typefaces: self-hosted and subsetted

- **Decision**: Ship the 13 families from the design as woff2 files in `public/fonts/intro/`:
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

  How the files are made and shipped:
  - **Subsetting:** each file is cut down to `MacroCunte` (the 10 distinct glyphs) plus space. This is done once with `pyftsubset` from `fonttools`, a dev-machine tool that is not added to package.json. The exact command goes in `public/fonts/intro/README.md`.
  - **Licence:** the SIL Open Font License text sits beside the files.
  - **Loading:** each family is declared with `@font-face { font-display: swap }`.
  - **Offline:** woff2 is added to the workbox precache patterns.
- **Rationale**:
  - FR-015 forbids third-party requests, and the CSP has `font-src 'self'`.
  - Subsetting keeps the total to roughly 4–10 KB per family, about 120 KB at most, where the full families would be several MB.
  - All 13 families are under OFL 1.1, which allows bundling and modification (subsetting), provided the licence ships with them and the reserved font names aren't used for modified versions. They are only referenced by their `@font-face` family name inside the app.
  - `swap` meets the spec's typeface fallback edge case: a letter shows in a plain fallback typeface until its font arrives, and the timeline never waits on fonts.
- **Alternatives considered**:
  - Google Fonts CDN: blocked by the CSP and FR-015.
  - An npm font package such as `@fontsource/*`: adds 13 dependencies and ships full glyph sets, against Principle V.
  - Subsetting at build time with a Vite plugin: a new build dependency for something that only needs doing once.

## R3. Timeline as a pure function

- **Decision**: `buildIntroTimeline(rng: () => number): IntroFrame[]` returns the full list of frames with their start times. Every random choice comes from the injected `rng`: typefaces, which letters are visible, where the shapes go, and the final shape order. Production passes `Math.random`. Tests pass a seeded generator.
- **Rationale**:
  - FR-003 to FR-009 can be checked exhaustively, for example with 1,000 seeds asserting that the final frame has 12 distinct typefaces and shapes on exactly indices {0, 4, 7}.
  - The component can't be tested well with real randomness.
  - It matches how the project keeps domain rules in pure modules.
- **Frame schedule** (ms, from the design canvas):

  | Start (ms) | Frame |
  |---|---|
  | 0 | blank |
  | 500 | M + C's |
  | 1700 | vowels only |
  | 2900, 3500, 4100, 4700, 5300, 5900, 6500, 6900 | shifts, 8 in total (≥ 5 required) |
  | 7200 | final logo |
  | 10000 | end |

- **Alternatives considered**: a timeline that computes frames on the fly inside the component was rejected, because it is harder to test and spreads the rules out.

## R4. A flicker that meets the flash limit

- **Decision**: `FLICKER_KEYFRAMES` is a list of `{ offset, opacity }` over 2,800 ms, ending at opacity 0.55. A "flash" is a dip below 0.4 followed by a recovery above 0.7. The dips are placed at least 340 ms apart, around 150, 500, 900, 1300, 1650, 2050 and 2450 ms. A unit test slides a 1-second window across the curve and asserts it never contains more than 3 flashes.
- **Rationale**: The design canvas's flicker had five dips between 1.6 and 2.6 s, which breaks FR-008. Spacing the dips at least 0.34 s apart caps any 1-second window at 3, while keeping the uneven, failing-bulb rhythm.
- **Alternatives considered**: a random flicker generated each run was rejected, because the flash rule could only be checked statistically.

## R5. Where the "played this session" flag lives

- **Decision**: An `IntroSession` interface with `hasPlayed(): boolean` and `markPlayed(): void`, backed by `sessionStorage` under the key `macro.introPlayed`. The adapter catches storage errors: when storage is unavailable, `hasPlayed()` returns `false` and `markPlayed()` does nothing. The flag is written when the intro starts, so a reload in the middle of the intro doesn't replay it.
- **Rationale**:
  - `sessionStorage` matches what "once per browser session" means in FR-010: it survives reloads and navigation in the same tab, and a new tab or window starts fresh.
  - Principle III requires persistence to go through an abstraction.
  - The value is synchronous, so the decision can be made before the first paint, which avoids a flash of the app before the overlay covers it.
- **Alternatives considered**:
  - The IndexedDB `meta` store: it's asynchronous and lasts across sessions, which is the wrong lifetime.
  - Cookies: they would be sent to the server for no reason.
  - In-memory only: a reload would replay the intro, against FR-010.

## R6. Mounting, handover and the app underneath

- **Decision**: `<SplashGate>` always renders its children, the `AuthGate` and app tree. When the intro is due, it also renders a fixed full-viewport `<SplashIntro>` overlay above them and marks the app subtree `inert`. When the intro ends or is skipped, the overlay unmounts, `inert` is removed and focus returns to the document body.
- **Rationale**:
  - FR-017 requires startup to keep running underneath.
  - FR-012 requires the person to land on the same screen in the same state, which holds because the app was never remounted.
  - `inert` keeps keyboard and screen-reader users from reaching hidden controls under the overlay.
- **Alternatives considered**: delaying the app's render until the intro ends was rejected, because it breaks FR-017 and adds 10 s to cold start.

## R7. Skip, hidden tab, reduced motion

- **Skip**:
  - Pointer: a `pointerdown` anywhere on the overlay ends the intro.
  - Keyboard: a `keydown` listener on `window` ends it for Enter, Space and Escape. The listener only exists while the overlay is mounted.
  - Button: a visible "Skip intro" button of at least 44×44 px gets focus when the overlay mounts.
  - Ending is synchronous (unmount), which meets SC-002's 0.5 s easily.
- **Hidden tab**: on `visibilitychange` with `document.hidden`, the intro ends. Timers are throttled in background tabs anyway, so the intro would otherwise resume part-way through.
- **Reduced motion**: `matchMedia('(prefers-reduced-motion: reduce)')` is read when the intro starts. When it matches, the component shows the final frame with no flicker animation and ends after 2,000 ms. Skip still works.
- **Accessibility naming**:
  - The overlay is a `role="img"` container with `aria-label="Macro Counter"`, and each letter is `aria-hidden`.
  - The skip button sits outside the img role, so it stays reachable.
  - There is no live-region announcement, so the name isn't read out repeatedly as frames change.

## R8. Sizing from 360 px to desktop

- **Decision**:
  - The logo row is a non-wrapping flex row.
  - Letter size is `min(104px, (100vw − 32px) / 12.6)`. 12.6 em is the measured width of the widest case: every letter in Rubik Mono One or Monoton, with three shape boxes.
  - Shape boxes are sized in `em` (1.27 em square, 0.12 em side margin), so they scale with the letters.
  - The overlay is `overflow: hidden`, as a final guard against page scroll.
- **Rationale**: FR-016 needs the full word on one line with no clipping on any random combination. Sizing for the worst case guarantees that. The e2e test checks it at 360 px over several runs.
- **Alternatives considered**: shrinking the text to fit at runtime by measuring it was rejected, because it causes layout thrash every frame and adds complexity.

## R9. Existing e2e specs

- **Decision**: Add `skipIntro(page)` to `tests/e2e/helpers.ts`. It calls `page.addInitScript(() => sessionStorage.setItem('macro.introPlayed', '1'))`. Each existing spec's setup calls it, either in `beforeEach` or before its first `goto`. `splash.spec.ts` doesn't call it.
- **Rationale**: Without it, all 19 existing specs would face a 10 s overlay that blocks every click. The production code gets no test-only switch, because the bypass uses the same flag a real reload uses.
- **Alternatives considered**:
  - A query-string or environment flag in production code that disables the intro: rejected as a test hook in shipped code.
  - A global Playwright `storageState`: it doesn't support `sessionStorage`.
