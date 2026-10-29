# UI Contract: Today with the Composer

The roles, accessible names and layout rules that component and e2e tests rely on. Names in **bold** are
exact accessible names. Tests find elements by role and name only, never by class or test id.
Existing names that are kept are marked *(kept)*.

## Today screen

| Element | Role | Name | Rules |
|---------|------|------|-------|
| Screen title | `heading` level 1 | **Today** *(kept)* | |
| History | `button` | **Previous days** *(kept name)* | Icon only; opens the Previous days view |
| Goal | `button` | **Goal settings** | Icon only; opens the Protein goal view. Not named "Protein goal", which is the progress region |
| Account | `button` | **Account** *(kept name)* | Icon only; opens the Account view |
| Totals | `region` | **Totals** *(kept)* | Visible in the viewport without scrolling at 360 × 740 and 1280 × 800 |
| Protein goal progress | `region` **Protein goal** *(kept)* containing `progressbar` **Protein toward goal** *(kept)* | | `aria-valuenow` = logged protein only, never pending |
| Pending protein | text inside **Protein goal** (or Totals when no goal) | | "+{formatGrams} pending", shown only while a card is under review |
| Entry list | `list` | **Entries** *(kept)* | Unchanged items; tapping opens the entry editor |
| Old button row | — | — | **Add food** and **Recent** buttons no longer exist on Today |

## Composer

| Element | Role | Name | Rules |
|---------|------|------|-------|
| Composer | `region` | **Log food** | Holds everything below |
| Quick picks | `group` | **Recent foods** | Absent when there are no saved foods. At most 5 food buttons, named by the food name, then **More recent foods** (opens the Recent view). Disabled while a card is open |
| Method switch | `group` | **Entry method** *(kept)* | Buttons **Describe**, **Photo**, **Manual** *(kept)* with `aria-pressed`. Disabled while a card is open. When AI is blocked, Describe and Photo are disabled and a message explains why (wording *(kept)* from `AddFood`) |
| Description | `textbox` | **What did you eat?** *(kept)* | Enter sends; Shift+Enter adds a newline; `enterkeyhint="send"`; max 500 characters *(kept)* |
| Send | `button` | **Estimate** *(kept)* | Icon allowed, but the name stays **Estimate** |
| Progress | `status` | "Estimating…" *(kept)* + `button` **Cancel** *(kept)* | Shown in the card area |
| Photo controls | as feature 002's [photo-step-ui](../../002-add-photo-from-source/contracts/photo-step-ui.md) *(kept)* | | Shown in the composer when Photo is selected. The live camera is closed whenever Today is hidden |
| Manual form | as today's `ManualEntryForm` *(kept)* | | Shown in the composer when Manual is selected; saving logs directly |

## Card area

| Element | Role | Name | Rules |
|---------|------|------|-------|
| Review card | `region` | **Review estimate** *(kept)* | Contents and buttons (**Edit**, **Remove**, **Add item**, **Yes, these values are right**, **Confirm**, **Discard**) *(kept)*. Focus moves to the card when it opens and back to **What did you eat?** when it closes |
| Re-log card | `form` containing the food name | | Amount field **Amount** *(kept)*, buttons **Log** *(kept)* and **Cancel** (was **Back to list** when shown from the Recent screen, where it stays) |
| Error | `alert` with the message *(kept)* | | Buttons **Retry**, **Enter manually** *(kept)*, plus **Describe in text** for photo errors *(kept)* |
| Unrecognized | text *(kept)* | | Same recovery buttons as Error |

## Layout

- **Below 960 px**: single column. Visual and DOM order: header, Totals, Entries, Log food. Log food is
  sticky at the bottom of the viewport.
- **960 px and above**: Log food's bounding box is to the right of Entries (`composer.left ≥
  entries.right`), and both start below Totals.
- No horizontal page scroll at 360 px. The quick-pick row may scroll horizontally inside its own box.
- Every visible `button`, `a[href]`, `input`, `select` and `textarea` is at least 44 × 44 CSS px
  (`touch-targets.spec.ts`).

## Other views

The Previous days, Protein goal, Recent and Account views are unchanged, with their **← Back** button
*(kept)*. Going back shows Today with any open card and drafts as they were.
