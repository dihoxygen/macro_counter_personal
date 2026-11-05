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
The data design for US5–US8 ships in Foundational and US1, and only their screens wait (research R20).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US8)
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
- **E2E**: specs that open their own `browser.newContext()` must set `sessionStorage macro.introPlayed`
  to skip the splash.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Folders, shared test vectors and constants that both sides read

- [X] T001 Create folders `backend/MacroCounter.Api/Sync/`, `backend/MacroCounter.Api.Tests/Sync/vectors/`, `frontend/src/sync/`, `frontend/src/features/sync/` and `frontend/src/features/trends/` (add each only when its first file is created; no placeholder files)
- [X] T002 [P] Create shared validation vectors at `backend/MacroCounter.Api.Tests/Sync/vectors/bounds.json`. Include valid and invalid cases for every row of data-model.md "Validation bounds", verbatim:
  - name: "Non-empty after trim, ≤ 120 chars"
  - quantity `amount`: "Finite, 0 ≤ x ≤ 100 000"
  - `unit`: "`g`, `ml`, `serving`"
  - `kcal`: "Finite, 0 ≤ x ≤ 100 000"
  - `proteinG`, `carbsG`, `fatG`: "Finite, 0 ≤ x ≤ 10 000"
  - goal `grams`: "null, or finite, 0 < x ≤ 10 000"
  - `dayKey`/`effectiveFrom`: "`YYYY-MM-DD`, a real calendar date"
  - timestamps: "ISO 8601 with offset"
  - `schemaVersion`: "Known version (1)"
  - `mealCategory`: "`breakfast`, `lunch`, `dinner`, `snacks`, or null"
  - `versionId`, `entryId`: "UUID"
  - `changeType`: "`edit`, `delete`, `restore`"

  Each case is `{ type, record, valid, reason? }`, with reason in `invalid_record | unknown_schema_version`. Types are `entry | food | goal | version`.
- [X] T003 [P] Create shared name-normalization vectors at `backend/MacroCounter.Api.Tests/Sync/vectors/normalize.json`, covering the device rule `trim().toLowerCase()` against the server's `lower(btrim(name))` (spaces, tabs, mixed case, non-ASCII letters such as "Crème Brûlée", and trailing newline)
- [X] T004 [P] Let the frontend tests read the vectors: add a helper `frontend/src/test/syncVectors.ts` that imports `../../../backend/MacroCounter.Api.Tests/Sync/vectors/*.json`. Check that `tsconfig.app.json`/vitest config allow the JSON import, and adjust the vitest config if needed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server schema and security, the notice gate, the device v2 schema with outbox and version
capture, category pre-fill, saved-food links, and the HTTP client. Every story depends on these. Data
that is not captured from the first sync can never be recovered, so none of this can wait (R20).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write first, see them fail)

- [X] T005 [P] Migration/schema tests in `backend/MacroCounter.Api.Tests/Database/ActivityDataMigrationTests.cs`:
  - Schema `macro_data` exists with tables `log_entries`, `entry_versions`, `saved_foods`, `protein_goals`, `saved_food_aliases`, `protein_goal_aliases`, `sync_state`.
  - Each data table has PK `(user_id, id)` and FK `user_id → macro.users(id) on delete cascade`.
  - Index `(user_id, revision)` on each data table. `entry_versions` also has `(user_id, entry_id)` and `(replaced_at)`.
  - `saved_foods` has the partial unique index `(user_id, normalized_name, ref_unit) where deleted_at is null`, and `protein_goals` has unique `(user_id, effective_from)`.
  - Check constraints reject: `quantity_unit` outside `g|ml|serving`, negative or over-bound macros ("`kcal` ≤ 100 000, others ≤ 10 000"), `quantity_amount` > 100 000, `source` outside `ai|ai-edited|manual`, name empty after trim or > 120 chars, goal `grams` ≤ 0 or > 10 000 (null allowed), `meal_category` outside `breakfast|lunch|dinner|snacks` (null allowed), and `change_type` outside `edit|delete|restore`.
  - `log_entries` requires its data columns when `deleted_at is null`, and accepts them null on a tombstone (R16).
  - RLS is enabled on every `macro_data` table.
  - `macro_admin.purge_expired()` removes `entry_versions` rows with `replaced_at` older than 90 days, keeps newer ones, leaves tombstones in place, and still performs its existing purges (R16, threat S12).
- [X] T006 [P] Grant tests in `backend/MacroCounter.Api.Tests/Database/AppRoleGrantTests.cs` (extend). After `macro_admin.grant_app_role(<role>)`:
  - The app role has `select, insert, update` and **no `delete`** on every `macro_data` table except `entry_versions`, and no DDL.
  - On `entry_versions` it has only `select, insert`.
  - With `macro.user_id` unset, `select count(*)` on each table returns 0.
  - With it set to user A, an unscoped `select` returns only A's rows (plan threat S2).
- [X] T007 [P] `ClockSkew` unit tests in `backend/MacroCounter.Api.Tests/Sync/ClockSkewTests.cs`:
  - `offset = serverNow − clientNow`, and `effective = updatedAt + offset`, clamped to `serverNow`.
  - Device clocks ±2 h and ±3 days wrong give the correct ordering.
  - A future-dated edit is clamped.
  - Equal inputs give equal outputs.
  - Use `FakeTimeProvider`.
- [X] T008 [P] `SyncValidator` tests in `backend/MacroCounter.Api.Tests/Sync/SyncValidatorTests.cs`:
  - Drive every case in `vectors/bounds.json` (T002).
  - `record.id` must equal the change `id`.
  - `delete` and `restore` are allowed only for `type: entry`, and `insert` only for `type: version`.
  - A pushed `restoredAt` is rejected, because it is pull-only (R15).
  - More than 200 changes gives `too_many_changes`. Versions count toward the 200.
  - The result lists `{index, reason}` and never echoes field values.
- [X] T009 [P] Notice-gate and access tests in `backend/MacroCounter.Api.Tests/Sync/SyncNoticeTests.cs`:
  - `GET /api/sync/state` returns `{noticeAcknowledged:false, revision:0}` for a new user.
  - `POST /api/sync/push` and `GET /api/sync/changes` return `409 sync_notice_required` until `POST /api/sync/notice` (204, idempotent).
  - Every sync endpoint returns 401 without a session, and the `POST`s return 403 without a CSRF token.
- [X] T010 [P] Extend `backend/MacroCounter.Api.Tests/Security/EndpointInventoryTests.cs` and `AccessMatrixTests.cs` with the 4 endpoints from contracts/sync-api.yaml, all `x-access: full`
- [X] T011 [P] Rate-limit and size tests in `backend/MacroCounter.Api.Tests/Sync/SyncLimitsTests.cs`:
  - The `SyncPerUser` limiter allows 60 requests per minute per user and returns `429 rate_limited` with Retry-After.
  - A push body over 256 KiB returns 413.
  - `limit` > 500 is capped at 500.
  - One user hitting the limit does not limit another user.
  - Audit records `rate_limited` with reason `sync`.
