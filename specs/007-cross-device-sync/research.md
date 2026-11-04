# Research: Cross-Device Sync

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-30, revised
2026-11-04 for the clarified scope (R14–R20)

Every unknown in the plan's Technical Context is resolved here. Each section gives the decision, why,
and what else was considered.

---

## R1. Where the server copy lives

**Decision**: Use a new `macro_data` schema in the existing Supabase PostgreSQL database (constitution
v3.0.0, Technical Constraints → Storage). It holds four typed tables (`log_entries`, `entry_versions`,
`saved_foods`, `protein_goals`), a per-user `sync_state` row and a `saved_food_aliases` / `protein_goal_aliases`
mapping (see [data-model.md](./data-model.md)).

- The tables are mapped in the existing `IdentityDbContext` so there is **one** migration stream and
  one history table. The owner keeps applying a single idempotent script (003 R12). The class keeps
  its name. Renaming it would touch every file that uses it for no behavioral gain. Its doc comment
  changes from "never food" to "identity, security and activity data".
- Every activity row has `user_id → macro.users(id) on delete cascade`, so removing a user removes
  their data in the same statement (FR-016).
- Reads and writes go through raw SQL on `NpgsqlDataSource` in a new `SyncStore`. This is the pattern
  `AuditLog` and `TrustedDeviceStore` already use. The conditional upserts in R3 are one SQL
  statement each, which would be awkward to express through EF change tracking.

**Alternatives considered**:
- *A second DbContext with its own migrations.* Rejected: two migration histories, two scripts for
  the owner, and the delete-user procedure would cross both.
- *One generic `records(type, id, jsonb)` table.* Rejected: it loses database-level check constraints
  (units, non-negative values, name length), and Principle III asks the server to validate every
  record. Typed columns make the constraints a second line of defense behind the endpoint validator.
- *Supabase's own client SDK and Realtime, with RLS on `auth.uid()`.* Rejected: 003 R1 deliberately
  uses Supabase only as a database. Authentication is the ASP.NET backend's, and the browser never
  talks to Supabase directly.

---

## R2. Sync protocol: outbox push, then cursor pull

**Decision**: Each device keeps a local **outbox** of changed record keys and a **cursor** (the last
server revision it has seen). A sync round always does **push, then pull**:

1. **Push** `POST /api/sync/push`: send the current local version of every record in the outbox (up
   to 200 changes per request), or a delete marker. The server applies all of it in one transaction
   or none of it (FR-014). Each applied or merged change gets a new revision.
2. **Pull** `GET /api/sync/changes?since=<cursor>`: receive every record of this user whose revision
   is greater than the cursor, oldest first, in pages of 500. Deleted records come back as delete
   markers. The device applies them and advances the cursor.

- Revisions are **per user and dense**. `macro_data.sync_state.revision` is incremented inside the push
  transaction with `update … returning`. That row lock serializes a user's pushes, so revisions commit
  in order and a pull can never skip a revision that commits later. The usual global-sequence gap
  problem does not occur.
- The outbox holds **keys, not snapshots** (`entry:<id>`, `food:<id>`, `goal:<id>`, `version:<id>`). Five
  edits while offline become one push of the latest state, and the states they replaced travel
  separately as entry versions (R14). Each outbox item has a local `seq`. After a successful
  push, an item is removed only if its `seq` is unchanged, so an edit made during the request is not
  lost.
- Records and their outbox items are written in **one IndexedDB transaction**, so a crash can never
  leave a change saved but unqueued.
- While a record has a pending outbox item, an incoming pulled version of it is **not applied
  locally**. The push goes first, the server decides (R3), and the following pull brings the winner.
  This is why the order is always push, then pull.
- Pushes are idempotent. Re-sending a change after a lost response yields the same result (R3's
  comparison is `>`, so an equal version is a no-op).

**Alternatives considered**:
- *Full-state comparison (send everything, diff on the server).* Rejected: cost grows with history
  size on every round.
- *CRDTs or operation logs.* Rejected (Principle V): the records are small and edited rarely, so
  record-level last-writer-wins (spec Assumptions) is enough.

---

## R3. Conflict rule that does not trust device clocks (FR-007)

**Decision**: Use **last writer wins per record, by skew-corrected edit time. A delete always wins.**

