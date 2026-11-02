# Data Model: Splash Intro Animation

This feature has no persisted user data. It has three in-memory shapes and one session flag.

## Glyph positions

The word is `"Macro Counter"`, which has 13 positions: 12 letters and the space at position 5.

| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Char | M | a | c | r | o | ␠ | C | o | u | n | t | e | r |

- **Vowels** (FR-004): {1, 4, 7, 8, 11}
- **C's** (FR-003): {2, 6}
- **Bulb letters** (FR-006): {0, 4, 7}

The space is always present, never boxed, and has no typeface.

## Typeface

`{ id: string; family: string; weight: number; style: 'normal' | 'italic' }`

- There are 13 in the pool (research R2). `id` is stable, for example `'inter-800'`.
- Two are fixed for the first frame: index 0 is the sans-serif (Inter 800) for the "M", and index 1 is Playfair Display 700 italic for both C's.

## IntroFrame

`{ at: number; letters: LetterState[]; final: boolean }`

- `at` is the start time in ms from when the intro appears, between 0 and 10000. Frames are ordered by `at` and the values strictly increase.
- `letters` always has 13 entries, one per index.
- `final` is true only on the last frame.

`LetterState = { typeface: number; visible: boolean; shape: 'circle' | 'square' | 'diamond' | null }`

**Rules** (enforced by `buildIntroTimeline` and covered by unit tests):

| Rule | From |
|------|------|
| Frame 0 (`at: 0`) has no visible letters. | design |
| Frame 1: only indices {0, 2, 6} are visible. Index 0 uses typeface 0, indices 2 and 6 use typeface 1, and no shapes are shown. | FR-003 |
| Frame 2: only the vowels are visible, each in a random typeface. No shapes. | FR-004 |
| There are at least 5 shift frames between frame 2 and the final frame. Each shift draws typefaces at random, and its shapes go only on visible letters, never on the space. | FR-005 |
| The final frame shows all letters. The 12 letters use 12 distinct typefaces. Shapes sit on exactly {0, 4, 7}, and those three shapes are one each of circle, square and diamond. | FR-006, SC-003 |
| The final frame's `at` is at most 7,500 ms, which leaves at least 2.5 s of flicker. | FR-008 |
| The intro ends at 10,000 ms. | FR-002 |

## Flicker keyframes

`FLICKER_KEYFRAMES: { offset: number /* 0..1 */; opacity: number /* 0..1 */ }[]` with `FLICKER_DURATION_MS = 2800`.

- The first offset is 0 with opacity 1. The last offset is 1 with opacity 0.55, the dim rest state.
- A **flash** is a run that dips below opacity 0.4 and then recovers above 0.7. In any 1,000 ms window there are at most 3 flashes (FR-008).

## IntroSession (storage interface)

```ts
interface IntroSession {
  hasPlayed(): boolean;
  markPlayed(): void;
}
```

- **Storage:** `sessionStorage` key `macro.introPlayed`, value `'1'`.
- **Lifetime:** one browser session: the tab, window or browsing context.
- **When unavailable:** if storage is blocked or throws, `hasPlayed()` returns `false` and `markPlayed()` does nothing. The intro still plays, and simply can't be remembered.
- **What it holds:** no user ID and no personal data.

## Intro lifecycle (decided in main.tsx, run by SplashGate)

```text
               ┌────────────── hasPlayed() ──────────────┐
 page load ───►│ true  → play=false → done (no overlay)  │
               │ false → markPlayed(); play=true → playing│
               └─────────────────────────────────────────┘
 playing ──(10 000 ms | skip | tab hidden)──► done
 playing[reduced motion] ──(2 000 ms | skip | tab hidden)──► done
 done: overlay unmounted, app subtree no longer inert
```