- [X] T012 [P] Device schema v2 migration tests in `frontend/src/data/db.test.ts` (extend):
  - Opening a v1 database upgrades it to v2 with new stores `outbox` (keyPath `key`), `quarantine` (keyPath `key`) and `entryVersions` (keyPath `id`, indexes `entryId`, `dayKey`, `replacedAt`).
  - Every existing entry gains `mealCategory: null` and a new `versionId`. `updatedAt` and all other fields are unchanged.
  - `meta.sync.cursor = 0`, `meta.outboxSeq` initialised, and `meta.schemaVersion = 2`.
  - `runMigrations` gap checks still pass.
- [X] T013 [P] Outbox tests in `frontend/src/data/outbox.test.ts`:
  - `enqueue(tx, key, op)` assigns an increasing `seq` from `meta.outboxSeq`.
  - Re-enqueueing a key replaces its op and `seq`, except that a pending `restore` stays `restore` when an `upsert` follows it (R15).
  - `peek(limit)` returns items oldest `seq` first.
  - `ack(items)` removes only items whose `seq` is unchanged (an edit made in flight survives).
  - `quarantine(key, reason)` moves the item out of the outbox.
  - `pendingCount()` and `quarantineCount()` work.
- [X] T014 [P] `categoryForTime` tests in `frontend/src/domain/meals.test.ts`, covering each boundary of the spec's windows in local time: Breakfast 04:00–10:59, Lunch 11:00–14:59, Dinner 17:00–21:59, Snacks at all other times (including 15:00–16:59 and 22:00–03:59). 100% coverage
- [X] T015 [P] Repository-writes tests in `frontend/src/data/entryRepository.test.ts`, `savedFoodRepository.test.ts` and `proteinGoalRepository.test.ts` (extend):
  - create/update/upsert/setGoal write the record **and** `outbox['entry:<id>'|'food:<id>'|'goal:<id>'] = {op:'upsert'}` in one transaction.
  - Entry create assigns a `versionId`. Update assigns a new one.
  - Entry update adds the old state to `entryVersions` with `changeType: 'edit'`, `entryId`, `replacedAt`, and `id` equal to the old `versionId`, and queues `version:<id>` with `{op:'insert'}`.
  - Entry update that changes nothing writes nothing (R14).
  - Entry delete adds the state with `changeType: 'delete'`, queues it, removes the record, and writes `{op:'delete'}`.
  - Records are stamped `schemaVersion: 1` (the record schema), not the DB `SCHEMA_VERSION`.
  - `EntryPatch` accepts a non-null `mealCategory` and leaves `dayKey` fixed.
  - An aborted transaction leaves no write.
  - `frontend/src/data/entryVersionRepository.test.ts`: `listAll` returns every stored version.
- [X] T016 [P] Link and pre-fill tests:
  - `frontend/src/data/logService.test.ts`: `confirmEntries` saves the food first and creates the entry with that food's ID, for both new and existing foods (R18).
  - `frontend/src/domain/review.test.ts` and `frontend/src/features/add-food/ManualEntryForm.test.tsx`, `frontend/src/features/recent/RelogForm.test.tsx`: new entries carry `categoryForTime(now())` and never a null category (FR-020, R20).
- [X] T017 [P] HTTP client tests in `frontend/src/api/sync.test.ts`:
  - `getState`, `acknowledgeNotice`, `push` and `pull` call the contract paths, send `X-CSRF-Token` on `POST`, and validate responses with zod, including `serverNow` and the `version` record type.
  - They map `409 sync_notice_required`, `400 invalid_request` with `invalid[]`, `too_many_changes`, `429` with Retry-After, `503 service_unavailable`, `401` and network failure to `ApiError` codes.
  - Add the new codes to `API_ERROR_CODES` in `frontend/src/api/http.ts`.
- [X] T018 [P] Sync notice UI tests in `frontend/src/features/sync/SyncNotice.test.tsx`, per contracts/ui-sync.md "Sync notice":
  - Shown before Today when `noticeAcknowledged` is false.
  - The text mentions the server storage, that the owner can read the data, that photos are never stored, that earlier versions and deleted entries are kept for 90 days, and that account removal deletes the data.
  - **Turn on sync** calls `acknowledgeNotice` and hides the notice.
  - Logging still works while the notice is unacknowledged and offline.
  - The setup flow's notice (in `frontend/src/auth/SetupFlow.test.tsx`) includes the sync text and acknowledges both notices.

### Implementation for Foundational

- [X] T019 Add entity classes in `backend/MacroCounter.Api/Data/ActivityRecords.cs`:
  - `LogEntryRow`, `EntryVersionRow`, `SavedFoodRow`, `ProteinGoalRow`, `SavedFoodAlias`, `ProteinGoalAlias`, `SyncState`, with the columns from data-model.md.
  - Doc comment: "mapped so migrations create the tables; rows are written with raw SQL by SyncStore".
- [X] T020 Map the new entities in `backend/MacroCounter.Api/Data/IdentityDbContext.cs` under schema `macro_data`:
  - snake_case columns, PKs, FKs (cascade), indexes and check constraints exactly as data-model.md.
  - `double precision` for all amounts and macros (no rounding, Principle II).
  - `log_entries` data columns are nullable, with a check that requires them when `deleted_at is null` (R16). `restored_at` stays optional.
  - Update the class doc comment to "identity, security and activity data (constitution v3.0.0)".
- [X] T021 Generate the EF migration `backend/MacroCounter.Api/Data/Migrations/<ts>_ActivityData.cs` (`dotnet ef migrations add ActivityData`), then add hand-written SQL to it:
  - `revoke all on schema macro_data from public` (and from `anon, authenticated` when present, as in `RolesGrantsAndRls`).
  - Enable RLS on every `macro_data` table.
  - `create or replace function macro_admin.grant_app_role(p_role name)` keeping every existing grant, and adding:
    - `usage` on `macro_data`;
    - `select, insert, update` on six tables, and `select, insert` on `entry_versions`;
    - a policy `for all to p_role using (user_id = current_setting('macro.user_id', true)::uuid) with check (same)` on each table.
  - `create or replace function macro_admin.purge_expired()` keeping every existing delete, adding `delete from macro_data.entry_versions where replaced_at < now() - interval '90 days'` to the total. Qualify the schema, because the function's `search_path` does not include `macro_data`. Keep `revoke all … from public`. The `pg_cron` schedule stays as it is.
  - The `Down` restores both previous function bodies.
  - Depends on T020. Makes T005 and T006 pass.
- [X] T022 Add audit codes in `backend/MacroCounter.Api/Audit/AuditLog.cs`: events `sync_rejected`, `user_deleted`, and reasons `invalid_record`, `day_key_changed`, `too_many_changes`, `unknown_schema_version`, `sync`. Include the check-constraint update in the T021 migration (or a follow-on migration if T021 is already generated). Update `Audit/AuditCoverageTests.cs` expectations.
- [X] T023 [P] Implement `backend/MacroCounter.Api/Sync/ClockSkew.cs` as a pure static class (makes T007 pass)
- [X] T024 [P] Implement the request/response records in `backend/MacroCounter.Api/Sync/SyncContracts.cs`, matching contracts/sync-api.yaml exactly:
  - `Change` is a discriminated union by `op` (`upsert`, `restore`, `insert`, `delete`), and `record` by `type` (`entry`, `food`, `goal`, `version`).
  - Wire names are camelCase.
  - Unknown properties are rejected by StrictJson.
