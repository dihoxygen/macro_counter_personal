# Research: Cross-Device Sync

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-30

Every unknown in the plan's Technical Context is resolved here. Each section gives the decision, why,
and what else was considered.

---

## R1. Where the server copy lives

**Decision**: Use a new `macro_data` schema in the existing Supabase PostgreSQL database (constitution
v3.0.0, Technical Constraints → Storage). It holds three typed tables (`log_entries`, `saved_foods`,
`protein_goals`), a per-user `sync_state` row and a `saved_food_aliases` / `protein_goal_aliases`
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
- The outbox holds **keys, not snapshots** (`entry:<id>`, `food:<id>`, `goal:<id>`). Five edits while
  offline become one push of the latest state. Each outbox item has a local `seq`. After a successful
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
- A delete sets `deleted_at` and keeps the row as a **tombstone**, whatever the times. A later upsert
  to a tombstoned ID is reported as `superseded`, and the device receives the tombstone on its next
  pull, so the record never comes back (FR-003, spec edge cases).
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
no admin UI). For now, "by the user" in FR-016 means the user asks the owner. ⚠️ This narrows the
spec wording. `/speckit-analyze` should flag it, and the spec should be updated to match, unless the
owner wants a "delete my account" button, which would be its own small feature.

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
| Changes per push | 200 | `400 too_many_changes` |
| Push body size | 256 KiB | `413` |
| Pull page size | 500 records (server-capped) | — |
| Sync requests per user (`SyncPerUser` limiter) | 60 per minute | `429 rate_limited` with Retry-After |

The 60-per-minute limit is 5 s polling (12 per minute) plus pushes from two tabs, with headroom.

---

## R12. UI changes

**Decision**:

- **Live updates**: `UserData` gains `changes.subscribe(listener)`, a tiny in-memory emitter. `DayLog`,
  `RecentFoods` and `GoalSettings` reload when pulled changes touch their data. They already reload
  through a `version` counter, so this only adds a subscription.
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
- **Export**: there is still no export feature (noted in 001 and 003). This feature adds nothing new.

---

## R13. Dependencies (Principle V)

**Decision**: There are **no new packages**. The backend uses Npgsql, which is already referenced, and
the built-in rate limiter. The frontend uses `idb`, `zod` and `fetch`, which are already in use.
Polling and the change emitter are a few dozen lines of platform code.
