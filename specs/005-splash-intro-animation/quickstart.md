# Quickstart: Validating the Splash Intro

## Prerequisites

- `frontend/` dependencies installed (`npm ci`).
- Font files present in `frontend/public/fonts/intro/` (see that folder's README for how to regenerate them).

## Automated checks

Run from `frontend/`:

```bash
npm test -- splash
```

This covers the timeline rules, the flash limit, the session flag, skipping, reduced motion and a hidden tab, using fake timers.

```bash
npx playwright test splash
```

This runs the full intro at desktop and 360 px widths, plus skip, reduced motion and offline. The offline case runs against the production build.

```bash
npx playwright test
```

This runs the full suite. Existing specs pre-set the intro flag through `skipIntro(page)` and must stay green.

## Manual checks

1. **Run `npm run dev` and open the app in a new tab.** You should see black for about 0.5 s. Then the M and both C's appear, then a cut to the vowels, then shuffles with shapes jumping between letters. At about 7.2 s it lands on the full logo with shapes on M, o and o, which flicker and dim. At 10 s you land on the sign-in or Today screen.
2. **Reload the same tab.** The app opens straight away with no intro (FR-010).
3. **Open a new tab and tap during the intro.** The app appears at once (FR-011). Repeat with Escape, and by tabbing to "Skip intro".
4. **Turn on reduce motion in OS settings and open a new tab.** You see a still logo for at most 2 s, then the app (FR-014).
5. **Use DevTools device mode at 360 × 800.** The whole word is on one line, nothing is clipped, and there is no horizontal scroll (FR-016).
6. **Run `npm run build && npm run preview`, load the app once, go offline and open a new tab.** The intro plays the same way, with no failed font requests in the Network panel (FR-015).
7. **Check the Console during a run.** There should be no CSP violations.

Every check above should match the spec's success criteria: SC-001 to SC-006.
