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
| syncing | "Syncing…" | A round is in flight for more than 1 s (no flicker on fast rounds) |
| pending | "N not synced" | Outbox non-empty, online, round not yet run |
| offline | "Offline: will sync later" | `navigator.onLine` is false or the request failed with a network error |
| failing | "Sync problem, retrying" | 5xx, 429 or `service_unavailable` on the last round |
| quarantine | "N can't sync" (in addition to the above) | Quarantine non-empty |
| off | "Sync off" | Notice not acknowledged |

A `401` hands over to the existing session-expired overlay. The outbox is kept.

## Live updates (FR-005)

- Pulled changes notify subscribers. Today's totals, the entry list, the recent foods (quick picks),
  the history day view and the goal settings refresh without a reload.
- An entry open in the editor that is deleted remotely closes the editor, with an announcement
  ("This entry was deleted on another device").
- An entry open in the editor that is changed remotely keeps the person's unsaved edits. Saving
  creates a normal local edit, which R3 resolves.

## Sign-out with unsynced changes (FR-011)

- **Sign out** or **Sign out everywhere** with a non-empty outbox shows an inline confirmation inside
  the account menu: "N changes haven't synced yet. They'll stay on this device and sync the next time
  you sign in here." It offers **Sign out anyway** and **Cancel**.
- It is never a browser `confirm()` dialog.
- With an empty outbox, sign-out behaves as today.