- [X] T025 Implement `backend/MacroCounter.Api/Sync/SyncValidator.cs`, makes T008 pass:
  - Bounds come from the data-model.md table.
  - It returns all invalid indexes with fixed reason codes.
  - Depends on T024.
- [X] T026 Implement the base of `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - `BeginUserTransaction(userId)` opens a transaction and runs `select set_config('macro.user_id', $1, true)`.
  - `GetState`/`EnsureState` (insert `sync_state` on first use).
  - `AcknowledgeNotice` sets `notice_ack_at` if null.
  - `NextRevision()` uses `update macro_data.sync_state set revision = revision + 1 where user_id = $1 returning revision`, holding the row lock for the transaction (R2). Each row written takes one revision.
  - Depends on T021.
- [X] T027 Add the `SyncPerUser` policy in `backend/MacroCounter.Api/Security/RateLimits.cs`:
  - 60 requests per minute, partitioned by session user ID, rejected with problem `rate_limited` + Retry-After.
  - Audit `rate_limited` with reason `sync` (makes the limit part of T011 pass).
- [X] T028 Implement `backend/MacroCounter.Api/Sync/SyncEndpoints.cs`, and register it with `api.MapSyncEndpoints()` in `backend/MacroCounter.Api/Program.cs`:
  - `GET /api/sync/state`, `POST /api/sync/notice`.
  - Stubs for `POST /api/sync/push` and `GET /api/sync/changes`, which enforce the notice gate (`409 sync_notice_required`), the 256 KiB request size limit and the `SyncPerUser` limiter.
  - The user ID comes only from the session claims (`Auth/AuthClaims.cs`).
  - Makes T009, T010 and T011 pass. Depends on T026 and T027.
- [X] T029 [P] Update the device types in `frontend/src/data/records.ts` and `frontend/src/data/repositories.ts`:
  - `MealCategorySchema`: `breakfast | lunch | dinner | snacks`.
  - `LogEntry` gains `versionId: string`, `mealCategory: MealCategory | null`, and optional `restoredAt: string | null`.
  - New `EntryVersion`: the entry's fields plus `entryId`, `changeType` (`edit | delete | restore`) and `replacedAt`.
  - `NewEntry` requires a non-null `mealCategory`. `EntryPatch` accepts a non-null `mealCategory` (FR-020, FR-022).
  - Update test fixtures that build entries.
- [X] T030 Bump the device schema in `frontend/src/data/db.ts`:
  - `SCHEMA_VERSION = 2`, and a separate `RECORD_SCHEMA_VERSION = 1`.
  - Add `outbox`, `quarantine` and `entryVersions` to `MacroDb`.
  - Migration `version: 2` creates the three stores and indexes, sets `mealCategory: null` and a new `versionId` on every entry, and puts `sync.cursor = 0` and `outboxSeq = 0` in `meta`.
  - The enqueueing of existing records and the food links are added in US2.
  - Makes T012 pass. Depends on T029.
- [X] T031 Implement `frontend/src/data/outbox.ts`:
  - `OutboxItem = { key: 'entry:<id>'|'food:<id>'|'goal:<id>'|'version:<id>', op: 'upsert'|'restore'|'delete'|'insert', seq: number }`, `QuarantineItem = { key, reason, at }`.
  - Functions take an open transaction so callers stay atomic.
  - Makes T013 pass. Depends on T030.
- [X] T032 [P] Implement `MEAL_CATEGORIES` and `categoryForTime(date)` in `frontend/src/domain/meals.ts` as pure code. Makes T014 pass.
- [X] T033 Make the repositories write versions and the outbox in the same transaction:
  - Files: `frontend/src/data/entryRepository.ts`, `savedFoodRepository.ts`, `proteinGoalRepository.ts`.
  - Widen each transaction to the record store plus `outbox` and `meta`, and `entryVersions` for entries.
  - Follow data-model.md "Write rules".
  - Create `frontend/src/data/entryVersionRepository.ts` with `listAll`. US4's export needs it, and US6 extends it.
  - Makes T015 pass. Depends on T031.
- [X] T034 Link and pre-fill new entries:
  - In `frontend/src/data/logService.ts`, call `upsertFromEntry` first and create the entry with `savedFoodId: food.id`.
  - In `frontend/src/domain/review.ts`, `frontend/src/features/add-food/ManualEntryForm.tsx` and `frontend/src/features/recent/RelogForm.tsx`, set `mealCategory` from `categoryForTime(services.now())`. The visible field comes in US5.
  - Makes T016 pass. Depends on T032 and T033.
- [X] T035 [P] Implement `frontend/src/api/sync.ts` through the existing `frontend/src/api/http.ts`. zod schemas mirror contracts/sync-api.yaml, and record schemas reuse `frontend/src/data/records.ts`. Makes T017 pass.
- [X] T036 [P] Implement the change emitter in `frontend/src/data/changes.ts`: `createChanges()` returns `{ subscribe(listener): () => void, emit(types: Set<'entry'|'food'|'goal'|'version'>) }`
- [X] T037 Extend `UserData` in `frontend/src/app/services.tsx` with `changes` (T036) and `sync` (filled in by US1). Wire them in the `openUserData` implementation and in `frontend/src/data/lockedData.ts` (locked stand-ins reject). Depends on T035 and T036.
- [X] T038 Implement `frontend/src/features/sync/SyncNotice.tsx` and gate it in the authenticated shell (where Today is rendered behind `frontend/src/auth/AuthGate.tsx`):
  - Fetch `getState` after sign-in, show the notice when unacknowledged, and never block logging.
  - Extend the setup notice text in `frontend/src/auth/SetupFlow.tsx` so it acknowledges both.
  - Makes T018 pass.

**Checkpoint**: Server schema, RLS, grants and purge are in place. Sync endpoints exist and are gated.
Devices queue every local change, capture versions, pre-fill categories and link foods. The notice
works. `scripts/check.ps1` is green.

---

## Phase 3: User Story 1 - See the same log on every device (Priority: P1) 🎯 MVP

**Goal**: Create, edit and delete on one device shows up on the user's other open devices within
10 s. A new device gets the full history.

**Independent Test**: Two browser contexts, one account. Add, edit and delete on A, and check that B
matches within 10 s. A third fresh context gets everything (quickstart V1).

### Tests for User Story 1 (write first, see them fail)

- [X] T039 [P] [US1] Push contract tests in `backend/MacroCounter.Api.Tests/Sync/SyncPushTests.cs`:
  - Upsert of an entry, a food and a goal: `200 {revision, results:[{status:'applied'}]}`.
  - Revision increases once per row written.
  - Re-sending the same push is idempotent: the result is `superseded` and the stored data does not change. The stored row takes a new revision (R2).
  - Changing `dayKey` of an existing entry gives `400 invalid_request` with reason `day_key_changed`.
  - **All or nothing**: one invalid change in a batch of 5 applies none (FR-014), and audit records `sync_rejected` with a reason code only.
- [X] T040 [P] [US1] Conflict-matrix tests in `backend/MacroCounter.Api.Tests/Sync/SyncConflictTests.cs` (R3, R15, FR-007, SC-007). Use `FakeTimeProvider`:
  - A newer corrected time wins and an older one is `superseded`; a tie keeps the stored version.
  - Device A's clock 2 h fast, edit pushed later, is ordered correctly against device B.
  - Delete versus older edit and delete versus newer edit: **delete wins both**.
  - Every row of the R15 table: live + upsert, live + restore (sets `restored_at`), live + delete (tombstone, or `superseded` when `restored_at` is later than the delete), tombstone + upsert (`superseded`), tombstone + restore (revived when later, otherwise `superseded`), tombstone + delete (no-op).
  - The two `absent` rows of the R15 table. A delete of an unknown ID inserts a tombstone with `created_at` set to the delete's corrected time.
  - A device's clock 2 h fast does not let a stale upsert revive a tombstone.
  - **Stale pull (R2, constitution III)**: a stored row or tombstone that beats an incoming change takes a new revision, and a pull from a cursor already past its old revision returns it. The same holds for a `merged` result where the canonical row wins.
  - **Long offline (constitution III)**: a device offline for weeks, with its clock drifting, reconnects after edits on both sides and a delete on the other device. Every record converges, and the delete holds.
- [X] T041 [P] [US1] History capture tests in `backend/MacroCounter.Api.Tests/Sync/SyncHistoryTests.cs` (R14, R16, R17, SC-007):
  - An applied upsert inserts the displaced state with `change_type = 'edit'`. A delete inserts it with `delete`, and a restore with `restore`.
  - A superseded upsert inserts the incoming state, including one lost to a tombstone.
  - The same `versionId` from two devices leaves one row, with the first arrival's `change_type` and `replaced_at`.
  - Version changes run first, so a device's own change type beats the `edit` default in the same push.
  - `replaced_at` is skew-corrected and clamped to `serverNow`.
  - A tombstone row has null data columns while its delete version holds the data.
  - An upsert or restore with a null `meal_category` keeps a stored category (FR-022).
  - A pushed version whose ID matches the current row's `version_id` takes its fields from that row, so `restored_at` is kept and `effective_at` is not corrected twice. Only `change_type` and `replaced_at` come from the push (R14, FR-026).
- [X] T042 [P] [US1] Pull tests in `backend/MacroCounter.Api.Tests/Sync/SyncPullTests.cs`:
  - `since=0` returns all records oldest revision first, across all four record types.
  - Pages of `limit` with `cursor`/`hasMore`, and every response has `serverNow`.
  - Tombstones come back as `{type, revision, id, deleted:true}`.
  - The record shape equals the device record (camelCase, `updatedAt` = `effective_at`, full precision such as `kcal: 123.456789`, `restoredAt` server-assigned).
  - An empty result returns `cursor = since`.
- [X] T043 [P] [US1] Concurrency test in `backend/MacroCounter.Api.Tests/Sync/SyncConcurrencyTests.cs`: 2 parallel pushes of 50 changes each for one user. Then a pull from 0 returns every change with no duplicates, and a pull started between commits never skips a revision (R2).
- [X] T044 [P] [US1] Sync engine tests in `frontend/src/sync/syncEngine.test.ts` (fake API + fake-indexeddb):
  - A round is push then pull.
  - Push sends the current record for each outbox key (coalesced), and each queued version, in batches of ≤ 200, with `clientNow`, oldest `seq` first. `restoredAt` is never sent.
  - `applied`/`superseded` results ack the items by `seq`.
  - Pull loops while `hasMore` and saves `sync.cursor` after each page.
  - A `401` stops the round and keeps the outbox.
  - Nutrition totals for a reference day are identical before and after a round trip (Principle II, SC-006).
  - A key skipped by a pull because it was pending ends up matching the server after its push is `superseded`, including a deleted entry (R2).
  - `isComplete()` is false until the first pull has finished, while a pull has more pages, or while the outbox or quarantine is non-empty (R21).
  - Pushed records never contain a photo or device-preference field, and `devicePreferences` is never read (FR-002).
- [X] T045 [P] [US1] Remote-apply tests in `frontend/src/data/remoteApply.test.ts`:
  - Pulled upserts are written **without** creating outbox items.
  - A tombstone removes the local entry.
  - A key with a pending outbox item is skipped (R2).
  - Pulled versions are always written, replacing a local copy of the same ID.
  - `meta.sync.serverNow` is saved, and versions older than 90 days before it are removed (R16).
  - `changes.emit` fires once per page with the affected types.
- [X] T046 [P] [US1] Scheduler tests in `frontend/src/sync/scheduler.test.ts` (vitest fake timers):
  - Polls every 5 s while `document.visibilityState === 'visible'` and online.
  - No polling while hidden.
  - A round runs 500 ms (debounced) after a local change, on `visibilitychange` to visible, and on start-up.
  - Never runs two rounds at once.
  - Does nothing until the notice is acknowledged.
- [X] T047 [P] [US1] Live refresh tests:
  - `frontend/src/features/today/DayLog.test.tsx`, `frontend/src/features/recent/RecentFoods.test.tsx`, `frontend/src/features/add-food/QuickPicks.test.tsx`, `frontend/src/features/goal/GoalSettings.test.tsx`: emitting the relevant change type reloads the data with no remount.
  - `frontend/src/features/today/EntryEditor.test.tsx`: an entry deleted remotely while open closes the editor with the announcement "This entry was deleted on another device"; unsaved edits survive a remote change (contracts/ui-sync.md "Live updates").
- [X] T048 [P] [US1] Status indicator tests in `frontend/src/features/sync/SyncStatus.test.tsx`:
  - States synced / syncing (only after more than 1 s) / failing / off, with text labels.
  - 44×44 px target, and tapping shows the explanation (contracts/ui-sync.md "Sync status").
- [ ] T049 [US1] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts`, using two browser contexts signed in as `e2e-owner`:
  - Log on A → visible on B within 10 s.
  - Edit on B → A updates.
  - Delete on A → gone on B and stays gone after reload.
  - A third fresh context gets the full history.
  - Totals for a hand-verified reference day are identical on both devices (SC-006).
  - Add the spec to the signed-in Playwright project in `frontend/playwright.config.ts`, and make `scripts/e2e-db.ps1` pre-acknowledge or reset the sync notice as each test needs.