- Every push carries `clientNow`, the device's clock at send time. The server computes
  `offset = serverNow − clientNow` and corrects each record's `updatedAt` by that offset, then clamps
  the result to `serverNow`. The corrected time (`effective_at`) is what gets compared and stored.
  - A device whose clock is hours or days wrong still has its edits ordered correctly against other
    devices, because the error is the same at edit time and at push time.
  - Clamping stops a future-dated edit from winning forever.
- An upsert is applied only if `incoming.effective_at > stored.effective_at` and the stored row is
  not deleted. A tie keeps the stored version. The result is reported as `applied` or `superseded`.
- A delete sets `deleted_at` and keeps the row as a **tombstone**, whatever the times, unless the entry
  was explicitly restored after that delete was made (R15). A later upsert to a tombstoned ID is
  reported as `superseded`, and the device receives the tombstone on its next pull, so a stale copy
  never brings the record back (FR-003, spec edge cases). Only an explicit restore can (R15).
- The losing side of any entry conflict is kept as an entry version (R14, SC-007).
- Local `updatedAt` already increases strictly per record (`laterThan` in `entryRepository.ts`), so
  successive edits on one device always order correctly.

**Residual risk**: an offline device whose clock is changed *between* the edit and the push (manual
clock change, or drift over many weeks) can misorder that one edit against a concurrent edit
elsewhere. Only the losing side of a same-record conflict is affected, which SC-007 accepts.

**Alternatives considered**:
- *Arrival order (the last push to reach the server wins).* Rejected: a phone that reconnects after a
  week offline would overwrite a newer edit made on the laptop in the meantime, which is exactly the
  case the spec calls out.
- *Optimistic concurrency (a stale base revision always loses).* Rejected: it is clock-free, but it
  discards the newer edit whenever the device that made it was the one offline.
- *Hybrid logical clocks.* Rejected: they need the same physical-clock input plus more state on every
  record. Skew correction gets the same practical result with one request field.

---

## R4. Natural-key merges: saved foods and goals (FR-008)

**Decision**: Two devices can each create the same saved food (same normalized name and unit) or the
same goal day (same `effectiveFrom`) under different IDs. The server keeps **one canonical row** per
natural key and records the other ID as an **alias**.

- `saved_foods` has a partial unique index on `(user_id, normalized_name, unit) where deleted_at is
  null`. `protein_goals` has one on `(user_id, effective_from)`.
- When an incoming record has a new ID but its natural key matches an existing canonical row, the
  server:
  1. applies R3's comparison to the canonical row, so the most recent macros win;
  2. inserts `(user_id, alias_id → canonical_id)`;
  3. answers `merged` with `canonicalId`.
- The device then rewrites its local copy to the canonical ID and repoints every local entry whose
  `savedFoodId` was the alias, in one IndexedDB transaction.
- Incoming entries whose `savedFoodId` is a known alias are rewritten to the canonical ID by the
  server, which covers devices that have not heard about the merge yet. A `savedFoodId` that matches
  nothing is accepted as-is: it is a soft link and the UI already tolerates a missing food.
- Entry versions are rewritten the same way, so restoring an old version keeps its food link.
- `last_used_at` always keeps the later of the stored and incoming values, even when the rest of a
  saved-food upsert is superseded. Otherwise a conflict could move a food's last use backwards (R18).
- `normalized_name` is computed on the server with the same rule as the device (`trim().toLowerCase()`).
  A shared test vector file keeps the two in agreement.

**Alternatives considered**:
- *Deterministic IDs derived from the natural key (a hash of the name and unit).* Rejected: existing
  local data already has random UUIDs and entries point at them, so this would need a rewrite
  migration on every device.
- *Leaving duplicates for the user to clean up.* Rejected: the spec requires exactly one saved food.

---

## R5. Getting changes to other devices within 10 seconds (FR-005, SC-001)

**Decision**: Use **visible-tab polling**. A sync round runs:

- every **5 s** while the document is visible and the browser reports online;
- immediately after any local change (debounced 500 ms);
- on `visibilitychange` to visible, on `online`, and on start-up.

Hidden tabs do not poll. On failure, retries back off 5 → 10 → 20 → 40 → 60 s, and any of the
immediate triggers resets the backoff.

- Worst case: the change is pushed within about 0.5 s, and the other device polls within 5 s, so the
  change appears within about 6 s. This is inside SC-001's 10 s.
