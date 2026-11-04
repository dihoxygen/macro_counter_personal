# Implementation Plan: Cross-Device Sync

**Branch**: `007-cross-device-sync` | **Date**: 2026-10-30, revised 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-cross-device-sync/spec.md`

## Summary

A user's log entries, saved foods and protein-goal history now sync between every device they sign
in on. Each device keeps working offline. This relies on constitution v3.0.0, which allows activity
data on the server. The 2026-11-03 clarifications add meal categories, entry history with restore,
frequency-ordered quick picks and trends. They share one data design, and only their screens are staged
after the sync stories
([R20](./research.md#r20-staging-what-ships-with-sync-and-what-waits-fr-001)).

- **Server copy.** A new `macro_data` schema in the existing Supabase PostgreSQL database holds four
  typed tables. Every row is keyed `(user_id, id)` and cascades on user deletion. Row-level security
  pins every query to the session's user. The tables are mapped in the existing EF Core model, so the
  owner still applies a single migration script
  ([R1](./research.md#r1-where-the-server-copy-lives), [R10](./research.md#r10-row-level-security-as-defense-in-depth-fr-013)).
- **Protocol.** Each device has a local **outbox** and a **cursor**. Every sync round is **push, then
  pull**.
  - `POST /api/sync/push` applies up to 200 changes all or nothing.
  - `GET /api/sync/changes?since=` returns everything after the device's cursor.
  - Per-user revisions are dense, and a row lock serializes them, so a pull never misses a change
    ([R2](./research.md#r2-sync-protocol-outbox-push-then-cursor-pull)).
- **Conflicts.** Last writer wins per record, using the device's edit time **corrected for that
  device's clock skew** at push time. A delete wins over edits through tombstones, and only an explicit
  restore can undo one. The losing side of a conflict stays in history. Saved foods and goal days that
  collide by natural key are merged into one canonical row, with aliases
  ([R3](./research.md#r3-conflict-rule-that-does-not-trust-device-clocks-fr-007),
  [R4](./research.md#r4-natural-key-merges-saved-foods-and-goals-fr-008),
  [R15](./research.md#r15-restore-versus-the-delete-wins-rule-fr-003-fr-026-constitution-iii)).
- **Entry history.** Each saved state has its own ID, and a replaced state becomes an immutable row
  that syncs like any record. The same ID keeps repeats out. A daily purge removes versions after 90
  days, and tombstones hold no food data
  ([R14](./research.md#r14-entry-history-every-saved-state-has-its-own-id-fr-024-fr-025-sc-007),
  [R16](./research.md#r16-retention-of-versions-and-tombstones-fr-027)).
- **Categories, quick picks, trends.** Category is one nullable entry field, pre-filled from local
  time. Quick-pick order and trends are computed on the device from synced entries and store nothing.
  New entries must now link to their saved food, which most do not today
  ([R17](./research.md#r17-meal-categories-fr-020-to-fr-023)–[R19](./research.md#r19-trends-fr-032-to-fr-035-sc-008)).
- **Export.** An Account screen action builds one JSON file on the device, so it works offline and needs
  no endpoint. This closes the export gap in constitution III
  ([R21](./research.md#r21-export-fr-036-fr-037-sc-009-constitution-iii)).
- **Freshness.** Visible tabs poll every 5 s and also sync right after local changes, on focus and on
  reconnect. Hidden tabs don't poll. No SSE or WebSockets
  ([R5](./research.md#r5-getting-changes-to-other-devices-within-10-seconds-fr-005-sc-001)).
- **First sync.** The local IndexedDB schema moves to v2. Its migration queues every existing record,
  so existing data merges through the normal path. Records that would fail server validation are
  quarantined on the device rather than blocking sync
  ([R6](./research.md#r6-first-sync-of-existing-local-data-fr-008-user-story-2)).
- **Trust.**
  - A server-enforced one-time sync notice is shown before any upload.
  - A new owner procedure, `macro_admin.delete_user`, removes the user and all their data.
  - New audit events, and a log scan that proves food names never reach logs
  ([R7](./research.md#r7-disclosure-before-the-first-sync-fr-017-constitution-vii-accountability)–[R9](./research.md#r9-encryption-and-keeping-food-data-out-of-logs-fr-015)).
- **UI.**
  - A sync status indicator in the Today header.
  - Live refresh of Today, Recent and Goal when pulled changes arrive.
  - An inline warning before signing out with unsynced changes
    ([R12](./research.md#r12-ui-changes), [ui-sync.md](./contracts/ui-sync.md)).

## Technical Context

**Language/Version**: C# 14 / .NET 10 backend; TypeScript 6.0 (strict) + React 19 frontend
(unchanged)

**Primary Dependencies**: Unchanged. ASP.NET Core Minimal APIs, Npgsql / EF Core (migrations only for
the new tables; the data path is raw SQL like `AuditLog`), the built-in rate limiter, `idb` and `zod`.
**No new packages** ([R13](./research.md#r13-dependencies-principle-v)).

**Storage**:
- Server: Supabase PostgreSQL.
  - The existing `macro` schema (identity and security) and `macro_admin` (owner procedures) are
    unchanged except for audit codes, `grant_app_role` and the new `delete_user`.
  - **New** `macro_data` schema: `log_entries`, `entry_versions`, `saved_foods`, `protein_goals`,
    `saved_food_aliases`, `protein_goal_aliases`, `sync_state`.
- Client: per-user IndexedDB `macro-counter.u.<userId>` moves to schema **v2** (new `entryVersions`,
  `outbox` and `quarantine` stores, new entry fields, and `sync.*` meta).
- See [data-model.md](./data-model.md).

**Testing**:
- Backend: xUnit + `WebApplicationFactory` against the local PostgreSQL 17 test database as the
  least-privilege role (003 R14). `FakeTimeProvider` drives the skew and ordering tests. A
  concurrent-push test runs two pushes for one user in parallel and asserts dense, gap-free pulls.
- Frontend: Vitest + fake-indexeddb for the migration, repositories, outbox, scheduler (fake timers)
  and status. React Testing Library for the indicator, notice, sign-out warning and live refresh.
- Playwright e2e with **two browser contexts on one account** for cross-device behavior, plus
  `context.setOffline` for offline cases.
- Shared JSON test vectors keep the name normalization and validation bounds identical on both sides.

**Target Platform**: Unchanged. Modern desktop and mobile browsers (PWA). Linux Azure App Service B1,
single instance.

**Project Type**: Web application (the existing React SPA + ASP.NET Core API)

**Performance Goals**:
- A change reaches another open, visible device in ≤ 6 s typical and < 10 s p95 (SC-001).
- A new device loads 1 year of history (about 2,500 records, about 600 KB JSON, 5 pages) in < 15 s
  (SC-003).
- An empty pull costs < 30 ms p95 server-side (session check plus one indexed query).
- The 90-day trends view opens in < 2 s on a device with a year of history (SC-008).

**Constraints**:
- Logging stays local-first and instant: sync never sits on the logging path (Principle IV).
- Push is all or nothing (FR-014).
- Food data never appears in logs (FR-015).
- The device clock is not trusted for ordering (FR-007).
- One app instance (in-memory rate limiters, unchanged).

**Scale/Scope**:
- Under 20 accounts.
- About 10–20 entries per user per day.
- 4 new endpoints ([contracts/sync-api.yaml](./contracts/sync-api.yaml)).
- 3 new screens (sync notice, entry history, trends), 1 Recently deleted list, 1 header indicator, 1
  inline confirmation, an export action, and a Meal field on 4 forms.

No NEEDS CLARIFICATION remains. Research R1–R21 resolves storage layout, protocol, conflict rule,
natural-key merges, freshness, first sync, notice, removal and backups, encryption and logging, RLS,
limits, UI, dependencies, entry history, restore, retention, categories, quick picks, trends, staging
and export.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **v3.0.0**.

| Principle | Gate | Status |
|---|---|---|
| **I. Test-First** | Every behavior in the tables above gets a failing test first: conflict matrix, atomicity, cross-user, RLS, migration v1→v2, outbox, scheduler, UI states, e2e two-context sync. Security tests cover unauthenticated access, ID collisions across users, oversized pushes, rate limits and the notice gate. `/speckit-tasks` must order each test before its implementation. | ✅ Planned |
| **II. Correct Nutrition Math** | Sync stores and sends values at full precision (`double precision`, no rounding on either side). Existing nutrition modules are untouched. New calculations (`groupByCategory` subtotals, `buildTrend`) are pure functions that reuse `sumMacros` and `goalForDay`, with the same 100% coverage. No totals are stored (FR-032). An e2e check confirms that totals for hand-verified reference days are identical on both devices (SC-006). | ✅ |
| **III. Synced, Offline-Capable Data** | Point by point: | |
| ‣ Server may store activity data, not photos or device prefs | Only entries, saved foods and goals are synced. `DevicePreferences` and the device DB are untouched. Photos are never persisted. | ✅ |
| ‣ Owned by one user; scoped server-side | `user_id` comes from the session only. PK `(user_id, id)`. RLS on `macro.user_id` (R10). | ✅ |
| ‣ Local data per user; sign-out keeps unsynced changes locked | Unchanged per-user DB (003). The outbox lives inside it. Inline sign-out warning (FR-011). | ✅ |
| ‣ Single storage abstraction on each side | The device: repositories own record and outbox writes. A new `SyncEngine` talks to the repositories plus `api/sync.ts` (the HTTP module). UI only sees `useSyncStatus` and `changes.subscribe`. The server: endpoints call `SyncStore` only. | ✅ |
| ‣ Stable IDs, timestamps, deletions recorded; no return from a stale copy | Existing UUIDs and timestamps. Tombstones stay until an explicit restore, and a stale upsert can never revive one (R3, R15). | ✅ |
| ‣ Deterministic, tested conflict rules, not relying on device clocks | Skew-corrected LWW with a delete-wins rule, documented in R3 and the R15 table, each with a test matrix. Device clock offsets are cancelled out. The one remaining clock risk is recorded in R3. | ✅ Residual risk recorded |
| ‣ Offline changes kept and auto-synced; UI shows unsynced/failing | Outbox, scheduler triggers, status indicator (R5, R12). | ✅ |
| ‣ Versioned schemas with tested migrations | IndexedDB v1→v2 (tested, including queueing existing data, new entry fields, food links and legacy adoption). EF migration for `macro_data` tested against real PostgreSQL (schema, constraints, grants, RLS). | ✅ |
| ‣ Server validates every record; whole request rejected | Endpoint validator plus DB check constraints. All or nothing with indexed reason codes (data-model bounds). | ✅ |
| ‣ User removal deletes data; backup retention stated | `macro_admin.delete_user` cascade, including `entry_versions`. Supabase backups ≤ 7 days (R8). Removal is by the owner, on request (FR-016). | ✅ |
| ‣ Export | A device-built JSON export from the Account screen (R21, FR-036). | ✅ Closes the gap open since 001 |
| **IV. Fast Logging** | Logging writes locally and returns immediately. Sync runs in the background. The Meal field is pre-filled, so the interaction counts are unchanged (FR-021). Quick picks put repeat foods first. The new UI works at 360 px with 44 px targets and text labels. | ✅ |
| **V. Simplicity** | No new dependencies, including for charts. Polling instead of a push channel. Record-level LWW instead of CRDTs. One migration stream. No stored counters or totals. New server state and the sync engine are recorded under Complexity Tracking. | ✅ See Complexity Tracking |
| **VI. AI Lookup** | Untouched. AI-sourced records keep their `source` through sync, so "saved foods record that data came from AI" holds on every device. | ✅ |
| **VII. Security & Auth** | Point by point: | |
| ‣ Access | All 4 endpoints require a full session (fallback policy). They are added to the endpoint-inventory test. No public sync route. | ✅ |
| ‣ Authorization | No user IDs on the wire. PK includes `user_id`. RLS as defense in depth. Tests for ID collisions and RLS with the setting unset. | ✅ |
| ‣ Sessions / CSRF | Existing session cookie. `POST` endpoints go through `CsrfEndpointFilter` and the origin check. Polling does not change session lifetime rules (R5). | ✅ |
| ‣ Transport & hardening | Unchanged: HTTPS, HSTS, strict CSP (`connect-src 'self'` already covers `/api/sync`). | ✅ |
| ‣ Abuse resistance | `SyncPerUser` limiter at 60 per minute. 200 changes and 256 KiB per push. Pull page cap of 500. StrictJson (R11). | ✅ |
| ‣ Secrets & config | No new secrets. The same connection string and role. | ✅ |
| ‣ Supply chain | No new packages. The existing audit scans run in `check.ps1` and CI. | ✅ |
| ‣ Logging & privacy | New audit codes (`sync_rejected`, `user_deleted`, the sync rate-limit reason). Reason codes only. A sentinel food-name scan over logs and audit (R9). | ✅ |
| ‣ Threat model | See below. | ✅ |
| ‣ Accountability | A server-enforced sync notice before the first upload (R7), which also states the 90-day history retention. The setup notice text is extended for new accounts. The owner can delete a user and their data immediately (R8). | ✅ |
| **Tech Constraints: Storage** | Activity data lives in `macro_data`, separate from the `macro` identity tables, in the existing PostgreSQL. Versioned migrations. Encrypted in transit (TLS VerifyFull) and at rest (Supabase AES-256) (R9). Never logged. | ✅ |
| **Tech Constraints: Cross-device** | This feature is the sync mechanism. Future features that touch activity data plug into the same outbox and record types. | ✅ |
| **Tech Constraints: Privacy** | No new third parties. Claude requests are unchanged and still carry no history or identity. | ✅ |
| **Governance** | New data exposure. `/security-review` plus an ASVS L2 pass on the sync endpoints before release (quickstart, Production rollout step 4). | ✅ Planned |

**Gate result (pre-research)**: PASS.

**Post-design re-check (after Phase 1)**: PASS.
- The data model puts `user_id` in every primary key and RLS policy.
- The contract has no user ID fields and declares `x-access: full` on every endpoint.
- Grants give the app role no `delete` on `macro_data`.
- The validation bounds are shared by device and server.

**Re-check after the 2026-11-03 scope (2026-11-04)**: PASS.
- `entry_versions` has the same ownership, RLS and validation as entries, and the app role can only
  select and insert.
- Restore keeps constitution III's stale-copy rule (R15).
- Retention reuses the existing purge job (R16).
- The notice discloses that deleted data stays for up to 90 days.

- Export reads only the signed-in user's local database and adds no server route (R21).

No new violations. Export (FR-036) and the narrowed FR-016 clear the two earlier ⚠️ notes.

### Threat model (Principle VII; baseline OWASP ASVS L2 / Top 10)

**New asset**: each user's food log, saved foods and goals (health-related personal data), now held on
the server and in its backups.

**Trust boundaries**: these are unchanged from 003:
1. Browser ↔ App Service (TLS)
2. App Service ↔ Supabase (TLS VerifyFull)
3. Owner ↔ Supabase dashboard (MFA)
4. Person ↔ person on a shared browser

What is new is that boundary 2 now carries health data.

| # | Threat (OWASP category) | Mitigation | Residual risk |
|---|---|---|---|
| S1 | User X reads or changes user Y's records (A01 Broken Access Control) | User from session only. PK `(user_id, id)`. RLS on `macro.user_id`, so a query sees nothing when it is unset. Tests: ID collision, missing `where`, unauthenticated access | Low |
| S2 | A bug in a query leaks across users (A01) | RLS pins every statement to the transaction's user (R10). A test runs a deliberately unscoped `select` as the app role and expects only the caller's rows | Low |
| S3 | Malicious or malformed push corrupts data or totals (A03 Injection, A04 Insecure Design) | Parameterized SQL only. StrictJson. Endpoint validator plus DB check constraints. All or nothing. `day_key` immutable. `schemaVersion` allowlist | Low |
| S4 | A forged `clientNow` or `updatedAt` lets a device always win conflicts (A04) | Only the user's own records are affected. Corrected times are clamped to `serverNow` | Accepted: a user can only win conflicts against themselves |
| S5 | Resource exhaustion through huge or frequent pushes or pulls (A04/A05) | 256 KiB and 200-change caps. 500-record pages. 60-per-minute per-user limiter. Per-user row lock bounds concurrency | Low |
| S6 | A database breach or leaked backup exposes food logs (A02 Cryptographic Failures) | Supabase AES-256 at rest. Network restriction and TLS VerifyFull (003). Least-privilege app role (no DDL, no delete). Backups ≤ 7 days | Medium, and inherent: accepted by constitution v3.0.0 and disclosed to users (R7) |
| S7 | The owner reads friends' data (insider) | Disclosed before the first sync (R7, constitution VII Accountability) | Accepted by design |
| S8 | Food data leaks into logs or audit (A09 Logging Failures) | No body logging. Reason codes only. Sentinel scan test (R9) | Low |
| S9 | CSRF triggers a push or deletion from another site (A01) | Existing antiforgery filter and origin check on all `POST /api/sync/*`. `SameSite=Strict` session | Low |
| S10 | A shared browser exposes the previous user's unsynced data (A01) | Per-user DB and lock (003 unchanged). The outbox lives inside the user's DB. A test signs in as the second user after an offline sign-out | Low |
| S11 | A deleted user's data survives (privacy) | FK cascade from `macro.users`. A test asserts zero rows in every `macro_data` table after `delete_user`. The backup window is documented | Low (≤ 7 days in backups) |
| S12 | A deleted entry's food data outlives its 90 days (privacy) | Tombstones hold no food data. A daily purge removes versions. A test seeds expired rows and asserts both. A failed `pg_cron` job is visible in Supabase | Low: a stopped job delays removal until it runs again |
| S13 | A forged version or restore rewrites history (A04, A08) | Versions are insert-only with no `update` or `delete` grant. `id` collisions are ignored. Same validator and RLS as entries. Restore is scoped to the session's user | Accepted: a user can only change their own history |
| S14 | History grows without limit through repeated edits (A04/A05) | Versions count toward the 200-change and 256 KiB caps and the rate limiter. The 90-day purge bounds the total | Low |
| S15 | An exported file is left somewhere others can read it (privacy) | The Account screen says the file holds the food log. Export is built only from the signed-in user's database, and a test signs in as a second user to confirm it | Accepted: the file is the user's own copy once saved |

## Project Structure

### Documentation (this feature)

```text
specs/007-cross-device-sync/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R21
├── data-model.md        # Phase 1: server tables, device stores, bounds, export file, state transitions
├── quickstart.md        # Phase 1: setup, test suites, manual validation V1–V11, rollout
├── contracts/
│   ├── sync-api.yaml    # Phase 1: /api/sync/* (OpenAPI 3.1)
│   └── ui-sync.md       # Phase 1: notice, status, live refresh, sign-out, meals, history, quick picks, trends
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
backend/
├── MacroCounter.Api/
│   ├── Sync/                         # NEW
│   │   ├── SyncEndpoints.cs          # /api/sync/state, /notice, /push, /changes
│   │   ├── SyncContracts.cs          # request/response records (StrictJson)
│   │   ├── SyncValidator.cs          # shared bounds, reason codes, all-or-nothing
│   │   ├── SyncStore.cs              # raw SQL: set_config, revision bump, LWW upserts, merges, pull
│   │   └── ClockSkew.cs              # offset + clamp (R3), pure, unit tested
│   ├── Data/
│   │   ├── IdentityDbContext.cs      # + macro_data entity mappings (comment updated)
│   │   ├── ActivityRecords.cs        # NEW: entity classes for migrations
│   │   └── Migrations/<ts>_ActivityData.cs  # NEW: schema, tables, RLS, grant_app_role, delete_user, purge_expired, audit codes
│   ├── Audit/AuditLog.cs             # + sync_rejected, user_deleted, reason codes
│   ├── Security/RateLimits.cs        # + SyncPerUser policy
│   └── Program.cs                    # + api.MapSyncEndpoints()
└── MacroCounter.Api.Tests/
    ├── Sync/                         # NEW: endpoint, conflict matrix, merge, concurrency, notice, limits
    ├── Database/ActivityDataMigrationTests.cs, DeleteUserTests.cs   # NEW
    ├── Security/ (EndpointInventory, CrossUser, AccessMatrix updated; SyncIsolationTests NEW)
    └── Audit/ (AuditCoverage, SecretScan updated with sentinel food name)

frontend/
├── src/
│   ├── api/sync.ts                   # NEW: typed client for /api/sync/* (zod-validated responses)
│   ├── data/
│   │   ├── db.ts                     # schema v2 migration (versions, outbox, quarantine, entry fields, food links, enqueue existing)
│   │   ├── records.ts, repositories.ts  # + versionId, mealCategory, EntryVersion, listByDayRange, listQuickPicks
│   │   ├── outbox.ts                 # NEW: enqueue/peek/ack by seq, quarantine
│   │   ├── syncBounds.ts             # NEW: shared validation bounds (device pre-check)
│   │   ├── entryRepository.ts, savedFoodRepository.ts, proteinGoalRepository.ts  # + outbox and version writes
│   │   ├── entryVersionRepository.ts # NEW: history, recently deleted, restore, local purge
│   │   ├── logService.ts             # save the food first, so new entries link to it
│   │   ├── legacyAdoption.ts         # queue copied records in the outbox
│   │   ├── exportData.ts             # NEW: buildExport, read through the repositories
│   │   ├── downloadFile.ts           # NEW: Blob and temporary download link (injected)
│   │   ├── remoteApply.ts            # NEW: apply pulled changes, skip pending keys, alias rewrite
│   │   └── changes.ts                # NEW: in-memory change emitter
│   ├── domain/
│   │   ├── meals.ts                  # NEW: categories, categoryForTime, groupByCategory
│   │   ├── quickPicks.ts             # NEW: rankQuickPicks
│   │   └── nutrition/trends.ts       # NEW: buildTrend
│   ├── sync/                         # NEW
│   │   ├── syncEngine.ts             # push-then-pull round, pagination, results handling
│   │   ├── scheduler.ts              # 5 s visible polling, debounce, backoff, triggers
│   │   └── useSyncStatus.ts          # status state for the UI
│   ├── features/sync/                # NEW: SyncStatus.tsx, SyncNotice.tsx
│   ├── features/trends/              # NEW: TrendsView.tsx, TrendChart.tsx (inline SVG)
│   ├── features/today/               # + EntryHistory.tsx, RecentlyDeleted.tsx, meal groups in EntryList
│   ├── features/shared/              # + MealCategoryField.tsx
│   ├── features/add-food, recent     # Meal field; quick picks use listQuickPicks
│   ├── features/today|recent|goal|history  # subscribe to changes for live refresh
│   ├── App.tsx                       # + 'trends' view
│   ├── auth/AccountMenu.tsx          # inline unsynced-changes warning, Export my data
│   ├── auth/SetupFlow.tsx            # setup notice text includes sync (R7)
│   └── app/services.tsx              # UserData + sync, changes
└── tests/e2e/auth/
    └── sync-two-devices.spec.ts      # NEW (signed-in project; two contexts, offline, first-sync merge)

shared test vectors: backend/MacroCounter.Api.Tests/Sync/vectors/*.json, read by both test suites
docs/deploy.md                        # §1 heading, delete_user, backup retention
```

**Structure Decision**: Keep the existing two projects (`backend/`, `frontend/`). Sync gets its own
folder on each side (`Sync/`, `src/sync/`), so the protocol code sits in one place. Persistence stays
behind the existing repositories (device) and a single `SyncStore` (server), as Principle III requires.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Server-side activity tables + RLS policy on `macro.user_id` | Cross-device access is the feature. RLS gives defense in depth for health data (S2) | App-level `where user_id` alone: one forgotten clause would leak data across users. RLS costs one `set_config` per transaction |
| Outbox + cursor sync engine and scheduler (~300 lines client, ~300 server) | Offline logging (FR-009) and gap-free delivery (FR-005) | Online-only server writes: break offline logging (Principle III/IV). Full-state diff: cost grows with history |
| Skew-corrected timestamps | FR-007 forbids trusting device clocks | Arrival order or stale-base-loses: both discard the newer edit in the long-offline case (R3) |
| Natural-key merge with alias tables | FR-008 requires one saved food per name and unit across devices | Deterministic IDs: would need a rewrite migration of existing local data and links (R4) |
| Device quarantine store | All-or-nothing pushes would otherwise be blocked forever by one bad legacy record | Per-record partial apply: violates FR-014 |
| `entry_versions` as a fourth synced record type, with state IDs | FR-024 needs offline intermediate states and SC-007 needs losing edits, and neither side can see both alone (R14) | Server-only or device-only capture: each misses one of those cases. Content hashes: collapse real states and need matching C# and TypeScript rules |
| Restore rule table and server-only `restored_at` | FR-026 needs a restore to beat a delete without letting stale copies do the same (R15) | Clearing the tombstone on any newer upsert: breaks constitution III |
| Nullable data columns on tombstones | A permanent tombstone must not keep food data past 90 days (R16) | A second tombstone table: more tables and a more complex pull. Scrubbing at 90 days: a second purge rule for the same data |