### Implementation for User Story 1

- [X] T050 [US1] Implement push in `backend/MacroCounter.Api/Sync/SyncStore.cs` (R3, R14, R15, R17):
  - In one user transaction: validate (T025), lock the revision row, handle `version` changes first (`insert … on conflict do nothing`), then the rest in request order, computing `effective_at` and `replaced_at` with `ClockSkew`.
  - Upsert: `insert … on conflict (user_id, id) do update … where macro_data.log_entries.deleted_at is null and excluded.effective_at > macro_data.log_entries.effective_at`, giving `applied` or `superseded`. Keep a stored `meal_category` when the incoming one is null.
  - Implement every row of the R15 table for `delete` and `restore`. A delete clears the data columns (R16). `restored_at` is set only by a `restore`.
  - Whenever the current row changes, insert the displaced state as a version. Insert a superseded incoming state as a version. Both use `on conflict do nothing`.
  - Reject a changed `day_key` on live rows and on restores of them.
  - Compute `normalized_name = lower(btrim(name))` server-side. `last_used_at` keeps the later value, even when the rest of the upsert is superseded (R4).
  - Implement the `absent` rows of the R15 table.
  - A pushed version whose ID matches the current row's `version_id` takes its fields from that row (R14).
  - Each row written takes one revision. Whenever the stored row beats an incoming change, including a `merged` result where the canonical row wins, give it a new revision so the next pull brings it (R2).
  - Makes T039, T040, T041 and T043 pass.