- Load: under 20 accounts, with only open, visible tabs polling, means under 4 requests a second at
  the absolute peak. An empty pull costs one session check plus one indexed query.
- Polling a visible tab keeps the session's 24-hour idle timer alive. That matches what the person is
  doing (looking at the app). Hidden tabs do not extend the session.

**Alternatives considered**:
- *Server-Sent Events.* Rejected: long-lived connections on a single B1 instance, idle-timeout tuning
  on App Service, reconnect logic, and a fan-out mechanism. All of that to save a few polls for under
  20 people (Principle V).
- *WebSockets or Supabase Realtime.* Rejected for the same reasons. Realtime would also put the browser
  in direct contact with Supabase (R1).

---

## R6. First sync of existing local data (FR-008, User Story 2)

**Decision**: Local schema **v2** has a tested migration that creates the `outbox` store and enqueues
**every existing record** as a pending upsert. The `sync.cursor` meta value starts at `0`. The first
round then pushes everything (R4 handles duplicate saved foods and goal days) and pulls the full
history. No separate "first sync" code path exists.

- The same migration gives every entry `mealCategory: null` and a new `versionId` (R14, R17), and links
  each entry to its saved food by normalized name and unit where one matches (R18).
- **Legacy adoption must queue what it copies.** `legacyAdoption.ts` writes straight into the target's
  stores after the target has already migrated, so without a change the adopted records would never
  reach the outbox. Its copy step writes the matching outbox items in the same transaction.
- A device signing in for the first time has an empty local database and cursor 0. It only pulls,
  which covers spec FR-006.
- Large first pushes are split into requests of 200 changes. Each request is atomic. A failure part
  way through leaves the remaining items in the outbox for the next round.
