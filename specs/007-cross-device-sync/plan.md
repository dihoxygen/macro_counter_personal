# Implementation Plan: Cross-Device Sync

**Branch**: `007-cross-device-sync` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-cross-device-sync/spec.md`

## Summary

A user's log entries, saved foods and protein-goal history now sync between every device they sign
in on. Each device keeps working offline. This relies on constitution v3.0.0, which allows activity
data on the server.

- **Server copy.** A new `macro_data` schema in the existing Supabase PostgreSQL database holds three
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
  device's clock skew** at push time. A delete always wins, through permanent tombstones. Saved foods
  and goal days that collide by natural key are merged into one canonical row, with aliases
  ([R3](./research.md#r3-conflict-rule-that-does-not-trust-device-clocks-fr-007),
  [R4](./research.md#r4-natural-key-merges-saved-foods-and-goals-fr-008)).
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
  - **New** `macro_data` schema: `log_entries`, `saved_foods`, `protein_goals`, `saved_food_aliases`,
    `protein_goal_aliases`, `sync_state`.
- Client: per-user IndexedDB `macro-counter.u.<userId>` moves to schema **v2** (new `outbox` and
  `quarantine` stores, and `sync.cursor` meta).
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
- 1 new screen (sync notice), 1 header indicator, and 1 inline confirmation.

No NEEDS CLARIFICATION remains. Research R1–R13 resolves storage layout, protocol, conflict rule,
natural-key merges, freshness, first sync, notice, removal and backups, encryption and logging, RLS,
limits, UI, and dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **v3.0.0**.

| Principle | Gate | Status |
|---|---|---|
| **I. Test-First** | Every behavior in the tables above gets a failing test first: conflict matrix, atomicity, cross-user, RLS, migration v1→v2, outbox, scheduler, UI states, e2e two-context sync. Security tests cover unauthenticated access, ID collisions across users, oversized pushes, rate limits and the notice gate. `/speckit-tasks` must order each test before its implementation. | ✅ Planned |
| **II. Correct Nutrition Math** | Sync stores and sends values at full precision (`double precision`, no rounding on either side). The nutrition modules are untouched and keep 100% coverage. An e2e check confirms that totals for hand-verified reference days are identical on both devices (SC-006). | ✅ |
| **III. Synced, Offline-Capable Data** | Point by point: | |
| ‣ Server may store activity data, not photos or device prefs | Only entries, saved foods and goals are synced. `DevicePreferences` and the device DB are untouched. Photos are never persisted. | ✅ |
| ‣ Owned by one user; scoped server-side | `user_id` comes from the session only. PK `(user_id, id)`. RLS on `macro.user_id` (R10). | ✅ |
| ‣ Local data per user; sign-out keeps unsynced changes locked | Unchanged per-user DB (003). The outbox lives inside it. Inline sign-out warning (FR-011). | ✅ |
| ‣ Single storage abstraction on each side | The device: repositories own record and outbox writes. A new `SyncEngine` talks to the repositories plus `api/sync.ts` (the HTTP module). UI only sees `useSyncStatus` and `changes.subscribe`. The server: endpoints call `SyncStore` only. | ✅ |
| ‣ Stable IDs, timestamps, deletions recorded | Existing UUIDs and timestamps. Server tombstones are permanent (R3). | ✅ |
| ‣ Deterministic, tested conflict rules, not relying on device clocks | Skew-corrected LWW with a delete-wins rule, documented in R3 with a test matrix. Device clock offsets are cancelled out. The one remaining clock risk is recorded in R3. | ✅ Residual risk recorded |
| ‣ Offline changes kept and auto-synced; UI shows unsynced/failing | Outbox, scheduler triggers, status indicator (R5, R12). | ✅ |
| ‣ Versioned schemas with tested migrations | IndexedDB v1→v2 (tested, including queueing existing data). EF migration for `macro_data` tested against real PostgreSQL (schema, constraints, grants, RLS). | ✅ |
| ‣ Server validates every record; whole request rejected | Endpoint validator plus DB check constraints. All or nothing with indexed reason codes (data-model bounds). | ✅ |
| ‣ User removal deletes data; backup retention stated | `macro_admin.delete_user` cascade. Supabase backups ≤ 7 days (R8). | ✅. ⚠️ Self-removal is through the owner (R8). Spec FR-016 wording should be narrowed |
| ‣ Export | Still no export feature, as noted since 001. This feature neither adds nor removes export. | ⚠️ Pre-existing gap, unchanged |
| **IV. Fast Logging** | Logging writes locally and returns immediately. Sync runs in the background. The interaction counts are unchanged. The indicator and notice work at 360 px with 44 px targets and text labels. | ✅ |
| **V. Simplicity** | No new dependencies. Polling instead of a push channel. Record-level LWW instead of CRDTs. One migration stream. New server state and the sync engine are recorded under Complexity Tracking. | ✅ See Complexity Tracking |
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
| ‣ Accountability | A server-enforced sync notice before the first upload (R7). The setup notice text is extended for new accounts. The owner can delete a user and their data immediately (R8). | ✅ |
| **Tech Constraints: Storage** | Activity data lives in `macro_data`, separate from the `macro` identity tables, in the existing PostgreSQL. Versioned migrations. Encrypted in transit (TLS VerifyFull) and at rest (Supabase AES-256) (R9). Never logged. | ✅ |
| **Tech Constraints: Cross-device** | This feature is the sync mechanism. Future features that touch activity data plug into the same outbox and record types. | ✅ |
| **Tech Constraints: Privacy** | No new third parties. Claude requests are unchanged and still carry no history or identity. | ✅ |
| **Governance** | New data exposure. `/security-review` plus an ASVS L2 pass on the sync endpoints before release (quickstart, Production rollout step 4). | ✅ Planned |

**Gate result (pre-research)**: PASS, with two ⚠️ notes that are not violations: self-removal goes
through the owner, and export is a pre-existing gap.

**Post-design re-check (after Phase 1)**: PASS.
- The data model puts `user_id` in every primary key and RLS policy.
- The contract has no user ID fields and declares `x-access: full` on every endpoint.
- Grants give the app role no `delete` on `macro_data`.
- The validation bounds are shared by device and server.

No new violations.

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

## Project Structure

### Documentation (this feature)

```text
specs/007-cross-device-sync/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R13
├── data-model.md        # Phase 1: server tables, device stores, bounds, state transitions
├── quickstart.md        # Phase 1: setup, test suites, manual validation V1–V6, rollout
├── contracts/
│   ├── sync-api.yaml    # Phase 1: /api/sync/* (OpenAPI 3.1)
│   └── ui-sync.md       # Phase 1: notice, status indicator, live refresh, sign-out warning
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
│   │   └── Migrations/<ts>_ActivityData.cs  # NEW: schema, tables, RLS, grant_app_role, delete_user, audit codes
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
│   │   ├── db.ts                     # schema v2 migration (outbox, quarantine, enqueue existing)
│   │   ├── outbox.ts                 # NEW: enqueue/peek/ack by seq, quarantine
│   │   ├── syncBounds.ts             # NEW: shared validation bounds (device pre-check)
│   │   ├── entryRepository.ts, savedFoodRepository.ts, proteinGoalRepository.ts  # + outbox writes
│   │   ├── remoteApply.ts            # NEW: apply pulled changes, skip pending keys, alias rewrite
│   │   └── changes.ts                # NEW: in-memory change emitter
│   ├── sync/                         # NEW
│   │   ├── syncEngine.ts             # push-then-pull round, pagination, results handling
│   │   ├── scheduler.ts              # 5 s visible polling, debounce, backoff, triggers
│   │   └── useSyncStatus.ts          # status state for the UI
│   ├── features/sync/                # NEW: SyncStatus.tsx, SyncNotice.tsx
│   ├── features/today|recent|goal|history  # subscribe to changes for live refresh
│   ├── auth/AccountMenu.tsx          # inline unsynced-changes warning
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
