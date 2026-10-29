# Quickstart: Validating the Composer Main Screen

How to prove the feature works. The roles and names used below are defined in
[contracts/today-ui.md](./contracts/today-ui.md). The in-memory state is in
[data-model.md](./data-model.md).

## Prerequisites

Same as the repository [README](../../README.md): Node 24, the frontend dependencies (`npm ci` in
`frontend/`) and the Playwright Chromium. The mocked e2e projects (`desktop`, `mobile`, `offline`) need
no backend or API key. The `auth-*` projects need local PostgreSQL and PowerShell, as before.

## Fast checks

Run from `frontend/`:

```powershell
npm run typecheck
npm run lint
npm test                                   # unit + component, including coverage of src/domain/**
npx playwright test --project=desktop --project=mobile --project=offline
```

Expected: everything passes, and `src/domain/**` stays at 100 % line and branch coverage.

## Scenarios

Each scenario is covered by an automated test (the test level is in brackets) and can be repeated by
hand in `npm run dev`.

| # | Story | Scenario | Expected |
|---|-------|----------|----------|
| Q1 | US1 | On Today, type "banana" in **What did you eat?** and press Enter [e2e both widths] | Progress shows on Today, then **Review estimate** appears on Today; the URL and the heading **Today** don't change |
| Q2 | US1 | With the card open, read **Protein goal** (goal 150 g, 96 g logged, estimate 54 g) [component] | "+54 g pending" is shown and the progress bar's `aria-valuenow` is still 96 |
| Q3 | US1 | **Confirm** [e2e] | The card closes, **What did you eat?** is empty and focused, the entry is in **Entries**, and Totals include it |
| Q4 | US1 | **Discard** [component] | Nothing is logged; the description is still in the field |
| Q5 | US1 | Estimate with a warning; try **Confirm** before accepting it [component] | **Confirm** is disabled until **Yes, these values are right** is pressed or the item is edited |
| Q6 | US1 | With a card open, try **Photo**, a quick pick, or **Estimate** [component] | All are disabled; only one estimate can be pending |
| Q7 | US2 | With 7 saved foods, look at **Recent foods** [component] | 5 food buttons and **More recent foods**; **More recent foods** opens the Recent view |
| Q8 | US2 | Tap a quick pick, then **Log** [e2e] | Logged at the saved amount in 2 interactions; Totals update |
| Q9 | US3 | Switch to **Photo**, choose the fixture photo, **Estimate** [e2e, existing log-photo/camera specs rewritten] | The review card appears on Today; the uploaded photo is re-encoded and EXIF-free, as before |
| Q10 | US3 | Type a description, switch to **Manual** and back to **Describe** [component] | The description is still there |
| Q11 | US3 | `/api/status` reports AI unavailable, or offline project [component + offline e2e] | The composer opens on Manual; **Describe** and **Photo** are disabled with the existing message; a manual entry and a quick-pick re-log both work |
| Q12 | US4 | At 1280 × 800 and 360 × 740 [layout e2e] | At 1280: **Log food** is right of **Entries**. At 360: below it. At both, **Totals** is in the viewport and there is no horizontal page scroll |
| Q13 | US4 | Desktop, keyboard only: type, Enter, Tab to **Confirm**, Enter [keyboard e2e] | Logged without the mouse; focus moves into the card when it opens |
| Q14 | US5 | Open a card, go to **Goal settings**, change the goal, **← Back** [component + goal e2e] | Today shows the same card with its edits, and the progress uses the new goal |

Touch targets: `touch-targets.spec.ts` walks Today (empty and with quick picks), the composer in each
method, the review card with a warning and editor open, and the re-log card, and finds no target under
44 × 44 px.

## Manual checks (not automated)

- **Phone keyboard** (FR-016): on an Android phone (Chrome) and an iPhone (Safari, and the installed
  PWA), tap **What did you eat?**. The composer and the field stay visible above the keyboard, and the
  last entry is still reachable by scrolling.
- **Dark mode** (FR-017): with the device in dark mode, Today matches the dark tokens in
  `docs/design/composer/README.md`. Text stays readable at 4.5:1 against its background, warning text
  included.
- **Camera off when leaving** (feature 002 rule): open the live camera in **Photo**, then go to
  **Previous days**. The camera light turns off.
