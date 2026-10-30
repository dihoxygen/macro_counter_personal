# Contract: Splash Intro

The feature has no network interface. This contract covers the module API that tests rely on and the user-visible UI.

## Module API (`frontend/src/features/splash/timeline.ts`)

```ts
export const WORD = 'Macro Counter';
export const SPACE_INDEX = 5;
export const BULB_INDICES = [0, 4, 7] as const;
export const INTRO_DURATION_MS = 10_000;
export const REDUCED_MOTION_DURATION_MS = 2_000;
export const FLICKER_DURATION_MS = 2_800;

export const TYPEFACES: readonly Typeface[];          // 13 entries; [0] sans, [1] C's face
export const FLICKER_KEYFRAMES: readonly { offset: number; opacity: number }[];

export function buildIntroTimeline(rng: () => number): IntroFrame[];
export function finalFrame(rng: () => number): IntroFrame; // used for reduced motion
export function countFlashes(keyframes, durationMs, windowMs): number; // max flashes in any window
```

The types are defined in [data-model.md](../data-model.md).

## Storage adapter (`frontend/src/data/introSession.ts`)

```ts
export interface IntroSession { hasPlayed(): boolean; markPlayed(): void }
export function browserIntroSession(storage?: Storage): IntroSession; // defaults to window.sessionStorage
```

## Components

```tsx
<SplashGate play={boolean} rng?={() => number} reducedMotion?={boolean}>
  {children}
</SplashGate>

<SplashIntro frames={IntroFrame[]} reducedMotion={boolean} onDone={() => void} />
```

- `main.tsx` decides whether the intro plays once, before `createRoot().render()`: `const play = !session.hasPlayed(); if (play) session.markPlayed();`. It then passes `play` to the gate. The decision stays outside React because `StrictMode` runs state initializers twice, and the second run would see the flag already set and skip the intro.
- `children` render in every case. While the overlay is up, they are wrapped in an element with `inert`.

## UI contract (what tests assert)

| Element | Selector / role | Behaviour |
|---------|-----------------|-----------|
| Overlay | `data-testid="splash-intro"` | Fixed and full viewport, `#000` background, `overflow: hidden`. Present only while the intro is playing. |
| Logo | `role="img"`, name "Macro Counter", inside the overlay | Holds the 13 letters. The skip button sits beside it, not inside it, so it stays reachable. |
| Letters | `[data-testid="splash-letter"]` ×13, each `aria-hidden="true"` | `data-index`, `data-typeface` (typeface id), `data-visible` ("true"/"false"), `data-shape` (circle/square/diamond or absent) |
| Bulb flicker | `[data-flicker="true"]` on shape layers in the final frame | `element.animate(FLICKER_KEYFRAMES, { duration: 2800, fill: 'forwards' })`. Skipped when reduced motion is on, or when `animate` doesn't exist (jsdom). |
| Skip button | `role="button"`, name "Skip intro" | At least 44×44 px and focused on mount. Clicking it ends the intro. |
| Skip input | `pointerdown` on the overlay; `keydown` Enter, Space or Escape on `window` | Ends the intro at once. The window listener is removed when the overlay unmounts. |
| Hidden tab | `document.visibilitychange` with `hidden === true` | Ends the intro. |
| End | overlay removed | The app subtree loses `inert`, and focus moves to `document.body`. |

## Timing guarantees

| Case | The overlay is removed at |
|------|------------------------------------|
| Normal | 10,000 ms ± 500 ms after mount (SC-001) |
| Reduced motion | ≤ 2,000 ms (SC-004) |
| Skip | within 500 ms of the input (SC-002) |