- [X] T051 [US1] Implement pull in `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - A `union all` across the four tables `where revision > $since order by revision limit $limit`.
  - Map rows to the wire shape, tombstones as `deleted:true`, and include `serverNow`.
  - Makes T042 pass. Depends on T050.
- [X] T052 [US1] Replace the push and changes stubs in `backend/MacroCounter.Api/Sync/SyncEndpoints.cs` with calls to T050/T051. Return `400 invalid_request` with `invalid[]` or `too_many_changes` from the validator, and audit `sync_rejected` (reason code only).
- [X] T053 [P] [US1] Implement `frontend/src/data/remoteApply.ts`: write pulled records in one transaction per page (`entries`, `entryVersions`, `savedFoods`, `proteinGoals`, `outbox`, `meta`), skip pending keys, delete on tombstone, save `sync.cursor` and `sync.serverNow`, remove expired versions, and emit changes. Makes T045 pass.
- [X] T054 [US1] Implement `frontend/src/sync/syncEngine.ts`: `runRound()` = push (peek ≤ 200 → read current records and versions, leaving out `restoredAt` → `api.push` → ack by `seq`) then pull (loop pages via T053). It exposes `pendingCount()`, `isComplete()` and the last outcome. Makes T044 pass. Depends on T053.
- [X] T055 [US1] Implement `frontend/src/sync/scheduler.ts` and `frontend/src/sync/useSyncStatus.ts`:
  - The scheduler owns the timers and triggers (T046) and starts once the notice is acknowledged.
  - `useSyncStatus` derives the ui-sync.md states from engine outcomes.
  - Implement `frontend/src/features/sync/SyncStatus.tsx` and place it in the Today header beside the account menu (`frontend/src/features/today/TodayScreen.tsx`).
  - Subscribe `DayLog`, `RecentFoods`, `QuickPicks`, `GoalSettings` and the history `DayView` to `services.changes`. Handle a remote delete in `EntryEditor`.
  - Makes T046, T047, T048 and T049 pass.

**Checkpoint**: Two online devices stay in sync, and a new device gets the full history. This is the
MVP. It is not releasable to friends until US4 (account deletion) is done.

---

## Phase 4: User Story 2 - Keep the data I already have (Priority: P1)

**Goal**: The first sync uploads each device's existing data and merges it with no loss or
duplicates. Saved foods and goal days merge by natural key.

**Independent Test**: Seed different v1 data on two browsers (including the same food on both). After
both sync, each shows the union exactly once, with a single saved food (quickstart V2, SC-002).

### Tests for User Story 2 (write first, see them fail)

- [X] T056 [P] [US2] Migration tests in `frontend/src/data/db.test.ts` (extend) (R6, R18):
  - Upgrading a v1 database with 3 entries, 2 foods and 1 goal leaves 6 `upsert` outbox items with increasing `seq`, and `sync.cursor = 0`.
  - An entry with `savedFoodId: null` is linked to a saved food with the same normalized name and unit.
  - An entry with no match stays `null`, and an existing link is left alone. `updatedAt` does not change.
- [X] T057 [P] [US2] Adoption tests in `frontend/src/data/legacyAdoption.test.ts` (extend): adopted records get `upsert` outbox items in the target, in the same transaction as the copy, and their count matches the records copied (R6)
- [X] T058 [P] [US2] Natural-key merge tests in `backend/MacroCounter.Api.Tests/Sync/SyncMergeTests.cs` (R4):
  - Two different IDs for food "Greek yogurt"/`g` (and " greek YOGURT "/`g`, from `vectors/normalize.json`) give one canonical row and an alias row, with result `merged` and `canonicalId`.
  - The newer corrected macros win on the canonical row, and `last_used_at` keeps the later value.
  - The same name with a different unit is **not** merged.
  - A goal with the same `effective_from` merges the same way.
  - An upsert addressed to an alias ID updates the canonical row.
  - An incoming entry or entry version whose `savedFoodId` is an alias is stored with the canonical ID.
  - An unknown `savedFoodId` is accepted as-is.
- [X] T059 [P] [US2] Device merge-handling tests in `frontend/src/sync/syncEngine.test.ts` (extend): a `merged` result rewrites the local saved food or goal to `canonicalId`, repoints `savedFoodId` on every local entry and entry version that used the alias, and drops the alias outbox key, all in one transaction
- [X] T060 [P] [US2] Quarantine tests in `frontend/src/sync/syncEngine.test.ts` (extend):
  - Before pushing, each record is checked against `vectors/bounds.json` rules. A failing record goes to `quarantine` with its reason, and the rest of the batch is pushed.
  - The status shows "N can't sync".
  - The record stays visible locally.
- [ ] T061 [US2] E2E first-sync merge in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend):
  - Seed two contexts' v1 IndexedDB with different entries plus the same food (helper in `frontend/tests/e2e/helpers/`).
  - Sign in and acknowledge on both.
  - Both show the union exactly once, there is one quick-pick "Greek yogurt", and the entries link to it.

### Implementation for User Story 2

- [X] T062 [US2] Extend migration `version: 2` in `frontend/src/data/db.ts` to link entries to saved foods by normalized name and unit, then enqueue an `upsert` outbox item for every existing entry, saved food and goal. Makes T056 pass.
- [X] T063 [US2] Make the copy step in `frontend/src/data/legacyAdoption.ts` write the matching outbox items in the same transaction as the records. Makes T057 pass. Depends on T031.
- [X] T064 [US2] Implement natural-key merges in `backend/MacroCounter.Api/Sync/SyncStore.cs`:
  - Before inserting a new food or goal ID, look up a live row with the same `(normalized_name, ref_unit)` or `effective_from`.
  - If one exists: apply LWW to the canonical row, insert `saved_food_aliases`/`protein_goal_aliases`, and report `merged` + `canonicalId`.
  - Resolve alias IDs on upsert, and rewrite aliased `saved_food_id` on incoming entries and versions.
  - Makes T058 pass.
- [X] T065 [US2] Handle `merged` results in `frontend/src/sync/syncEngine.ts` with a new `rewriteId` in `frontend/src/data/remoteApply.ts`. Makes T059 pass.
- [X] T066 [US2] Implement the device pre-push check in `frontend/src/data/syncBounds.ts` (zod, exactly the data-model.md bounds). Use it in `syncEngine.ts` to quarantine records, and surface `quarantineCount()` in `useSyncStatus`. Makes T060 and T061 pass.

**Checkpoint**: Existing users can turn on sync without losing or duplicating anything.

---

## Phase 5: User Story 3 - Log while offline (Priority: P2)

**Goal**: Offline logging is instant. Changes sync automatically on reconnect, the UI shows what
is pending, and signing out warns about unsynced changes.

**Independent Test**: A context goes offline, logs and edits, goes online, and a second context
receives the changes. Signing out offline shows the warning (quickstart V3, V6).

### Tests for User Story 3 (write first, see them fail)

- [X] T067 [P] [US3] Scheduler offline tests in `frontend/src/sync/scheduler.test.ts` (extend):
  - No requests while `navigator.onLine` is false.
  - The `online` event triggers an immediate round.
  - On network, 5xx, 429 or `service_unavailable` failures, retries back off 5→10→20→40→60 s (429 honours Retry-After).
  - Any immediate trigger resets the backoff.
- [X] T068 [P] [US3] Status tests in `frontend/src/features/sync/SyncStatus.test.tsx` (extend): "N not synced" (pending), "Offline: will sync later", "Sync problem, retrying" (failing). Logging while offline updates the totals immediately (`frontend/src/features/today/TodayScreen.test.tsx`).
- [X] T069 [P] [US3] Offline edit tests in `frontend/src/sync/syncEngine.test.ts` (extend):
  - An edit made while a push is in flight keeps its outbox item (new `seq`) and is pushed in the next round.
  - Three offline edits push the latest entry state once, plus each replaced state as a version (R14, FR-024).
- [X] T070 [P] [US3] Sign-out warning tests in `frontend/src/auth/AccountMenu.test.tsx`, per contracts/ui-sync.md:
  - With a non-empty outbox, "Sign out" and "Sign out everywhere" show an inline confirmation "N changes haven't synced yet…" with **Sign out anyway** / **Cancel**.
  - No `window.confirm`.
  - With an empty outbox, behaviour is unchanged.
- [ ] T071 [US3] E2E offline in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend):
  - `contextA.setOffline(true)` → log 2 foods and edit 1 → the status shows offline → `setOffline(false)` → B receives them within 10 s.
  - Offline sign-out shows the warning. Signing in as `e2e-friend` on A does not show the entry. Signing back in as `e2e-owner` online syncs it.
  - Re-logging a previously used food takes the same number of interactions offline as online, and no more than 3 (SC-004, Principle IV).

### Implementation for User Story 3

- [X] T072 [US3] Add the offline gating, `online` trigger, exponential backoff and Retry-After handling to `frontend/src/sync/scheduler.ts`. Makes T067 pass.
- [X] T073 [US3] Add the pending / offline / failing states to `frontend/src/sync/useSyncStatus.ts` and `frontend/src/features/sync/SyncStatus.tsx`. Makes T068 and T069 pass (verify `ack` by `seq` from T031).
- [X] T074 [US3] Add the inline unsynced-changes confirmation to `frontend/src/auth/AccountMenu.tsx`, using `services.sync.pendingCount()`. Makes T070 and T071 pass.

**Checkpoint**: Logging works anywhere, and nothing done offline is lost.

---

## Phase 6: User Story 4 - Trust that my data is mine (Priority: P2)

**Goal**: The data is provably isolated per user. Removing a user deletes their data. Food data
never reaches logs or audit. Users can download a copy of their data.

**Independent Test**: Cross-user attempts through every sync path are refused or isolated,
`delete_user` leaves zero rows, and an export holds exactly the signed-in user's data (quickstart V5,
V11, SC-005, SC-009).

### Tests for User Story 4 (write first, see them fail)

- [X] T075 [P] [US4] Isolation tests in `backend/MacroCounter.Api.Tests/Security/SyncIsolationTests.cs` (extend `CrossUserTests.cs` patterns):
  - User X pushes upserts, deletes, restores and versions using IDs that exist for user Y. Y's rows are unchanged, and X gets its own rows.
  - X's pull never contains Y's records or versions.
  - No sync request body or query accepts a user ID (contract has none; StrictJson rejects `userId`).
  - A push with a photo or device-preference field is rejected by StrictJson, and no `macro_data` table has a column for either (FR-002).
  - Every sync endpoint returns 401 when unauthenticated (SC-005: 0 successful cross-user reads or writes).
- [X] T076 [P] [US4] `delete_user` tests in `backend/MacroCounter.Api.Tests/Database/DeleteUserTests.cs`:
  - After `select macro_admin.delete_user('<y>')`, every `macro_data` table and every `macro` user table has 0 rows for Y.
  - Y's audit rows are kept with `user_id` null, plus a new `user_deleted` (actor `owner`).
  - The app role cannot execute the function.
  - An unknown username raises an error.
- [X] T077 [P] [US4] Sentinel log and audit scan in `backend/MacroCounter.Api.Tests/Audit/SecretScanTests.cs` (extend). Push valid and invalid records named `"SENTINEL-FOOD-7f3a"`, then assert the string appears in no captured log line (`Infrastructure/CapturingLogger.cs`) and no `macro.audit_events` column (FR-015, FR-019, R9).
- [X] T078 [P] [US4] Export tests in `frontend/src/data/exportData.test.ts` (FR-036, FR-037, R21):
  - `buildExport` returns `format: 'macro-counter-export'`, `formatVersion: 1`, `exportedAt`, `entries`, `savedFoods`, `proteinGoals` and `entryVersions`.
  - Values keep full precision (`kcal: 123.456789`).
  - The result has no outbox, quarantine, meta or device-preference content.
  - `exportData()` reads only the database it was opened with, and its record counts match the stores.
  - The file name is `macro-counter-export-<YYYY-MM-DD>.json`.
- [X] T079 [P] [US4] Export UI tests in `frontend/src/auth/AccountMenu.test.tsx` (extend), per contracts/ui-sync.md "Export":
  - **Export my data** calls the injected `downloadFile` and announces the result.
  - It works while offline.
  - With a non-empty outbox or quarantine, a pull still in progress, or an unfinished first pull, a note says the export may be incomplete and the button stays enabled.
  - A failure shows an inline error.
- [ ] T080 [US4] E2E export in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend): download the file with Playwright's `download` event, parse it, and confirm its entries match the account. Signing in as `e2e-friend` on the same browser exports only that user's data (threat S15).

### Implementation for User Story 4

- [X] T081 [US4] Add a migration `backend/MacroCounter.Api/Data/Migrations/<ts>_DeleteUser.cs` (or append to `<ts>_ActivityData` if it is not yet applied anywhere) with `macro_admin.delete_user(p_username text) returns void`:
  - It follows `disable_user`'s pattern (`find_user`, `owner_audit('user_deleted', id)` **before** the delete, then `delete from macro.users where id = v_id`).
  - Run `revoke execute … from public`.
  - Makes T076 pass.
- [X] T082 [US4] Fix any isolation or logging gaps found by T075/T077 in `backend/MacroCounter.Api/Sync/SyncStore.cs`, `SyncEndpoints.cs` and `Security/RefusedRequestLogging.cs`, until both pass
- [X] T083 [P] [US4] Document `delete_user` in `specs/003-auth-security-foundations/contracts/owner-procedures.md` (new section, with a link back to 007 research R8)
- [X] T084 [US4] Implement `frontend/src/data/exportData.ts`: pure `buildExport(records, exportedAt)`, plus `UserData.exportData()` reading through the repositories (add `listAll` to the entry and saved-food repositories, and use `entryVersionRepository.listAll` from T033). Wire it in `frontend/src/app/services.tsx` and `frontend/src/data/lockedData.ts`. Makes T078 pass.
- [X] T085 [US4] Implement `frontend/src/data/downloadFile.ts` (`Blob` and a temporary `download` link, injected through services) and add **Export my data**, its note about the file's contents, and the incomplete-export note (from `services.sync.isComplete()`) to `frontend/src/auth/AccountMenu.tsx`. Makes T079 and T080 pass. Depends on T084.

**Checkpoint**: All sync stories work, and the data can be exported. The sync core is releasable once
the Polish phase passes.

---

## Phase 7: User Story 5 - Sort my day into meals (Priority: P3)

**Goal**: Each entry shows in a meal group with a subtotal, and the category can be changed.

**Independent Test**: Log foods at different times, change one category, and confirm that grouping,
subtotals and the change match on a second device (quickstart V7).

### Tests for User Story 5 (write first, see them fail)

- [ ] T086 [P] [US5] `groupByCategory` tests in `frontend/src/domain/meals.test.ts` (extend): order Breakfast, Lunch, Dinner, Snacks, Uncategorized; empty groups left out; subtotals through `sumMacros`; subtotals add up to the day total at full precision (FR-023). 100% coverage
- [ ] T087 [P] [US5] Meal field tests in `frontend/src/features/shared/MealCategoryField.test.tsx`, and extend `ManualEntryForm.test.tsx`, `ReviewEstimate.test.tsx`, `RelogForm.test.tsx` and `EntryEditor.test.tsx`:
  - The field shows the pre-fill, and accepting it adds no interaction (FR-021).
  - Each item in a multi-item estimate has its own field.
  - A null entry shows Uncategorized in the editor, can take a category, and the field has no Uncategorized option (FR-022).
  - 44 px targets at 360 px.
- [ ] T088 [P] [US5] Grouped list tests in `frontend/src/features/today/EntryList.test.tsx` (new), extending `DayLog.test.tsx` (new in T047) and `TodayScreen.test.tsx`: Today and the day view show headed groups with subtotals, and the day total is unchanged
- [ ] T089 [US5] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend): log and change a category on A, then confirm that groups and subtotals match on B within 10 s

### Implementation for User Story 5

- [ ] T090 [P] [US5] Implement `groupByCategory(entries)` in `frontend/src/domain/meals.ts`. Makes T086 pass.
- [ ] T091 [US5] Implement `frontend/src/features/shared/MealCategoryField.tsx` and add it to `ManualEntryForm.tsx`, `ReviewEstimate.tsx`, `RelogForm.tsx` and `EntryEditor.tsx`. Makes T087 pass.
- [ ] T092 [US5] Group entries in `frontend/src/features/today/EntryList.tsx` using T090. Makes T088 and T089 pass.

**Checkpoint**: Days read by meal on every device.

---

## Phase 8: User Story 6 - Undo a mistake (Priority: P3)

**Goal**: A user can view an entry's history and restore an earlier version or a deleted entry.

**Independent Test**: Edit and delete an entry, restore the earlier version on another device, and
confirm both devices show it with full history (quickstart V8).

### Tests for User Story 6 (write first, see them fail)

- [ ] T093 [P] [US6] Repository tests in `frontend/src/data/entryVersionRepository.test.ts`:
  - `listForEntry` returns versions newest first, without the one matching the current `versionId`.
  - `listDeletedForDay` returns delete versions whose entry is not live.
  - Versions past the 90-day cut-off from `meta.sync.serverNow` are not listed.
  - `restore` on a deleted entry recreates it with the same ID and a new `versionId`, and queues `{op:'restore'}`.
  - `restore` on a live entry also adds the current state with `changeType: 'restore'` and queues it.
  - A later edit keeps the pending `restore` op. An aborted transaction leaves no write.
- [ ] T094 [P] [US6] History UI tests in `frontend/src/features/today/EntryHistory.test.tsx`, per contracts/ui-sync.md: opened from the editor, current then earlier versions newest first with when and how each changed, **Restore** applies at once with no confirmation and a status message, and it refreshes on a `version` change
- [ ] T095 [P] [US6] Recently deleted tests in `frontend/src/features/today/RecentlyDeleted.test.tsx`: hidden with none, listed per day with **Restore**, and shown on Today and the history day view
- [ ] T096 [US6] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend):
  - Edit twice, then delete on A. Restore on B. Both show the entry with the same ID and the history.
  - An offline edit on A made before the delete syncs and leaves the entry deleted, then appears in history (quickstart V8).

### Implementation for User Story 6

- [ ] T097 [US6] Extend `frontend/src/data/entryVersionRepository.ts` (created in T033) with history, recently deleted and restore, and add it to `UserData` in `frontend/src/app/services.tsx` and `frontend/src/data/lockedData.ts`. Makes T093 pass.
- [ ] T098 [US6] Implement `frontend/src/features/today/EntryHistory.tsx` and open it from `EntryEditor.tsx`. Makes T094 pass.
- [ ] T099 [US6] Implement `frontend/src/features/today/RecentlyDeleted.tsx` and add it to `TodayScreen.tsx` and `DayLog.tsx`. Makes T095 and T096 pass.

**Checkpoint**: Mistakes can be undone from any device for 90 days.

---

## Phase 9: User Story 7 - My usual foods are at the top (Priority: P3)

**Goal**: Quick picks are ordered by use in the last 30 days, the same on every device.

**Independent Test**: Log one food five times and another once across two devices, and confirm the same
order on both (quickstart V9).

### Tests for User Story 7 (write first, see them fail)

- [ ] T100 [P] [US7] `rankQuickPicks` tests in `frontend/src/domain/quickPicks.test.ts` (R18): count first; ties by latest linked `loggedAt`; foods unused in the window follow by `lastUsedAt`; the food ID breaks any remaining tie; day 29 back is inside the window and day 30 back is outside; deleted entries are not counted
- [ ] T101 [P] [US7] `listQuickPicks(today, limit)` tests in `frontend/src/data/savedFoodRepository.test.ts` (extend): it reads the 30-day range through the `dayKey` index and honours `limit`
- [ ] T102 [P] [US7] UI tests in `frontend/src/features/add-food/QuickPicks.test.tsx` and `frontend/src/features/recent/RecentFoods.test.tsx` (extend): both show the new order, with labels and flows unchanged
- [ ] T103 [US7] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend): uses across two devices give the same order on both. Deleting entries changes it, and restoring them changes it back

### Implementation for User Story 7

- [ ] T104 [P] [US7] Implement `rankQuickPicks(foods, entries, today)` in `frontend/src/domain/quickPicks.ts`. Makes T100 pass.
- [ ] T105 [US7] Replace `listRecent` with `listQuickPicks` in `frontend/src/data/repositories.ts` and `savedFoodRepository.ts`. Makes T101 pass. Depends on T104.
- [ ] T106 [US7] Use it in `frontend/src/features/add-food/QuickPicks.tsx` and `frontend/src/features/recent/RecentFoods.tsx`. Makes T102 and T103 pass.

**Checkpoint**: Repeat foods come first on every device.

---

## Phase 10: User Story 8 - See how I'm trending (Priority: P3)

**Goal**: A trends view shows daily calories and macros over 7, 30 or 90 days, with the protein goal and
range averages.

**Independent Test**: Seed known entries across 30 days, sync, and confirm another device's trends match
per day and on average (quickstart V10).

### Tests for User Story 8 (write first, see them fail)

- [ ] T107 [P] [US8] `buildTrend` tests in `frontend/src/domain/nutrition/trends.test.ts` (R19): ranges of 7, 30 and 90 days ending today; hand-verified daily totals and averages; days with no entries are `null` and left out of averages; a day of real zero values is counted; the goal per day comes from `goalForDay`; an all-empty range. 100% coverage (Principle II)
- [ ] T108 [P] [US8] `listByDayRange(from, to)` tests in `frontend/src/data/entryRepository.test.ts` (extend): it uses the `dayKey` index range, inclusive at both ends
- [ ] T109 [P] [US8] View tests in `frontend/src/features/trends/TrendsView.test.tsx`, per contracts/ui-sync.md "Trends": the range buttons default to 7, the four measures show with averages, the protein goal shows, "no data" appears in the table, the table holds the same values as the charts, the empty message shows, and it refreshes on an `entry` or `goal` change
- [ ] T110 [US8] E2E in `frontend/tests/e2e/auth/sync-two-devices.spec.ts` (extend): seed 30 days with gaps, open Trends on the second device, and confirm values match the day view and an edit updates that day. Confirm it works offline

### Implementation for User Story 8

- [ ] T111 [P] [US8] Implement `buildTrend` in `frontend/src/domain/nutrition/trends.ts`, reusing `sumMacros` and `goalForDay`. Makes T107 pass.
- [ ] T112 [P] [US8] Add `listByDayRange` to `frontend/src/data/repositories.ts` and `entryRepository.ts`. Makes T108 pass.
- [ ] T113 [US8] Implement `frontend/src/features/trends/TrendChart.tsx` (inline SVG, no new dependency) and `TrendsView.tsx`. Add the `'trends'` view to `frontend/src/App.tsx` and a **Trends** button to `frontend/src/features/today/TodayScreen.tsx`. Makes T109 and T110 pass. Depends on T111 and T112.

**Checkpoint**: All eight stories work.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T114 [P] Update `docs/deploy.md`:
  - §1 heading "identity and security data only" becomes "identity, security and activity data".
  - Re-run `grant_app_role` after migrating.
  - Backup retention note (Supabase ≤ 7 days, R8), and the 90-day version purge (R16). The `pg_cron` step now also covers entry history.
  - `delete_user` usage, and that users ask the owner for removal (FR-016).
  - Rollout order: migrate, then deploy (quickstart "Production rollout").
- [ ] T115 [P] Update `scripts/dev-db.ps1` and `scripts/e2e-db.ps1` so they re-run `macro_admin.grant_app_role` after migrations, and the e2e setup can reset `macro_data` between runs
- [ ] T116 Performance checks with one seeded year of data (about 2,500 records), in `frontend/tests/e2e/auth/sync-two-devices.spec.ts`: a fresh context is ready in < 15 s (SC-003), the 90-day trends view opens in < 2 s (SC-008), and an export finishes in < 5 s (SC-009). Repeat a change between two contexts 20 times and assert that at least 19 arrive within 10 s (SC-001). Also measure that an empty pull is < 30 ms p95 in a backend test (`Sync/SyncPullTests.cs`, a loose bound to avoid flakiness)
- [ ] T117 Run `scripts/check.ps1` (full gate: backend, frontend unit with 100% nutrition coverage, e2e, `npm audit`, `dotnet list package --vulnerable`, secret scan) and fix any failures
- [ ] T118 Run the manual scenarios V1–V11 in `specs/007-cross-device-sync/quickstart.md` and record the results in the PR description
- [ ] T119 Governance gate: run `/security-review` plus an ASVS L2 pass over `/api/sync/*`, `SyncStore`, the `macro_data` grants and RLS, and the purge. Resolve or risk-accept the findings in writing in the PR (constitution Governance, plan threat model S1–S15)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup and **blocks all stories**
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after US1. It extends `SyncStore` push (T050) and `syncEngine` (T054)
- **US3 (Phase 5)**: after US1, because it extends the scheduler and status. It is independent of US2, so US2 and US3 can run in parallel
- **US4 (Phase 6)**: after Foundational. Its isolation tests need US1's push and pull (T050–T052), and T081 (`delete_user`) can start right after T021. Export (T078–T080, T084, T085) needs only version capture and the status counts, but its e2e needs US1
- **US5 (Phase 7)**: after US1
- **US6 (Phase 8)**: after US1. It reuses the server rules from T050
- **US7 (Phase 9)**: after US1. It needs the food links (T034, T062), so it comes after US2. Its restore step needs US6
- **US8 (Phase 10)**: after US1
- **Polish (Phase 11)**: after all stories

### Within each phase

- Test tasks come first and must fail before their implementation tasks
- Backend: migration (T021) → `SyncStore` → endpoints
- Frontend: types (T029) → db v2 (T030) → outbox (T031) → repositories (T033) → engine → scheduler → UI

### Key task dependencies

- T020 → T021 → T026 → T028 (backend foundation chain)
- T024 → T025 → T050 → T051 → T052
- T029 → T030 → T031 → T033 → T034; T035 and T036 → T037 → T038
- T053 → T054 → T055
- T050 → T064; T054 → T065 and T066
- T055 → T072 → T073; T054 → T074
- T084 → T085; T090 → T092; T097 → T098 and T099; T104 → T105 → T106; T111 and T112 → T113

---

## Parallel Examples

### Foundational tests (all different files)

```text
T005 ActivityDataMigrationTests.cs   T006 AppRoleGrantTests.cs     T007 ClockSkewTests.cs
T008 SyncValidatorTests.cs           T009 SyncNoticeTests.cs       T011 SyncLimitsTests.cs
T012 db.test.ts                      T013 outbox.test.ts           T014 meals.test.ts
T017 sync.test.ts                    T018 SyncNotice.test.tsx
```

### User Story 1 tests

```text
Backend:  T039 SyncPushTests.cs   T040 SyncConflictTests.cs   T041 SyncHistoryTests.cs   T042 SyncPullTests.cs   T043 SyncConcurrencyTests.cs
Frontend: T044 syncEngine.test.ts T045 remoteApply.test.ts    T046 scheduler.test.ts     T047 live refresh       T048 SyncStatus.test.tsx
```

### After US1: separate streams

```text
Stream A (US2): T056–T061 tests → T062 → T063 → T064 → T065 → T066
Stream B (US3): T067–T071 tests → T072 → T073 → T074
Stream C (US5): T086–T089 tests → T090 → T091 → T092
Stream D (US8): T107–T110 tests → T111, T112 → T113
```

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 Setup, then Phase 2 Foundational (schema, RLS, notice, outbox, version capture).
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
5. + US5, US6, US7, US8, each as its own release. They need no further server migration, because the
   schema ships with Foundational (FR-001, R20). Re-run the Polish gate tasks that apply.

---

## Notes

- [P] = different files with no unfinished dependencies. Tasks that extend the same test file (for
  example `syncEngine.test.ts` in US1/US2/US3) are sequential across phases.
- Verify each test fails for the right reason before implementing.
- Commit after each task or logical group. Tests and implementation may share a commit only if the
  red step was observed (Principle I).
- Never call Supabase or Claude from tests. Never log record contents.
- In this worktree, run e2e on a port other than 5173 if the main checkout's dev server is up, or the
  tests run against stale code.