- **Records the server would reject** (out of range or malformed legacy data) are checked on the
  device first, against the same bounds ([data-model.md](./data-model.md#validation-bounds)). A failing
  record is moved from the outbox to a local `quarantine` list, kept on the device and counted in the
  sync status ("1 entry can't sync"). Without this, one bad record would block every push forever,
  because pushes are all-or-nothing.

---

## R7. Disclosure before the first sync (FR-017, constitution VII Accountability)

**Decision**: Add a `notice_ack_at` column to `macro_data.sync_state`.

- Push and pull refuse with `409 sync_notice_required` until it is set.
- `GET /api/sync/state` reports it, and `POST /api/sync/notice` sets it.
- The app shows a one-time **"Your log is now stored on the server"** screen. It explains what is
  stored, that the owner operates the server and can read it, and that photos are never stored.
- New accounts see this text as part of the existing setup notice, which acknowledges both notices in
  one step.
- Until acknowledged, the app works exactly as today: local-only, with the status showing "Sync off".

**Alternatives considered**: *A flag in localStorage.* Rejected: the server must enforce the
disclosure, the same way the AI notice is enforced (003).

---

## R8. User removal and backups (FR-016)

**Decision**: Add a new owner procedure, `macro_admin.delete_user(p_username)`.

- It deletes the `macro.users` row. Cascades remove sessions, tokens, trusted devices, usage rows and
  all `macro_data` rows. Audit rows are kept and unlinked (`set null`, as in 003).
- It writes a `user_deleted` audit event with actor `owner`.
- `disable_user` is unchanged. It keeps data, so a disabled user who is re-enabled gets their history
  back.

**Self-removal**: the app has no self-service account management (003 decision: owner-run procedures,
no admin UI). FR-016 therefore covers removal by the owner, and users ask the owner for it. A "delete
my account" button would be its own small feature.

**Backups**: Supabase daily backups are kept for 7 days on the Pro plan, and the free plan has none.
Both are within the spec's 30-day limit. Point-in-time recovery stays off. The deploy runbook records
that a deleted user's data is fully gone after 7 days.

---

## R9. Encryption and keeping food data out of logs (FR-015)

**Decision**:

- **Transport**: already HTTPS with HSTS (browser to App Service) and TLS VerifyFull (App Service to
  Supabase), from 003.
- **At rest**: Supabase encrypts storage and backups with AES-256. There is no extra application-level
  field encryption. The owner, as operator, can read the data by design (spec Assumptions), so field
  encryption would add key management without changing who can read it. It would also defeat the
  database check constraints.
- **Logs**:
  - Request and response bodies are never logged (unchanged).
  - Sync validation errors and audit reasons use fixed codes only (`invalid_record`, `too_many_changes`,
    and so on), never field values.
  - A test pushes a sentinel food name and asserts it appears in no captured log and no audit row. This
    extends 003's `SecretScanTests` pattern.

---

## R10. Row-level security as defense in depth (FR-013)

**Decision**: Ownership is enforced in three places.

- **The endpoint**: the user ID always comes from the session. No sync request has a user ID field,
  so a cross-user request cannot even be expressed (the same approach as 003).
- **The primary key**: every primary key is `(user_id, id)`. If user X pushes an ID that user Y also
  uses, X simply gets X's own row. It cannot touch Y's.
- **Row-level security**: every `macro_data` table gets a policy for the app role:
  `using (user_id = current_setting('macro.user_id')::uuid)`. `SyncStore` runs
  `set_config('macro.user_id', $1, true)` at the start of every transaction. A query that forgot its
  `where user_id = …` therefore still sees only the caller's rows, and a transaction with the setting
  unset sees nothing.

`grant_app_role` is replaced, via `create or replace`, by a version that also grants the new tables.
The owner re-runs it after migrating, as the 003 runbook already says to do after any migration.

**Cross-user audit (FR-019)**: a cross-user attempt cannot be expressed, so there is nothing to detect.
The tests prove instead that an ID collision with another user's record leaves that record untouched
and is not visible. Rejected payloads (`sync_rejected` with a reason code), sync rate-limit hits and
`user_deleted` are audited.

---

## R11. Limits (FR-018)

**Decision**:

| Limit | Value | Response |
|---|---|---|
| Changes per push (entry versions count) | 200 | `400 too_many_changes` |
| Push body size | 256 KiB | `413` |
| Pull page size | 500 records (server-capped) | — |
| Sync requests per user (`SyncPerUser` limiter) | 60 per minute | `429 rate_limited` with Retry-After |

The 60-per-minute limit is 5 s polling (12 per minute) plus pushes from two tabs, with headroom.

---

## R12. UI changes

**Decision**:

- **Live updates**: `UserData` gains `changes.subscribe(listener)`, a tiny in-memory emitter. `DayLog`,
  `RecentFoods`, `QuickPicks`, `GoalSettings`, entry history and trends reload when pulled changes touch
  their data. They already reload through a `version` or refresh counter, so this only adds a
  subscription.
- **Sync status**: a compact indicator in the Today header (FR-010) with these states:
  - Synced
  - Syncing…
  - N changes not synced
  - Offline: changes will sync later
  - Sync failing, retrying
  - N can't sync (quarantine)
  - Sync off (notice not acknowledged)
- **Sign-out warning**: when the outbox is not empty, the account menu shows an inline confirmation
  ("3 changes haven't synced yet. They'll stay on this device and sync next time you sign in here")
  before signing out (FR-011). It is not a browser `confirm()` dialog. The data stays in the user's
  own locked database (003), so nothing else changes.
- **Export**: a new Account screen action (R21).

---

## R13. Dependencies (Principle V)

**Decision**: There are **no new packages**. The backend uses Npgsql, which is already referenced, and
the built-in rate limiter. The frontend uses `idb`, `zod` and `fetch`, which are already in use.
Polling and the change emitter are a few dozen lines of platform code. The trends chart is plain SVG
(R19), so no chart library is needed.

---

## R14. Entry history: every saved state has its own ID (FR-024, FR-025, SC-007)

**Decision**: Each saved state of an entry gets a device-generated `versionId`. When a state is replaced,
it becomes an immutable, insert-only row in `entry_versions`, whose primary key is that same ID.

- The device writes the replaced state to a local `entryVersions` store and the outbox, in the same
  transaction as the entry write. This is the only way to keep **offline** intermediate states, because
  the outbox sends just the latest state of each entry (R2). It also makes history readable offline.
- The server is the backstop. Whenever a push changes the current row, the state it displaces is
  inserted as a version. A superseded incoming state is inserted too. That is how a losing edit stays
  recoverable even though the winning device never saw it (spec edge case, SC-007).
- **The ID makes this free of duplicates.** Devices A and B can both replace the same state, and the
  server can too. All three name the same `versionId`, so `on conflict do nothing` leaves one row. The
  first arrival's `changeType` and `replacedAt` stand, and every device converges on them through pull.
- In a push, the server handles version changes before entry changes, so a device's own change type
  beats the backstop's default of `edit`.
- Versions sync as a fourth record type with their own revisions, using the same push, pull and
  validation. There is no separate history API.
- A save that changes nothing writes nothing, so history has no empty versions.
- If a losing state is also the current one (a version pushed, then its replacement superseded), the
  history view leaves out the version whose ID matches the entry's current `versionId`.

**Alternatives considered**:
- *Server-only capture.* Rejected: offline intermediate edits never reach the server, which breaks
  FR-024's "every time".
- *Device-only capture.* Rejected: a device cannot record a state it never saw, so the losing side of a
  conflict could vanish.
- *Deduplicating by content hash.* Rejected: two genuinely separate states with equal content would
  collapse, and the hash rules would need to match in C# and TypeScript.

---

## R15. Restore versus the delete-wins rule (FR-003, FR-026, constitution III)

**Decision**: A restore is an explicit `restore` change. A plain upsert can never revive a tombstone, so
the stale-copy rule and restore stay separate.

| Stored | Incoming | Result |
|---|---|---|
| live | upsert | R3 last writer wins. The loser becomes a version |
| live | restore | Same as upsert, and `restored_at` is set to the corrected time |
| live | delete | Tombstone, unless `restored_at` is later than the delete's corrected time. Then the delete is `superseded`: it was made before the restore |
| tombstone | upsert | `superseded`. The incoming state becomes a version |
| tombstone | restore | Revived if the restore's corrected time is later than the tombstone's. Otherwise `superseded`, and the incoming state becomes a version |
| tombstone | delete | No-op |

- This meets constitution III, "a deleted record MUST NOT come back from a stale copy". A stale upsert
  still cannot revive a record, and only a deliberate user action can.
- `restoredAt` is **server-assigned and pull-only**. If devices sent it back on later edits, the server
  would skew-correct a value that was already corrected.
- `op: restore` stays sticky in the outbox if the user edits the restored entry before it syncs.
- A restore writes a new state with a new `versionId`, the same entry ID and the restored fields.
  History shows it through `restoredAt`, and any live state it displaces has change type `restore`.

---

## R16. Retention of versions and tombstones (FR-027)

**Decision**: Extend the existing daily `macro_admin.purge_expired()` to delete `entry_versions` rows
replaced more than 90 days ago. It already runs under `pg_cron` on Supabase, so no new scheduler is
needed, and `create or replace` keeps the schedule.

- **Tombstones hold no food data.** On delete, the server clears the row's data columns, and the food
  data lives only in the delete version. The 90-day purge therefore removes all of it, while the
  tombstone stays forever so stale copies stay dead. Otherwise the tombstone would break the spec's
  "nothing, if it was deleted more than 90 days ago".
- **Devices purge their own copy.** Each pull returns `serverNow`, stored as `meta.sync.serverNow`. The
  device hides and removes versions older than 90 days by that time rather than its own clock, so a
  wrong device clock cannot change what is listed.
- The app role has no `delete` on `entry_versions`. The purge runs as the owner.
- After the purge, a deleted food's data leaves backups within the ≤ 7-day window (R8).

---

## R17. Meal categories (FR-020 to FR-023)

**Decision**: A nullable `mealCategory` field on the entry: `breakfast`, `lunch`, `dinner`, `snacks`, or
`null`. `null` is "Uncategorized". The set is a code constant and a database check, with no table.

- `NewEntry` requires a non-null category and `EntryPatch` accepts only non-null ones, so the types
  prevent new uncategorized entries or a move back to Uncategorized (FR-020, FR-022).
- The server enforces FR-022 against stale devices. If an upsert or restore brings `null` onto a row with
  a category, the row keeps its category.
- A pure `categoryForTime(date)` applies the spec's windows in device local time. A pure
  `groupByCategory(entries)` builds the groups and subtotals through `sumMacros`, so the daily total
  stays the sum of all entries (FR-023).
- The field is pre-filled in the existing forms, so changing it is optional and adds no required
  interaction (FR-021, Principle IV).

---

## R18. Frequently used foods (FR-029 to FR-031)

**Decision**: Rank on the device from synced entries, with no stored counter.

- A pure `rankQuickPicks(foods, entries, today)` counts linked entries in the 30 days ending today (by
  `dayKey`). Order: count, then latest linked `loggedAt`. Foods with no use in the window follow by
  `lastUsedAt`. The food ID breaks any remaining tie, so the order is fully deterministic.
- Deletes and restores change the count automatically (FR-030), and all devices count the same entries,
  so offline uses are counted once each.
- **Links have to be fixed first.** Today only re-logging sets `savedFoodId`. AI and manual entries save
  `null`, so counts would miss most uses. `LogService.confirmEntries` will save the food first and create
  the entry with that food's ID. The v2 migration links existing entries by normalized name and unit
  (R6). It does not change `updatedAt`, and those records are queued for their first sync anyway.
- `listRecent` is replaced by `listQuickPicks(today, limit)`, which reads only the 30-day range through
  the `dayKey` index. At about 600 entries, this is a small read.
- "Today" is the device's own date, so devices in different time zones can briefly disagree around
  midnight. That only moves the edge of the window, and it clears once both reach the same date.

**Alternatives considered**: *A synced counter on the saved food.* Rejected: two devices would conflict
on it, it would not fall when an entry is deleted, and a stored total can drift from the entries.

---

## R19. Trends (FR-032 to FR-035, SC-008)

**Decision**: A pure `buildTrend(entries, goals, today, rangeDays)` in `domain/nutrition/` runs on the
device from local entries, so it works offline and needs no server endpoint.

- Totals use `sumMacros` per day, and the goal uses the existing `goalForDay`. Nothing is stored
  (FR-032). This is the same arithmetic as the day view, so the two cannot disagree.
- Days with no entries are `null` rather than zero and are left out of the average. Today counts once it
  has an entry. The range is today and the previous 6, 29 or 89 days.
- `EntryRepository.listByDayRange(from, to)` uses a `dayKey` index range. 90 days is about 1,800 records,
  well inside SC-008's 2 seconds.
- The view is inline SVG, one small chart per measure, plus an accessible table of the same values.
  Rounding happens only at display (Principle II).

**Alternatives considered**: *A chart library.* Rejected: a new dependency for simple bars (Principle V).
*A server-side aggregate endpoint.* Rejected: it would not work offline (FR-035).

---

## R20. Staging: what ships with sync, and what waits (FR-001)

**Decision**: There is one data design and one migration. Only the P3 **screens** wait.

Data that is not captured from the first sync can never be recovered, so these ship with the P1 work:

- the full `ActivityData` migration, including `entry_versions` and `meal_category`
- `mealCategory` and `versionId` on the wire and in the v2 device migration
- version capture in the repositories and on the server
- `categoryForTime` pre-fill, because FR-022 forbids assigning a category later, so entries logged in the
  meantime would stay Uncategorized forever
- saved-food links on new entries, and the link migration
- the restore rules in R15, so every server state is defined from the start

US5–US8 then add the visible parts: the category control and grouping, the history and restore screens,
quick-pick ordering, and trends.

---

## R21. Export (FR-036, FR-037, SC-009, constitution III)

**Decision**: Build the file on the device from the local copy, as one versioned JSON document. There is
no server endpoint.

- A pure `buildExport(records, exportedAt)` assembles the document ([data-model.md](./data-model.md#export-file)).
  `UserData.exportData()` reads through the repositories, so Principle III's storage rule holds and only
  the signed-in user's database is ever read.
- A small `downloadFile` helper saves it through a `Blob` and a temporary `download` link. It is injected
  so tests can capture the file. The existing CSP does not restrict this.
- Values are written as stored, so the export keeps full precision (Principle II).
- The device counts as incomplete when the outbox is non-empty, quarantine is non-empty, a pull has more
  pages to fetch, or the first pull has not finished. The Account screen then shows a note and still
  allows the export (FR-037).
- The file is not encrypted. The Account screen says it holds the user's food log.
- Import is out of scope. Constitution III asks only for export.

**Alternatives considered**:
- *A server export endpoint.* Rejected: it would not work offline, and it would add a bulk-read route to
  a health-data store for no gain.
- *CSV.* Rejected: nested quantities and macros, and several record types, would need several files.
  The constitution accepts either format.
