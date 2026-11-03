# Quickstart & Validation: Cross-Device Sync

This guide covers setup, the automated tests, and hand checks for each user story. For the contracts,
see [sync-api.yaml](./contracts/sync-api.yaml) and [ui-sync.md](./contracts/ui-sync.md). For the data
shapes and bounds, see [data-model.md](./data-model.md).

## Prerequisites

Same as 003/006: .NET 10, Node 24, local PostgreSQL 17 with `MACROCOUNTER_TEST_PG` set, and `dotnet-ef`.
There are no new tools.

## Local setup

1. Re-run `scripts/dev-db.ps1`. It applies the idempotent migration script, which now creates the
   `macro_data` schema, and re-runs `select macro_admin.grant_app_role('macro_app')`.
2. Run the app as before on `http://localhost:5080`.
3. For two "devices", use two browser profiles (or a normal window and a private window) signed in as
   the same account. For a second account, use `e2e-friend`, or invite one with `macro_admin.invite_user`.

## Automated tests (the merge gate)

`scripts/check.ps1` runs these. No test contacts Supabase or Claude.

| Suite | Command | Covers |
|---|---|---|
| Backend | `dotnet test backend` | Push/pull contract, all-or-nothing validation (FR-014), last-writer-wins with skew correction and tombstones (FR-007, SC-007), natural-key merges and aliases (FR-008), per-user revisions with no skipped changes under concurrent pushes, notice gate (FR-017), limits and rate limit (FR-018), cross-user isolation including ID collisions and RLS with `macro.user_id` unset (FR-013, SC-005), `delete_user` cascade (FR-016), audit events and the sentinel-name log scan (FR-015, FR-019), endpoint inventory, grants (no `delete` on `macro_data`) |
| Frontend unit/component | `npm --prefix frontend test` | v1→v2 migration enqueues existing data, repositories write record and outbox atomically, outbox `seq` handling, apply-pull skips pending keys, merge rewrite of IDs and `savedFoodId`, quarantine, sync scheduler (5 s visible polling, backoff, triggers), status states, sign-out warning, live refresh of Today, Recent and Goal, nutrition totals unchanged (Principle II suites stay at 100%) |
| End-to-end | `scripts/e2e-db.ps1; npm --prefix frontend run e2e` | Two browser contexts, same account: log, edit, delete and see the change on the other within 10 s. Offline logging, then reconnect. First sync merging two pre-seeded devices. Two accounts never see each other's data |

## Manual validation scenarios

Expected results are in **bold**.

### V1. Same log on two devices (US1, SC-001)

1. Sign in on A and B as the same user. **The notice appears once on each (V5). After acknowledging,
   the status shows "Synced".**
2. On A, log "Banana 120 g". **B shows it, and its totals update, within 10 s, without a reload.**
3. On B, change it to 150 g. **A shows 150 g and the recalculated totals.**
4. On A, delete it. **It disappears on B and does not return after reloading either device.**
5. Sign in on a third, fresh profile C. **The full history, saved foods and goals appear (SC-003: under
   15 s for a year of data. Seed one with the e2e helper to time it).**

### V2. Merging existing data (US2, SC-002)

1. With sync not yet deployed (check out `master` before this feature), log different entries on A and
   B, including the same new food ("Greek yogurt", g) on both. Then switch to this branch.
2. Sign in on both and acknowledge the notice. **Both show the union of entries, each exactly once.
   Quick picks show a single "Greek yogurt". Entries on both devices still link to it.**

### V3. Offline logging (US3)

1. On A, turn on DevTools → Network → Offline. Log two foods and edit one. **They save instantly, the
   totals update, and the status shows "Offline: will sync later".**
2. Go back online. **The status goes Syncing… → Synced. B receives both changes within 10 s.**

### V4. Conflicts (edge cases, FR-007)

1. Take A offline. On A, edit entry X to 200 g. On B (online), edit X to 300 g a minute later. Bring A
   back. **Both show 300 g (B's edit is more recent).**
2. Repeat with A's clock set 2 hours ahead (OS settings) before going offline. **The result is the same
   300 g: skew correction applies.**
3. Take A offline and edit X. On B, delete X. Bring A back. **X stays deleted on both.**

### V5. Privacy and removal (US4)

1. As user Y, try `GET /api/sync/changes?since=0` with no session. **401.** Signed in as Y, the
   response contains **only Y's records**.
2. A push before acknowledging the notice gets **409 `sync_notice_required`**.
3. A push with a negative `kcal` gets **400 `invalid_request`, and no other change in that push is
   applied**.
4. As the owner in `psql`: `select macro_admin.delete_user('<y>');`. Then
   `select count(*) from macro_data.log_entries where user_id = '<y id>'`. **The count is 0.** The
   audit log has **`user_deleted`** and contains no food names.

### V6. Sign-out with unsynced changes (FR-011)

1. Take A offline, log a food, and open the account menu → Sign out. **An inline warning shows "1 change
   hasn't synced yet…". Choose "Sign out anyway".**
2. Sign in on A as a different user. **The first user's unsynced entry is not visible.**
3. Sign back in as the first user while online. **The entry syncs and appears on B.**

## Production rollout

1. Generate and apply the idempotent migration script as the owner (`docs/deploy.md` §1, step 5). Then
   re-run `select macro_admin.grant_app_role('macro_app');`.
2. Deploy the app (`docs/deploy.md` §3). Every existing user sees the sync notice on next launch, and
   their existing local data uploads after they acknowledge it.
3. Update `docs/deploy.md` §1. Its heading "identity and security data only" changes, and it gains the
   backup-retention note (R8) and the `delete_user` procedure.
4. **Governance**: before release, run `/security-review` and an ASVS L2 pass on the new sync endpoints
   (new data exposure, constitution Governance). Record the findings in the PR.
