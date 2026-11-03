---

description: "Task list for 007 Cross-Device Sync"
---

# Tasks: Cross-Device Sync

**Input**: Design documents from `/specs/007-cross-device-sync/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/sync-api.yaml](./contracts/sync-api.yaml),
[contracts/ui-sync.md](./contracts/ui-sync.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE) and Principle VII
(security tests). Every test task must be written and **observed failing** before the implementation
task that follows it.

**Organization**: Tasks are grouped by user story so each story can be built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US4)
- Paths are repo-relative: `backend/MacroCounter.Api/`, `backend/MacroCounter.Api.Tests/`,
  `frontend/src/`, `frontend/tests/e2e/`

**Conventions to follow** (they apply to every task):

- **Backend data access**:
  - Use raw SQL on `NpgsqlDataSource`, as `Audit/AuditLog.cs` and `Auth/TrustedDeviceStore.cs` do.
  - Backend DB tests use `Infrastructure/PostgresFixture.cs` and run as the least-privilege app role.
- **Frontend data access**:
  - Repositories are the only code that touches IndexedDB (Principle III).
  - Frontend tests use `fake-indexeddb` (existing setup).
- **Server-side naming**: SQL identifiers are snake_case in schema `macro_data`. Error responses are
  problem+json with a `code` (`Endpoints/Problems.cs`). JSON binding is strict (`Endpoints/StrictJson.cs`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Folders, shared test vectors and constants that both sides read

- [ ] T001 Create folders `backend/MacroCounter.Api/Sync/`, `backend/MacroCounter.Api.Tests/Sync/vectors/`, `frontend/src/sync/` and `frontend/src/features/sync/` (add each only when its first file is created; no placeholder files)
- [ ] T002 [P] Create shared validation vectors at `backend/MacroCounter.Api.Tests/Sync/vectors/bounds.json`. Include valid and invalid cases for every row of data-model.md "Validation bounds", verbatim:
  - name: "Non-empty after trim, ≤ 120 chars"
  - quantity `amount`: "Finite, 0 ≤ x ≤ 100 000"
  - `unit`: "`g`, `ml`, `serving`"
  - `kcal`: "Finite, 0 ≤ x ≤ 100 000"
  - `proteinG`, `carbsG`, `fatG`: "Finite, 0 ≤ x ≤ 10 000"
  - goal `grams`: "null, or finite, 0 < x ≤ 10 000"
  - `dayKey`/`effectiveFrom`: "`YYYY-MM-DD`, a real calendar date"
  - timestamps: "ISO 8601 with offset"
  - `schemaVersion`: "Known version (1)"

  Each case is `{ type, record, valid, reason? }`, with reason in `invalid_record | unknown_schema_version`.
- [ ] T003 [P] Create shared name-normalization vectors at `backend/MacroCounter.Api.Tests/Sync/vectors/normalize.json`, covering the device rule `trim().toLowerCase()` against the server's `lower(btrim(name))` (spaces, tabs, mixed case, non-ASCII letters such as "Crème Brûlée", and trailing newline)
- [ ] T004 [P] Let the frontend tests read the vectors: add a helper `frontend/src/test/syncVectors.ts` that imports `../../../backend/MacroCounter.Api.Tests/Sync/vectors/*.json`. Check that `tsconfig.app.json`/vitest config allow the JSON import, and adjust the vitest config if needed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server schema and security, the notice gate, the device v2 schema with outbox, and the
HTTP client. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write first, see them fail)

- [ ] T005 [P] Migration/schema tests in `backend/MacroCounter.Api.Tests/Database/ActivityDataMigrationTests.cs`:
  - Schema `macro_data` exists with tables `log_entries`, `saved_foods`, `protein_goals`, `saved_food_aliases`, `protein_goal_aliases`, `sync_state`.
  - Each data table has PK `(user_id, id)` and FK `user_id → macro.users(id) on delete cascade`.
  - Index `(user_id, revision)`.
  - `saved_foods` has the partial unique index `(user_id, normalized_name, ref_unit) where deleted_at is null`, and `protein_goals` has unique `(user_id, effective_from)`.
  - Check constraints reject: `quantity_unit` outside `g|ml|serving`, negative or over-bound macros ("`kcal` ≤ 100 000, others ≤ 10 000"), `quantity_amount` > 100 000, `source` outside `ai|ai-edited|manual`, name empty after trim or > 120 chars, and goal `grams` ≤ 0 or > 10 000 (null allowed).
  - RLS is enabled on every `macro_data` table.
- [ ] T006 [P] Grant tests in `backend/MacroCounter.Api.Tests/Database/AppRoleGrantTests.cs` (extend). After `macro_admin.grant_app_role(<role>)`:
  - The app role has `select, insert, update` and **no `delete`** on every `macro_data` table, and no DDL.
  - With `macro.user_id` unset, `select count(*)` on each table returns 0.
  - With it set to user A, an unscoped `select` returns only A's rows (plan threat S2).
- [ ] T007 [P] `ClockSkew` unit tests in `backend/MacroCounter.Api.Tests/Sync/ClockSkewTests.cs`:
  - `offset = serverNow − clientNow`, and `effective = updatedAt + offset`, clamped to `serverNow`.
  - Device clocks ±2 h and ±3 days wrong give the correct ordering.
  - A future-dated edit is clamped.
  - Equal inputs give equal outputs.
  - Use `FakeTimeProvider`.
- [ ] T008 [P] `SyncValidator` tests in `backend/MacroCounter.Api.Tests/Sync/SyncValidatorTests.cs`:
  - Drive every case in `vectors/bounds.json` (T002).
  - `record.id` must equal the change `id`.
  - `delete` is allowed only for `type: entry`.
  - More than 200 changes gives `too_many_changes`.
  - The result lists `{index, reason}` and never echoes field values.
- [ ] T009 [P] Notice-gate and access tests in `backend/MacroCounter.Api.Tests/Sync/SyncNoticeTests.cs`:
  - `GET /api/sync/state` returns `{noticeAcknowledged:false, revision:0}` for a new user.
  - `POST /api/sync/push` and `GET /api/sync/changes` return `409 sync_notice_required` until `POST /api/sync/notice` (204, idempotent).
  - Every sync endpoint returns 401 without a session, and the `POST`s return 403 without a CSRF token.
- [ ] T010 [P] Extend `backend/MacroCounter.Api.Tests/Security/EndpointInventoryTests.cs` and `AccessMatrixTests.cs` with the 4 endpoints from contracts/sync-api.yaml, all `x-access: full`
- [ ] T011 [P] Rate-limit and size tests in `backend/MacroCounter.Api.Tests/Sync/SyncLimitsTests.cs`:
  - The `SyncPerUser` limiter allows 60 requests per minute per user and returns `429 rate_limited` with Retry-After.
  - A push body over 256 KiB returns 413.
  - `limit` > 500 is capped at 500.
  - One user hitting the limit does not limit another user.
  - Audit records `rate_limited` with reason `sync`.
- [ ] T012 [P] Device schema v2 migration tests in `frontend/src/data/db.test.ts` (extend):
  - Opening a v1 database upgrades it to v2 with new stores `outbox` (keyPath `key`) and `quarantine` (keyPath `key`).
  - The v1 data is unchanged.
  - `meta.sync.cursor = 0`, `meta.outboxSeq` initialised, and `meta.schemaVersion = 2`.
  - `runMigrations` gap checks still pass.
- [ ] T013 [P] Outbox tests in `frontend/src/data/outbox.test.ts`:
  - `enqueue(tx, key, op)` assigns an increasing `seq` from `meta.outboxSeq`.
  - Re-enqueueing a key replaces its op and `seq`.
  - `peek(limit)` returns items oldest `seq` first.
  - `ack(items)` removes only items whose `seq` is unchanged (an edit made in flight survives).
  - `quarantine(key, reason)` moves the item out of the outbox.
  - `pendingCount()` and `quarantineCount()` work.
- [ ] T014 [P] Repository-writes-outbox tests in `frontend/src/data/entryRepository.test.ts`, `savedFoodRepository.test.ts` and `proteinGoalRepository.test.ts` (extend):
  - create/update/upsert/setGoal write the record **and** `outbox['entry:<id>'|'food:<id>'|'goal:<id>'] = {op:'upsert'}` in one transaction.
  - Entry delete removes the record and writes `{op:'delete'}`.
  - An aborted transaction leaves neither write.
- [ ] T015 [P] HTTP client tests in `frontend/src/api/sync.test.ts`:
  - `getState`, `acknowledgeNotice`, `push` and `pull` call the contract paths, send `X-CSRF-Token` on `POST`, and validate responses with zod.
  - They map `409 sync_notice_required`, `400 invalid_request` with `invalid[]`, `too_many_changes`, `429` with Retry-After, `503 service_unavailable`, `401` and network failure to `ApiError` codes.
  - Add the new codes to `API_ERROR_CODES` in `frontend/src/api/http.ts`.
- [ ] T016 [P] Sync notice UI tests in `frontend/src/features/sync/SyncNotice.test.tsx`, per contracts/ui-sync.md "Sync notice":
  - Shown before Today when `noticeAcknowledged` is false.
  - The text mentions the server storage, that the owner can read the data, that photos are never stored, and that account removal deletes the data.
  - **Turn on sync** calls `acknowledgeNotice` and hides the notice.
  - Logging still works while the notice is unacknowledged and offline.
  - The setup flow's notice (in `frontend/src/auth/SetupFlow.test.tsx`) includes the sync text and acknowledges both notices.

### Implementation for Foundational

- [ ] T017 Add entity classes in `backend/MacroCounter.Api/Data/ActivityRecords.cs`:
  - `LogEntryRow`, `SavedFoodRow`, `ProteinGoalRow`, `SavedFoodAlias`, `ProteinGoalAlias`, `SyncState`, with the columns from data-model.md.
  - Doc comment: "mapped so migrations create the tables; rows are written with raw SQL by SyncStore".
- [ ] T018 Map the new entities in `backend/MacroCounter.Api/Data/IdentityDbContext.cs` under schema `macro_data`:
  - snake_case columns, PKs, FKs (cascade), indexes and check constraints exactly as data-model.md.
  - `double precision` for all amounts and macros (no rounding, Principle II).
  - Update the class doc comment to "identity, security and activity data (constitution v3.0.0)".
- [ ] T019 Generate the EF migration `backend/MacroCounter.Api/Data/Migrations/<ts>_ActivityData.cs` (`dotnet ef migrations add ActivityData`), then add hand-written SQL to it:
  - `revoke all on schema macro_data from public` (and from `anon, authenticated` when present, as in `RolesGrantsAndRls`).
  - Enable RLS on every `macro_data` table.
  - `create or replace function macro_admin.grant_app_role(p_role name)` keeping every existing grant, and adding:
    - `usage` on `macro_data`;
    - `select, insert, update` on all six tables;
    - a policy `for all to p_role using (user_id = current_setting('macro.user_id', true)::uuid) with check (same)` on each table.
  - The `Down` restores the previous function body.
  - Depends on T018.
- [ ] T020 Add audit codes in `backend/MacroCounter.Api/Audit/AuditLog.cs`: events `sync_rejected`, `user_deleted`, and reasons `invalid_record`, `day_key_changed`, `too_many_changes`, `unknown_schema_version`, `sync`. Include the check-constraint update in the T019 migration (or a follow-on migration if T019 is already generated). Update `Audit/AuditCoverageTests.cs` expectations.
- [ ] T021 [P] Implement `backend/MacroCounter.Api/Sync/ClockSkew.cs` as a pure static class (makes T007 pass)
- [ ] T022 [P] Implement the request/response records in `backend/MacroCounter.Api/Sync/SyncContracts.cs`, matching contracts/sync-api.yaml exactly:
  - `Change` is a discriminated union by `op`, and `record` by `type`.
  - Wire names are camelCase.
  - Unknown properties are rejected by StrictJson.
- [ ] T023 Implement `backend/MacroCounter.Api/Sync/SyncValidator.cs`, makes T008 pass:
  - Bounds come from the data-model.md table.
  - It returns all invalid indexes with fixed reason codes.
  - Depends on T022.
- [ ] T024 Implement the base of `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - `BeginUserTransaction(userId)` opens a transaction and runs `select set_config('macro.user_id', $1, true)`.
  - `GetState`/`EnsureState` (insert `sync_state` on first use).
  - `AcknowledgeNotice` sets `notice_ack_at` if null.
  - `BumpRevision(count)` uses `update macro_data.sync_state set revision = revision + $1 where user_id = $2 returning revision`, holding the row lock for the transaction (R2).
  - Depends on T019.
- [ ] T025 Add the `SyncPerUser` policy in `backend/MacroCounter.Api/Security/RateLimits.cs`:
  - 60 requests per minute, partitioned by session user ID, rejected with problem `rate_limited` + Retry-After.
  - Audit `rate_limited` with reason `sync` (makes the limit part of T011 pass).
- [ ] T026 Implement `backend/MacroCounter.Api/Sync/SyncEndpoints.cs`, and register it with `api.MapSyncEndpoints()` in `backend/MacroCounter.Api/Program.cs`:
  - `GET /api/sync/state`, `POST /api/sync/notice`.
  - Stubs for `POST /api/sync/push` and `GET /api/sync/changes`, which enforce the notice gate (`409 sync_notice_required`), the 256 KiB request size limit and the `SyncPerUser` limiter.
  - The user ID comes only from the session claims (`Auth/AuthClaims.cs`).
  - Makes T009, T010 and T011 pass. Depends on T024 and T025.
- [ ] T027 [P] Bump the device schema in `frontend/src/data/db.ts`:
  - `SCHEMA_VERSION = 2`.
  - Add `outbox: { key: string; value: OutboxItem }` and `quarantine: { key: string; value: QuarantineItem }` to `MacroDb`.
  - Migration `version: 2` creates both stores and puts `sync.cursor = 0` and `outboxSeq = 0` in `meta`.
  - The enqueueing of existing records is added in US2 (T050).
  - Makes T012 pass.
- [ ] T028 Implement `frontend/src/data/outbox.ts`:
  - `OutboxItem = { key: 'entry:<id>'|'food:<id>'|'goal:<id>', op: 'upsert'|'delete', seq: number }`, `QuarantineItem = { key, reason, at }`.
  - Functions take an open transaction so callers stay atomic.
  - Makes T013 pass. Depends on T027.
- [ ] T029 Make the repositories write the outbox in the same transaction:
  - Files: `frontend/src/data/entryRepository.ts`, `savedFoodRepository.ts`, `proteinGoalRepository.ts`.
  - Widen each transaction to `['entries'|'savedFoods'|'proteinGoals', 'outbox', 'meta']`.
  - New records use `schemaVersion: 1` (the record schema), not the DB `SCHEMA_VERSION`.
  - Makes T014 pass. Depends on T028.
- [ ] T030 [P] Implement `frontend/src/api/sync.ts` through the existing `frontend/src/api/http.ts`. zod schemas mirror contracts/sync-api.yaml, and record schemas reuse `frontend/src/data/records.ts`. Makes T015 pass.
- [ ] T031 [P] Implement the change emitter in `frontend/src/data/changes.ts`: `createChanges()` returns `{ subscribe(listener): () => void, emit(types: Set<'entry'|'food'|'goal'>) }`
- [ ] T032 Extend `UserData` in `frontend/src/app/services.tsx` with `changes` (T031) and `sync` (filled in by US1). Wire them in the `openUserData` implementation and in `frontend/src/data/lockedData.ts` (locked stand-ins reject). Depends on T030 and T031.
- [ ] T033 Implement `frontend/src/features/sync/SyncNotice.tsx` and gate it in the authenticated shell (where Today is rendered behind `frontend/src/auth/AuthGate.tsx`):
  - Fetch `getState` after sign-in, show the notice when unacknowledged, and never block logging.
  - Extend the setup notice text in `frontend/src/auth/SetupFlow.tsx` so it acknowledges both.
  - Makes T016 pass.

**Checkpoint**: Server schema, RLS and grants are in place. Sync endpoints exist and are gated.
Devices queue every local change. The notice works. `scripts/check.ps1` is green.

---

## Phase 3: User Story 1 - See the same log on every device (Priority: P1) 🎯 MVP

**Goal**: Create, edit and delete on one device shows up on the user's other open devices within
10 s. A new device gets the full history.

**Independent Test**: Two browser contexts, one account. Add, edit and delete on A, and check that B
matches within 10 s. A third fresh context gets everything (quickstart V1).

### Tests for User Story 1 (write first, see them fail)

- [ ] T034 [P] [US1] Push contract tests in `backend/MacroCounter.Api.Tests/Sync/SyncPushTests.cs`:
  - Upsert of an entry, a food and a goal: `200 {revision, results:[{status:'applied'}]}`.
  - Revision increases by the number of applied changes.
  - Re-sending the same push is idempotent (`superseded`, no revision change for equal `effective_at`).
  - Changing `dayKey` of an existing entry gives `400 invalid_request` with reason `day_key_changed`.
  - **All or nothing**: one invalid change in a batch of 5 applies none (FR-014), and audit records `sync_rejected` with a reason code only.
- [ ] T035 [P] [US1] Conflict-matrix tests in `backend/MacroCounter.Api.Tests/Sync/SyncConflictTests.cs` (R3, FR-007, SC-007):
  - A newer corrected time wins and an older one is `superseded`; a tie keeps the stored version.
  - Device A's clock 2 h fast, edit pushed later, is ordered correctly against device B.
  - Delete versus older edit and delete versus newer edit: **delete wins both**.
  - Upsert after tombstone gives `superseded`, and the tombstone is kept.
  - Uses `FakeTimeProvider`.
- [ ] T036 [P] [US1] Pull tests in `backend/MacroCounter.Api.Tests/Sync/SyncPullTests.cs`:
  - `since=0` returns all records oldest revision first.
  - Pages of `limit` with `cursor`/`hasMore`.
  - Tombstones come back as `{type, revision, id, deleted:true}`.
  - The record shape equals the device record (camelCase, `updatedAt` = `effective_at`, full precision such as `kcal: 123.456789`).
  - An empty result returns `cursor = since`.
- [ ] T037 [P] [US1] Concurrency test in `backend/MacroCounter.Api.Tests/Sync/SyncConcurrencyTests.cs`: 2 parallel pushes of 50 changes each for one user. Then a pull from 0 returns 100 revisions, dense and gap-free, and a pull started between commits never skips a revision (R2).
- [ ] T038 [P] [US1] Sync engine tests in `frontend/src/sync/syncEngine.test.ts` (fake API + fake-indexeddb):
  - A round is push then pull.
  - Push sends the current record for each outbox key (coalesced) in batches of ≤ 200, with `clientNow`.
  - `applied`/`superseded` results ack the items by `seq`.
  - Pull loops while `hasMore` and saves `sync.cursor` after each page.
  - A `401` stops the round and keeps the outbox.
  - Nutrition totals for a reference day are identical before and after a round trip (Principle II, SC-006).
- [ ] T039 [P] [US1] Remote-apply tests in `frontend/src/data/remoteApply.test.ts`:
  - Pulled upserts are written **without** creating outbox items.
  - A tombstone removes the local entry.
  - A key with a pending outbox item is skipped (R2).
  - `changes.emit` fires once per page with the affected types.
- [ ] T040 [P] [US1] Scheduler tests in `frontend/src/sync/scheduler.test.ts` (vitest fake timers):
  - Polls every 5 s while `document.visibilityState === 'visible'` and online.
  - No polling while hidden.
  - A round runs 500 ms (debounced) after a local change, on `visibilitychange` to visible, and on start-up.
  - Never runs two rounds at once.
  - Does nothing until the notice is acknowledged.
- [ ] T041 [P] [US1] Live refresh tests:
  - `frontend/src/features/today/DayLog.test.tsx`, `frontend/src/features/recent/RecentFoods.test.tsx`, `frontend/src/features/goal/GoalSettings.test.tsx`: emitting the relevant change type reloads the data with no remount.
  - `frontend/src/features/today/EntryEditor.test.tsx`: an entry deleted remotely while open closes the editor with the announcement "This entry was deleted on another device"; unsaved edits survive a remote change (contracts/ui-sync.md "Live updates").
- [ ] T042 [P] [US1] Status indicator tests in `frontend/src/features/sync/SyncStatus.test.tsx`:
  - States synced / syncing (only after more than 1 s) / failing / off, with text labels.
  - 44×44 px target, and tapping shows the explanation (contracts/ui-sync.md "Sync status").
- [ ] T043 [US1] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts`, using two browser contexts signed in as `e2e-owner`:
  - Log on A → visible on B within 10 s.
  - Edit on B → A updates.
  - Delete on A → gone on B and stays gone after reload.
  - A third fresh context gets the full history.
  - Add the spec to the signed-in Playwright project in `frontend/playwright.config.ts`, and make `scripts/e2e-db.ps1` pre-acknowledge or reset the sync notice as each test needs.

### Implementation for User Story 1

- [ ] T044 [US1] Implement push in `backend/MacroCounter.Api/Sync/SyncStore.cs` (R3):
  - In one user transaction: validate (T023), lock and bump the revision, then per change compute `effective_at` with `ClockSkew`.
  - Upsert: `insert … on conflict (user_id, id) do update … where macro_data.<t>.deleted_at is null and excluded.effective_at > macro_data.<t>.effective_at`, giving `applied` or `superseded`.
  - Delete: set `deleted_at` (and revision) whatever the times.
  - Reject a changed `day_key`.
  - Compute `normalized_name = lower(btrim(name))` server-side.
  - Only applied changes consume revisions.
  - Makes T034, T035 and T037 pass.
- [ ] T045 [US1] Implement pull in `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - A `union all` across the three tables `where revision > $since order by revision limit $limit`.
  - Map rows to the wire shape, tombstones as `deleted:true`.
  - Makes T036 pass. Depends on T044.
- [ ] T046 [US1] Replace the push and changes stubs in `backend/MacroCounter.Api/Sync/SyncEndpoints.cs` with calls to T044/T045. Return `400 invalid_request` with `invalid[]` or `too_many_changes` from the validator, and audit `sync_rejected` (reason code only).
- [ ] T047 [P] [US1] Implement `frontend/src/data/remoteApply.ts`: write pulled records in one transaction per page (`entries`, `savedFoods`, `proteinGoals`, `outbox`, `meta`), skip pending keys, delete on tombstone, advance `sync.cursor`, and emit changes. Makes T039 pass.
- [ ] T048 [US1] Implement `frontend/src/sync/syncEngine.ts`: `runRound()` = push (peek ≤ 200 → read current records → `api.push` → ack by `seq`) then pull (loop pages via T047). It exposes `pendingCount()` and the last outcome. Makes T038 pass. Depends on T047.
- [ ] T049 [US1] Implement `frontend/src/sync/scheduler.ts` and `frontend/src/sync/useSyncStatus.ts`:
  - The scheduler owns the timers and triggers (T040) and starts once the notice is acknowledged.
  - `useSyncStatus` derives the ui-sync.md states from engine outcomes.
  - Implement `frontend/src/features/sync/SyncStatus.tsx` and place it in the Today header beside the account menu (`frontend/src/features/today/TodayScreen.tsx`).
  - Subscribe `DayLog`, `RecentFoods`, `GoalSettings` and the history `DayView` to `services.changes`. Handle a remote delete in `EntryEditor`.
  - Makes T040, T041, T042 and T043 pass.

**Checkpoint**: Two online devices stay in sync, and a new device gets the full history. This is the
MVP. It is not releasable to friends until US4 (account deletion) is done.

---

## Phase 4: User Story 2 - Keep the data I already have (Priority: P1)

**Goal**: The first sync uploads each device's existing data and merges it with no loss or
duplicates. Saved foods and goal days merge by natural key.

**Independent Test**: Seed different v1 data on two browsers (including the same food on both). After
both sync, each shows the union exactly once, with a single saved food (quickstart V2, SC-002).

### Tests for User Story 2 (write first, see them fail)

- [ ] T050 [P] [US2] Migration-enqueue test in `frontend/src/data/db.test.ts` (extend): upgrading a v1 database with 3 entries, 2 foods and 1 goal leaves 6 `upsert` outbox items with increasing `seq`, and `sync.cursor = 0` (R6)
- [ ] T051 [P] [US2] Natural-key merge tests in `backend/MacroCounter.Api.Tests/Sync/SyncMergeTests.cs` (R4):
  - Two different IDs for food "Greek yogurt"/`g` (and " greek YOGURT "/`g`, from `vectors/normalize.json`) give one canonical row and an alias row, with result `merged` and `canonicalId`.
  - The newer corrected macros win on the canonical row, and `last_used_at` keeps the later value.
  - The same name with a different unit is **not** merged.
  - A goal with the same `effective_from` merges the same way.
  - An upsert addressed to an alias ID updates the canonical row.
  - An incoming entry whose `savedFoodId` is an alias is stored with the canonical ID.
  - An unknown `savedFoodId` is accepted as-is.
- [ ] T052 [P] [US2] Device merge-handling tests in `frontend/src/sync/syncEngine.test.ts` (extend): a `merged` result rewrites the local saved food or goal to `canonicalId`, repoints every local entry whose `savedFoodId` was the alias, and drops the alias outbox key, all in one transaction
- [ ] T053 [P] [US2] Quarantine tests in `frontend/src/sync/syncEngine.test.ts` (extend):
  - Before pushing, each record is checked against `vectors/bounds.json` rules. A failing record goes to `quarantine` with its reason, and the rest of the batch is pushed.
  - The status shows "N can't sync".
  - The record stays visible locally.
- [ ] T054 [US2] E2E first-sync merge in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend):
  - Seed two contexts' v1 IndexedDB with different entries plus the same food (helper in `frontend/tests/e2e/helpers/`).
  - Sign in and acknowledge on both.
  - Both show the union exactly once, there is one quick-pick "Greek yogurt", and the entries link to it.

### Implementation for User Story 2

- [ ] T055 [US2] Extend migration `version: 2` in `frontend/src/data/db.ts` to enqueue an `upsert` outbox item for every existing entry, saved food and goal. Makes T050 pass.
- [ ] T056 [US2] Implement natural-key merges in `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - Before inserting a new food or goal ID, look up a live row with the same `(normalized_name, ref_unit)` or `effective_from`.
  - If one exists: apply LWW to the canonical row, insert `saved_food_aliases`/`protein_goal_aliases`, and report `merged` + `canonicalId`.
  - Resolve alias IDs on upsert, and rewrite aliased `saved_food_id` on incoming entries.
  - Makes T051 pass.
- [ ] T057 [US2] Handle `merged` results in `frontend/src/sync/syncEngine.ts` with a new `rewriteId` in `frontend/src/data/remoteApply.ts`. Makes T052 pass.
- [ ] T058 [US2] Implement the device pre-push check in `frontend/src/data/syncBounds.ts` (zod, exactly the data-model.md bounds). Use it in `syncEngine.ts` to quarantine records, and surface `quarantineCount()` in `useSyncStatus`. Makes T053 and T054 pass.

**Checkpoint**: Existing users can turn on sync without losing or duplicating anything.

---

## Phase 5: User Story 3 - Log while offline (Priority: P2)

**Goal**: Offline logging is instant. Changes sync automatically on reconnect, the UI shows what
is pending, and signing out warns about unsynced changes.

**Independent Test**: A context goes offline, logs and edits, goes online, and a second context
receives the changes. Signing out offline shows the warning (quickstart V3, V6).

### Tests for User Story 3 (write first, see them fail)

- [ ] T059 [P] [US3] Scheduler offline tests in `frontend/src/sync/scheduler.test.ts` (extend):
  - No requests while `navigator.onLine` is false.
  - The `online` event triggers an immediate round.
  - On network, 5xx, 429 or `service_unavailable` failures, retries back off 5→10→20→40→60 s (429 honours Retry-After).
  - Any immediate trigger resets the backoff.
- [ ] T060 [P] [US3] Status tests in `frontend/src/features/sync/SyncStatus.test.tsx` (extend): "N not synced" (pending), "Offline: will sync later", "Sync problem, retrying" (failing). Logging while offline updates the totals immediately (`frontend/src/features/today/TodayScreen.test.tsx`).
- [ ] T061 [P] [US3] In-flight edit test in `frontend/src/sync/syncEngine.test.ts` (extend): an edit made while a push is in flight keeps its outbox item (new `seq`) and is pushed in the next round
- [ ] T062 [P] [US3] Sign-out warning tests in `frontend/src/auth/AccountMenu.test.tsx`, per contracts/ui-sync.md:
  - With a non-empty outbox, "Sign out" and "Sign out everywhere" show an inline confirmation "N changes haven't synced yet…" with **Sign out anyway** / **Cancel**.
  - No `window.confirm`.
  - With an empty outbox, behaviour is unchanged.
- [ ] T063 [US3] E2E offline in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend):
  - `contextA.setOffline(true)` → log 2 foods and edit 1 → the status shows offline → `setOffline(false)` → B receives them within 10 s.
  - Offline sign-out shows the warning. Signing in as `e2e-friend` on A does not show the entry. Signing back in as `e2e-owner` online syncs it.

### Implementation for User Story 3

- [ ] T064 [US3] Add the offline gating, `online` trigger, exponential backoff and Retry-After handling to `frontend/src/sync/scheduler.ts`. Makes T059 pass.
- [ ] T065 [US3] Add the pending / offline / failing states to `frontend/src/sync/useSyncStatus.ts` and `frontend/src/features/sync/SyncStatus.tsx`. Makes T060 and T061 pass (verify `ack` by `seq` from T028).
- [ ] T066 [US3] Add the inline unsynced-changes confirmation to `frontend/src/auth/AccountMenu.tsx`, using `services.sync.pendingCount()`. Makes T062 and T063 pass.

**Checkpoint**: Logging works anywhere, and nothing done offline is lost.

---

## Phase 6: User Story 4 - Trust that my data is mine (Priority: P2)

**Goal**: The data is provably isolated per user. Removing a user deletes their data. Food data
never reaches logs or audit.

**Independent Test**: Cross-user attempts through every sync path are refused or isolated, and
`delete_user` leaves zero rows (quickstart V5, SC-005).

### Tests for User Story 4 (write first, see them fail)

- [ ] T067 [P] [US4] Isolation tests in `backend/MacroCounter.Api.Tests/Security/SyncIsolationTests.cs` (extend `CrossUserTests.cs` patterns):
  - User X pushes upserts and deletes using IDs that exist for user Y. Y's rows are unchanged, and X gets its own rows.
  - X's pull never contains Y's records.
  - No sync request body or query accepts a user ID (contract has none; StrictJson rejects `userId`).
  - Every sync endpoint returns 401 when unauthenticated (SC-005: 0 successful cross-user reads or writes).
- [ ] T068 [P] [US4] `delete_user` tests in `backend/MacroCounter.Api.Tests/Database/DeleteUserTests.cs`:
  - After `select macro_admin.delete_user('<y>')`, every `macro_data` table and every `macro` user table has 0 rows for Y.
  - Y's audit rows are kept with `user_id` null, plus a new `user_deleted` (actor `owner`).
  - The app role cannot execute the function.
  - An unknown username raises an error.
- [ ] T069 [P] [US4] Sentinel log and audit scan in `backend/MacroCounter.Api.Tests/Audit/SecretScanTests.cs` (extend). Push valid and invalid records named `"SENTINEL-FOOD-7f3a"`, then assert the string appears in no captured log line (`Infrastructure/CapturingLogger.cs`) and no `macro.audit_events` column (FR-015, FR-019, R9).

### Implementation for User Story 4

- [ ] T070 [US4] Add a migration `backend/MacroCounter.Api/Data/Migrations/<ts>_DeleteUser.cs` (or append to `<ts>_ActivityData` if it is not yet applied anywhere) with `macro_admin.delete_user(p_username text) returns void`:
  - It follows `disable_user`'s pattern (`find_user`, `owner_audit('user_deleted', id)` **before** the delete, then `delete from macro.users where id = v_id`).
  - Run `revoke execute … from public`.
  - Makes T068 pass.
- [ ] T071 [US4] Fix any isolation or logging gaps found by T067/T069 in `backend/MacroCounter.Api/Sync/SyncStore.cs`, `SyncEndpoints.cs` and `Security/RefusedRequestLogging.cs`, until both pass
- [ ] T072 [P] [US4] Document `delete_user` in `specs/003-auth-security-foundations/contracts/owner-procedures.md` (new section, with a link back to 007 research R8)

**Checkpoint**: All four stories work. The feature is releasable once the Polish phase passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T073 [P] Update `docs/deploy.md`:
  - §1 heading "identity and security data only" becomes "identity, security and activity data".
  - Re-run `grant_app_role` after migrating.
  - Backup retention note (Supabase ≤ 7 days, R8).
  - `delete_user` usage.
  - Rollout order: migrate, then deploy (quickstart "Production rollout").
- [ ] T074 [P] Update `scripts/dev-db.ps1` and `scripts/e2e-db.ps1` so they re-run `macro_admin.grant_app_role` after migrations, and the e2e setup can reset `macro_data` between runs
- [ ] T075 [P] Narrow spec FR-016 wording in `specs/007-cross-device-sync/spec.md` to "Removing a user (by the owner, including on the user's request)…", per research R8
- [ ] T076 Performance check for SC-003: seed one year of data (about 2,500 records) with an e2e helper, and assert that a fresh context is ready in < 15 s, in `frontend/tests/e2e/auth/sync-two-devices.spec.ts`. Also measure that an empty pull is < 30 ms p95 in a backend test (`Sync/SyncPullTests.cs`, a loose bound to avoid flakiness)
- [ ] T077 Run `scripts/check.ps1` (full gate: backend, frontend unit with 100% nutrition coverage, e2e, `npm audit`, `dotnet list package --vulnerable`, secret scan) and fix any failures
- [ ] T078 Run the manual scenarios V1–V6 in `specs/007-cross-device-sync/quickstart.md` and record the results in the PR description
- [ ] T079 Governance gate: run `/security-review` plus an ASVS L2 pass over `/api/sync/*`, `SyncStore` and the `macro_data` grants and RLS. Resolve or risk-accept the findings in writing in the PR (constitution Governance, plan threat model S1–S11)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup and **blocks all stories**
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after US1. It extends `SyncStore` push (T044) and `syncEngine` (T048)
- **US3 (Phase 5)**: after US1, because it extends the scheduler and status. It is independent of US2, so US2 and US3 can run in parallel
- **US4 (Phase 6)**: after Foundational. Its isolation tests need US1's push and pull (T044–T046), and T070 (`delete_user`) can start right after T019
- **Polish (Phase 7)**: after all stories

### Within each phase

- Test tasks come first and must fail before their implementation tasks
- Backend: migration (T019) → `SyncStore` → endpoints
- Frontend: db v2 (T027) → outbox (T028) → repositories (T029) → engine → scheduler → UI

### Key task dependencies

- T018 → T019 → T024 → T026 (backend foundation chain)
- T022 → T023 → T044 → T045 → T046
- T027 → T028 → T029; T030 and T031 → T032 → T033
- T047 → T048 → T049
- T044 → T056; T048 → T057 and T058
- T049 → T064 → T065; T048 → T066

---

## Parallel Examples

### Foundational tests (all different files)

```text
T005 ActivityDataMigrationTests.cs   T006 AppRoleGrantTests.cs     T007 ClockSkewTests.cs
T008 SyncValidatorTests.cs           T009 SyncNoticeTests.cs       T011 SyncLimitsTests.cs
T012 db.test.ts                      T013 outbox.test.ts           T015 sync.test.ts
T016 SyncNotice.test.tsx
```

### User Story 1 tests

```text
Backend:  T034 SyncPushTests.cs   T035 SyncConflictTests.cs   T036 SyncPullTests.cs   T037 SyncConcurrencyTests.cs
Frontend: T038 syncEngine.test.ts T039 remoteApply.test.ts    T040 scheduler.test.ts  T041 live refresh  T042 SyncStatus.test.tsx
```

### After US1: two streams

```text
Stream A (US2): T050–T054 tests → T055 → T056 → T057 → T058
Stream B (US3): T059–T063 tests → T064 → T065 → T066
```

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 Setup, then Phase 2 Foundational (schema, RLS, notice, outbox).
2. Phase 3 US1: two online devices in sync.
3. **Stop and validate**: run quickstart V1 and `scripts/check.ps1`.
4. The MVP is suitable for the owner's own devices only. Existing local data does not upload until
   US2, and account deletion is not available until US4. **Do not invite friends to use it before
   US2 and US4 are done** (constitution Principle III: removing a user must delete their data).

### Incremental delivery

1. Foundation + US1 → owner-only check on two devices.
2. + US2 → existing data merges. Safe to deploy for the owner's real data.
3. + US3 → full offline confidence and the sign-out warning.
4. + US4 + Polish (security review) → release to friends.

---

## Notes

- [P] = different files with no unfinished dependencies. Tasks that extend the same test file (for
  example `syncEngine.test.ts` in US1/US2/US3) are sequential across phases.
- Verify each test fails for the right reason before implementing.
- Commit after each task or logical group. Tests and implementation may share a commit only if the
  red step was observed (Principle I).
- Never call Supabase or Claude from tests. Never log record contents.
