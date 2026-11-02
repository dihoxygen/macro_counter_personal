# UI direction: Composer

The chosen redesign of the main screen. The AI lookup input is always on Today, and an estimate is
reviewed inline as a card instead of on a separate Add food screen. It is specified and built in
[`specs/004-composer-main-screen/`](../../../specs/004-composer-main-screen/spec.md); where the build differs
from this reference (system font instead of DM Sans, no typed corrections), the spec's Assumptions say why.

Mockups: [canvas](https://claude.ai/artifact/MpLUN8JjxbDyHeq6ygAxR7) (private to the owner). The
`.dc.html` files in this folder are the canvas sources for the two Composer screens; they render
only inside that canvas.

## Why this structure

Of the three directions explored (Ring, Ledger, Composer), Composer is the one that works the same
on desktop and mobile (Principle IV) with the least code:

- No bottom tab bar, bottom sheet or modal, so there is no second navigation or overlay pattern
  to build for desktop.
- Review stays inline on Today, so the same component serves both widths.
- Typing a description is faster with a physical keyboard, so the main flow suits desktop too.
- It keeps master's plain state-based view switching; no router is needed (Principle V).

## Screens

**Today** (`ComposerToday.dc.html`)

- Header: "Today", the date, and icon buttons for History and Account.
- Protein summary: logged against goal ("96 / 150 g protein"), a progress bar, and calories, carbs
  and fat on one line. Always visible (Principle IV).
- Entry list: time, name, quantity and kcal, with protein right-aligned. Tapping an entry opens
  the existing entry editor.
- Composer, pinned to the bottom:
  - "Again:" chips for recent foods, one tap to re-log. A recent food then takes 2 interactions,
    within the 3-interaction limit.
  - A Describe / Photo / Manual switcher that swaps the input area: a text box and send button,
    take or choose a photo, or the manual macro fields.

**Inline review** (`ComposerReview.dc.html`)

- What you typed is shown above the estimate card.
- The card: an "AI estimate" badge, "Not logged until you confirm" (FR-006), each item with its
  protein and macros, warnings with their accept action, and Edit, Add item and Discard buttons.
- Confirm reads "Log 2 items · +54 g" and stays disabled until every warning is accepted, as on
  master.
- The protein bar shows the pending amount as a striped segment.
- The input stays available for a typed correction (for example "half the guac"). That needs a
  new re-estimate request, so the spec has to decide whether it is in scope.

## Desktop (≥ 960px)

The same components, rearranged with a CSS grid: the day log on the left, and the composer and
review card in a right column. Below 960px it is the single column shown in the mockups.

## Visual tokens

| Token | Value |
|-------|-------|
| Background | `#111312` |
| Surface (composer, card) | `#1a1d1b` |
| Raised (chips, pressed mode) | `#2a2e2b` |
| Border | `#262927` / `#333734` |
| Text | `#ececea` |
| Muted text | `#a8a8a3` |
| Accent | `#5cc493` (text on accent `#0d1f17`) |
| Warning | background `#3a3014`, border `#d9b13a`, text `#f2dd9a` |
| Type | DM Sans 400–700; the protein figure is 40px bold |
| Radii | 14px inputs and buttons, 18px cards |

The dark values match master's `prefers-color-scheme: dark` palette in `frontend/src/styles.css`.
A light theme should reuse master's light palette.

## Fix before implementing

- The "Again" chips are 36px tall in the mockup. They must be at least 44px (Principle IV,
  `tests/e2e/touch-targets.spec.ts`).
- DM Sans would be loaded from Google Fonts. Self-host it, or keep the system font stack, so the
  app still works offline and the CSP stays unchanged.
- Keep the bottom-pinned composer above the on-screen keyboard: use
  `interactive-widget=resizes-content` in the viewport meta tag and test it in the installed iOS
  PWA.
