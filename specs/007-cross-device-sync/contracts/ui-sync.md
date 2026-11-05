# UI Contract: Sync

**Feature**: [spec.md](../spec.md) | **Research**: [R7](../research.md#r7-disclosure-before-the-first-sync-fr-017-constitution-vii-accountability), [R12](../research.md#r12-ui-changes)

These are the visible behaviors the component and e2e tests assert. Wording is indicative. The tests
match on roles and states, not exact copy.

## Sync notice (FR-017)

- **Existing users**: on the first launch where `GET /api/sync/state` says `noticeAcknowledged: false`,
  a full-screen notice appears before Today. It covers:
  - that the log, saved foods and goals are now stored on the server so they appear on every device;
  - that the owner operates the server and can read the data;
  - that photos are never stored;
  - that earlier versions and deleted entries are kept for 90 days;
  - that removing the account deletes the data.

  It has one primary button, **Turn on sync**. Until it is pressed, the app works local-only and the
  status says *Sync off*.
- **New accounts**: the same text is part of the existing setup notice. Acknowledging the setup notice
  acknowledges both.
- **Offline first launch**: the notice is shown once the state can be fetched. Logging is never
  blocked by it.

## Sync status (FR-010)

The indicator sits in the Today header, beside the account menu. It has a text label (not colour
only), a 44×44 px target, and works at 360 px width. Tapping it shows a one-line explanation.

| State | Label | When |
|---|---|---|
| synced | "Synced" | Outbox empty, last round succeeded |
| syncing | "Syncing…" | A round is in flight for more than 1 s (no flicker on fast rounds), or no round has finished since the app opened |
| pending | "N not synced" | Outbox non-empty, online, round not yet run |
| offline | "Offline: will sync later" | `navigator.onLine` is false or the request failed with a network error |
| failing | "Sync problem, retrying" | 5xx, 429 or `service_unavailable` on the last round |
| quarantine | "N can't sync" (in addition to the above) | Quarantine non-empty |
| off | "Sync off" | Notice not acknowledged |

A `401` hands over to the existing session-expired overlay. The outbox is kept.

## Live updates (FR-005)

- Pulled changes notify subscribers. Today's totals, the entry list, the recent foods (quick picks),
  the history day view, the goal settings, an open entry history and trends refresh without a reload.
- An entry open in the editor that is deleted remotely closes the editor, with an announcement
  ("This entry was deleted on another device").
- An entry open in the editor that is changed remotely keeps the person's unsaved edits. Saving
  creates a normal local edit, which R3 resolves.

## Sign-out with unsynced changes (FR-011)

- **Sign out** or **Sign out everywhere** with a non-empty outbox shows an inline confirmation inside
  the account menu: "N changes haven't synced yet. They'll stay on this device and sync the next time
  you sign in here." It offers **Sign out anyway** and **Cancel**.
- When offline, it adds: "You're offline, so you'll need to reconnect before you can sign out." Signing
  out needs the server, to end the session. If it is tried anyway, the person stays signed in and sees
  "Couldn't sign out. Check your connection and try again." The changes stay safe and sync carries on.
- It is never a browser `confirm()` dialog.
- With an empty outbox, sign-out behaves as today.

## Export (FR-036, FR-037, US4)

- The Account screen has an **Export my data** button, with a short note that the file holds the food log.
- Pressing it downloads the JSON file and announces the result in a status message.
- It works offline. When the device is incomplete (R21), a note says "Some changes haven't synced, so
  this export may be incomplete", and the button stays enabled.
- A failure shows an inline error and leaves the data unchanged.

## Meal categories (FR-020 to FR-023, US5)

- The manual form, the estimate review, the re-log form and the entry editor have a **Meal** field with
  Breakfast, Lunch, Dinner and Snacks. It uses native controls, 44 px targets, and works at 360 px.
- New entries are pre-filled from local time. Accepting the pre-fill needs no extra tap, so the Principle
  IV interaction counts do not change. Each item in a multi-item estimate has its own field.
- Today and the history day view group entries in the order Breakfast, Lunch, Dinner, Snacks,
  Uncategorized. Each group shows a heading and subtotal, and empty groups are hidden. The day total
  stays as it is.
- Uncategorized entries can be given a category in the editor. The field offers no way back to
  Uncategorized.

## Entry history (FR-024 to FR-026, US6)

- The entry editor has a **History** button. The list shows the current version, then earlier versions
  newest first, each with when and how it changed (edited, deleted, restored) and its key values.
- Each earlier version has **Restore**. It applies immediately with no confirmation, because the restore
  can itself be undone from history. A status message confirms it.
- Today and the history day view show a **Recently deleted** link when that day has deleted entries from
  the last 90 days. It lists them, each with **Restore**, and the list is hidden when there are none.
- Restoring works offline and syncs later, like any edit.

## Quick picks (FR-029 to FR-031, US7)

- The quick picks and the Recent foods list use the new order. Their labels and flows do not change.

## Trends (FR-033 to FR-035, US8)

- A **Trends** button joins the Today navigation and opens a new view. It offers 7, 30 and 90 days,
  defaulting to 7.
- The view shows calories, protein, carbs and fat per day, each with its average for the range. The
  protein chart shows the goal that applied each day, as a step line.
- A day with no entries shows as a gap and reads "no data" in the table. It never shows as zero.
- A table holds the same values for screen readers, and nothing relies on colour alone.
- Trends work offline and show a short empty message when the range has no entries.
