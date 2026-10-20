---
description: "Task list for Auth & Security Foundations"
---

# Tasks: Auth & Security Foundations

**Input**: Design documents from `/specs/003-auth-security-foundations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle I (Test-First, NON-NEGOTIABLE) and FR-032 apply.
Write each test task first, run it, and see it **fail** before you start the implementation task
it covers.

- Claude, HIBP (`api.pwnedpasswords.com`) and the live Supabase project are **never** contacted
  from tests. Backend tests use a throwaway local PostgreSQL database (research R14) and run as
  the least-privilege `macro_app` role.

**Organization**: Tasks are grouped by user story (US1–US7 from spec.md), so each story can be
built and checked as its own increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: The user story the task belongs to

## Path Conventions

- Backend: `backend/MacroCounter.Api/`, tests in `backend/MacroCounter.Api.Tests/`
- Frontend: `frontend/src/`, tests in `frontend/tests/{unit,components,e2e}/`
- Scripts: `scripts/`
- The **existing** e2e specs mock `/api/**` with `page.route()` (`frontend/tests/e2e/helpers.ts`).
  New specs that need the real backend go in `frontend/tests/e2e/auth/` and run in a separate
  Playwright project, `auth`, against the real backend and the `macro_e2e` database.

## Defaults used everywhere (from research.md; configurable)

| Setting | Value |
|---|---|
| Password | 12–128 chars, NFKC, must not contain username, HIBP breached → reject, HIBP unreachable → fail closed |
| PBKDF2 | `PasswordHasherOptions.IterationCount = 210_000` |
| TOTP | RFC 6238, 6 digits, 30 s; replay guard 5 min; 5 wrong codes per setup session |
| Full session | idle 24 h, absolute 7 d; `last_seen_at` written at most once per minute |
| Setup session | idle and absolute 15 min; setup deadline 72 h after invite or reset |
| Cookies | `__Host-mc_session`, `__Host-mc_af`: HttpOnly, Secure, SameSite=Strict, Path=/ |
| CSRF header | `X-CSRF-Token` |
| Sign-in limits | per IP 20 per 15 min; per username 10 failures per 15 min (applies to unknown names too); Identity lockout 10 → 15 min |
| AI limits | burst 6/min per user; 30 per user per UTC day; 200 global per UTC day; 3,000 global per UTC month |
| Audit retention | 180 days |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchain, packages and configuration skeletons

- [X] T001 (Owner decision 2026-10-14: the locally installed PostgreSQL **18** is used for local tests; CI uses 17 like Supabase.) Verify PostgreSQL 17 is installed locally (`psql --version` shows 17.x) and that the `MACROCOUNTER_TEST_PG` environment variable is set to an admin connection string (`Host=localhost;Username=postgres;Password=…`). If either is missing, **stop and ask the user** to run `winget install PostgreSQL.PostgreSQL.17` and then `setx MACROCOUNTER_TEST_PG "…"` in their own terminal. Never ask for the password in chat
- [X] T002 (Done with 10.0.13 for the Microsoft packages and Mvc.Testing: 10.0.12 pulled in System.Security.Cryptography.Pkcs/Xml with high-severity advisories.) Add backend packages to `backend/MacroCounter.Api/MacroCounter.Api.csproj`, version-aligned with the 10.0.x framework: `Npgsql.EntityFrameworkCore.PostgreSQL` 10.x, `Microsoft.AspNetCore.Identity.EntityFrameworkCore` 10.0.x, `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` 10.0.x, and `Microsoft.EntityFrameworkCore.Design` 10.0.x with `PrivateAssets=all`. Add `Microsoft.Extensions.TimeProvider.Testing` to `backend/MacroCounter.Api.Tests/MacroCounter.Api.Tests.csproj`
- [X] T003 Turn on NuGet lock files: set `<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>` in a new `backend/Directory.Build.props` (applies to both projects), run `dotnet restore backend`, and commit the generated `backend/MacroCounter.Api/packages.lock.json` and `backend/MacroCounter.Api.Tests/packages.lock.json`
- [X] T004 [P] Create a local tool manifest (created by the SDK at the repo root as `dotnet-tools.json`, dotnet-ef 10.0.13), with `dotnet-ef` 10.x (`dotnet new tool-manifest; dotnet tool install dotnet-ef`)
- [X] T005 [P] Add the frontend dependency `uqr` (0.1.x, pinned exactly) to `frontend/package.json` and update `frontend/package-lock.json` with `npm install`
- [X] T006 [P] Add `Security` and `Limits` sections with the defaults in the table above to `backend/MacroCounter.Api/appsettings.json`. Also add `"Security": { "AllowedOrigins": ["http://localhost:5080", "http://localhost:5173"] }` for development. Do **not** add a connection string here: it comes from User Secrets or the environment as `ConnectionStrings:Identity`
- [X] T007 [P] Create `backend/MacroCounter.Api/appsettings.Production.json` with `"AllowedHosts": "REPLACE_WITH_HOST"`, `"Security": { "AllowedOrigins": [] }` and `"Logging"` at Warning for `Microsoft.EntityFrameworkCore`. Add a comment in `README.md` (deployment section, written in T124) saying production must override both values

- [X] T008 (Branch protection enabled on 2026-10-14 after the first green run: required check `check`, strict, no force pushes or deletion.) Create `.github/workflows/ci.yml` (Constitution: Development Workflow, CI MUST run tests, linters and vulnerability scans). It triggers on `pull_request` to `master` and on `push` to `master`, and runs on `ubuntu-latest` with:
  - a `postgres:17` service container (`POSTGRES_PASSWORD` set to a random per-run value generated in the job, health check `pg_isready`, port 5432);
  - `MACROCOUNTER_TEST_PG=Host=localhost;Username=postgres;Password=<that value>` in the job env;
  - `actions/setup-dotnet` (10.0.x) and `actions/setup-node` (24.x, with npm cache);
  - `npm --prefix frontend ci` and `npx --prefix frontend playwright install --with-deps chromium`;
  - `pwsh scripts/check.ps1` as the only test step, so CI and the local gate are identical.

  Use **no repository secrets**: no test calls Claude, HIBP or Supabase. Pin every third-party action to a full commit SHA, with the version in a comment, and set `permissions: contents: read`. Until T117 lands, `check.ps1` runs the existing checks. Make sure `scripts/check.ps1` uses only paths and commands that work under `pwsh` on Linux (forward slashes, no Windows-only cmdlets).

  Give the job a stable name (`name: check`), so the required status check is `check`. **Once the workflow has passed at least once on GitHub**, turn on branch protection for `master`, which the owner approved on 2026-10-14:
  - require the `check` status to pass;
  - require branches to be up to date before merging;
  - do not allow force pushes or branch deletion.

  Use `gh api -X PUT repos/dihoxygen/macro_counter_personal/branches/master/protection` with `required_status_checks: {strict: true, contexts: ["check"]}`, `enforce_admins: false`, `required_pull_request_reviews: null`, `restrictions: null`, `allow_force_pushes: false` and `allow_deletions: false`. Confirm the result with `gh api repos/dihoxygen/macro_counter_personal/branches/master/protection`. Don't enable it before the first green run: a required check that has never reported would block every merge, including the one that adds the workflow.

**Checkpoint**: `dotnet build backend` and `npm --prefix frontend run typecheck` pass. `dotnet ef --version` works. The CI workflow runs green on a pushed branch.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The database schema, least-privilege role, test database fixture, audit writer,
problem codes and frontend HTTP layer that every story uses

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests first

- [X] T009 Create the test database fixture in `backend/MacroCounter.Api.Tests/Infrastructure/PostgresFixture.cs`. It is an xUnit collection fixture that:
  - reads `MACROCOUNTER_TEST_PG` and fails with a clear message if it is unset;
  - creates the database `macro_test_<guid>`;
  - applies all EF migrations as the admin;
  - creates the role `macro_app_<guid>` with a random password and runs the grant script for that role name (the role name is a parameter of the grants SQL; see T019);
  - exposes `AdminConnectionString` and `AppConnectionString` (connected as the app role);
  - offers `ResetAsync()`, which truncates every `macro.*` table between tests;
  - drops the database and role on dispose.
- [X] T010 [P] Write the schema constraint tests in `backend/MacroCounter.Api.Tests/Database/SchemaTests.cs`, using the admin connection with raw SQL inserts. Each of these must be **rejected**:
  - `username` not matching `^[a-z0-9._-]{3,32}$`;
  - a duplicate `username`;
  - `role` not in (`owner`, `user`);
  - a second `owner` row (partial unique index);
  - `sessions.kind` not in (`setup`, `full`);
  - an `audit_events.event_type` outside the FR-024 list in data-model.md;
  - an `audit_events.reason` outside the closed list;
  - an `audit_events.outcome` not in (`success`, `failure`, `info`);
  - a negative `ai_usage_daily.count`.

  Also check that deleting a user cascades to `user_tokens`, `sessions` and `ai_usage_daily`. Finally, assert that the set of tables in schema `macro` is **exactly** `users, user_tokens, user_claims, user_logins, sessions, ai_usage_daily, ai_usage_global_daily, audit_events, data_protection_keys`, plus EF's `__EFMigrationsHistory`. This guards FR-019: no food, photo or goal storage on the server.
- [X] T011 [P] Write the `AuditLog` tests in `backend/MacroCounter.Api.Tests/Audit/AuditLogTests.cs`:
  - `WriteAsync(AuditEvent type, AuditOutcome outcome, Guid? userId, AuditReason? reason, IPAddress? ip)` inserts exactly one row as the app role, with `actor = 'user'`, or `'system'` when there is no user;
  - the API has no free-text parameter, enforced at compile time by the enum types;
  - a failed insert (database down) is logged and does not throw into the request.
- [X] T012 [P] Write the `Problems` tests in `backend/MacroCounter.Api.Tests/Endpoints/ProblemsTests.cs`. Each new factory returns the status and `code` from contracts/auth-api.yaml: `Unauthenticated` 401 `unauthenticated`, `CsrfFailed` 403 `csrf_failed`, `SignInFailed` 401 `sign_in_failed` (detail is exactly "Could not sign in. Check your details and try again."), `RateLimited(retryAfter)` 429 `rate_limited` plus a `Retry-After` header, `QuotaExceeded(scope, resetAt)` 429 `quota_exceeded`, `PasswordRejected(reasons)` 400, `BreachCheckUnavailable` 503, `InvalidCode(attemptsLeft)` 400, `WrongSetupStep(expected)` 409, `ServiceUnavailable` 503 `service_unavailable`.
- [X] T013 [P] Write grant tests in `backend/MacroCounter.Api.Tests/Database/AppRoleGrantTests.cs`, run on the **app** connection (moved from US2 so tests come before T019). Each of these must fail with SQLSTATE `42501` (insufficient privilege):
  - `insert into macro.users`;
  - `delete from macro.users`;
  - `update macro.users set role='owner'`;
  - `update macro.users set disabled_at=null`;
  - `update macro.users set username='x'`;
  - `select` / `update` / `delete` on `macro.audit_events`;
  - `select macro_admin.invite_user('x')`.

  These must succeed: `select` on `macro.users`, `update macro.users set last_sign_in_at=now()`, `insert into macro.audit_events`, and full DML on `macro.sessions`. This proves the RLS policies from T019 let the app role through. A second role with no grants and no policy must see **zero rows** from `macro.users`, which proves RLS is on.
- [X] T014 [P] Write `invite_user` tests in `backend/MacroCounter.Api.Tests/Database/InviteUserTests.cs`, run on the **admin** connection (moved from US2 so tests come before T020). They check that `invite_user`:
  - rejects a name not matching `^[a-z0-9._-]{3,32}$`, a duplicate name, and a second `owner`;
  - trims and lowercases the name;
  - returns a code matching `^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$`;
  - stores only `sha256` of the normalized code (the code itself appears in no column);
  - sets `setup_expires_at = now() + 72 hours` and `lockout_enabled = true`;
  - writes exactly one `account_invited` audit row with `actor='owner'`.

  It must also work when `pgcrypto` is installed in a separate `extensions` schema and the caller's `search_path` doesn't include it, mirroring Supabase. The fixture creates that layout.
- [X] T015 [P] Write the `http.ts` tests in `frontend/tests/unit/api/http.test.ts`:
  - `apiFetch` sends `credentials: 'same-origin'`;
  - it adds `X-CSRF-Token` from `setCsrfToken()` on non-GET requests, but not on GET;
  - a 401 response dispatches a `session-expired` event on the exported `authEvents` EventTarget and throws `ApiError('unauthenticated')`;
  - a network failure throws `ApiError('network')`;
  - a problem+json `code` is parsed with zod, and an unknown code falls back to a status-code mapping.

### Implementation

- [X] T016 Create `backend/MacroCounter.Api/Auth/AppUser.cs` (`AppUser : IdentityUser<Guid>`) with the extra properties from data-model.md: `Role` (string: `owner` | `user`), `TempCodeHash` (byte[]?), `SetupExpiresAt`, `TotpLastCode`, `TotpLastUsedAt`, `AiNoticeAckAt`, `DisabledAt`, `CreatedAt`, `LastSignInAt` (DateTimeOffset?). Also create `backend/MacroCounter.Api/Data/SessionRecord.cs`, `AiUsageDaily.cs`, `AiUsageGlobalDaily.cs` and `AuditEventRecord.cs`, matching data-model.md column for column.
- [X] T017 Create `backend/MacroCounter.Api/Data/IdentityDbContext.cs`, deriving from `IdentityUserContext<AppUser, Guid>` and implementing `IDataProtectionKeyContext`. Set the default schema to `macro`. Map every table and column to the **snake_case** names in data-model.md explicitly (no naming-convention package): `users`, `user_tokens`, `user_claims`, `user_logins`, `sessions`, `ai_usage_daily`, `ai_usage_global_daily`, `audit_events`, `data_protection_keys`.
  - `Ignore()` the unused Identity columns `Email`, `NormalizedEmail`, `EmailConfirmed`, `PhoneNumber` and `PhoneNumberConfirmed`.
  - Add the CHECK constraints: username `^[a-z0-9._-]{3,32}$`, role in (`owner`, `user`), `sessions.kind` in (`setup`, `full`), `count >= 0`, and the closed audit `event_type`/`outcome`/`reason` lists.
  - Add a partial unique index on `role` where `role = 'owner'`, an index on `sessions.user_id`, and the PK (`user_id`, `day`) on `ai_usage_daily`.
- [X] T018 Generate the first migration with `dotnet ef migrations add InitialIdentitySchema --project backend/MacroCounter.Api --output-dir Data/Migrations` and check the generated SQL (`dotnet ef migrations script`) against data-model.md.
- [X] T019 Add a migration, `Data/Migrations/*_RolesGrantsAndRls.cs`, using `migrationBuilder.Sql`. It must:
  - `create extension if not exists pgcrypto`;
  - create the schema `macro_admin`;
  - define a SQL function `macro_admin.grant_app_role(p_role name)` that applies exactly the `macro_app` grants in data-model.md § "Database roles and grants": users `SELECT` plus column-level `UPDATE` on every column **except** `id, username, normalized_username, role, disabled_at, created_at`; no `INSERT`/`DELETE` on users; full DML on `user_tokens, sessions, ai_usage_daily, ai_usage_global_daily`; `SELECT` on `user_claims, user_logins`; `INSERT` only on `audit_events` (plus sequence usage); `SELECT, INSERT` on `data_protection_keys`; no access to `macro_admin`;
  - enable RLS on every `macro.*` table. `grant_app_role(p_role)` also creates the **app-role policies** that let the application through RLS (research R12):
    - for each table except `audit_events`: `create policy app_access on macro.<t> for all to <p_role> using (true) with check (true)`;
    - for `audit_events`: `create policy app_insert on macro.audit_events for insert to <p_role> with check (true)`, and no select, update or delete policy.

    There are no policies for any other role, so `anon`, `authenticated` and any role without grants see nothing. Do **not** use `BYPASSRLS` (Supabase's `postgres` role cannot grant it);
  - `revoke all … from public`;
  - inside a `do $$ … if exists (select 1 from pg_roles where rolname = 'anon') …` guard, also revoke from `anon` and `authenticated` (Supabase only; this lets the same script run on plain PostgreSQL);
  - create the extension with `create extension if not exists pgcrypto` only when it is missing in every schema. Every `macro_admin` function declares `set search_path = macro, extensions, public, pg_temp` so `gen_random_bytes` resolves on Supabase, where pgcrypto lives in `extensions`, and locally.

  Make T010 and T013 pass.
- [X] T020 Add a migration, `Data/Migrations/*_InviteUser.cs`, that creates `macro_admin.invite_user(p_username text, p_role text default 'user') returns text`, as specified in contracts/owner-procedures.md:
  - trim and lowercase the name; validate it against `^[a-z0-9._-]{3,32}$`; raise `user already exists: <name>` for a duplicate;
  - generate a 20-character code from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` plus one more unambiguous character (32 symbols, 5 bits each) using `gen_random_bytes`, formatted `XXXX-XXXX-XXXX-XXXX-XXXX`;
  - store `sha256(convert_to(<code without dashes, uppercase>, 'UTF8'))` in `temp_code_hash`;
  - set `normalized_username = upper(username)`, random `security_stamp`/`concurrency_stamp`, `lockout_enabled = true` and `setup_expires_at = now() + interval '72 hours'`;
  - insert an `account_invited` audit row with `actor = 'owner'`;
  - return the code.

  Make T014 pass.
- [X] T021 Create `backend/MacroCounter.Api/Audit/AuditLog.cs` with the `AuditEvent` enum (the FR-024 list in data-model.md, mapped to snake_case strings), `AuditOutcome`, the `AuditReason` closed enum (`bad_credentials`, `locked`, `rate_limited`, `account_incomplete`, `account_disabled`, `setup_expired`, `breach_check_unavailable`, `quota_user_daily`, `quota_global_daily`, `quota_global_monthly`, `invalid_code`) and `IAuditLog`/`AuditLog`, so that T011 passes. Keep the enum strings identical to the CHECK constraint in T017.
- [X] T022 Extend `backend/MacroCounter.Api/Endpoints/Problems.cs` with the factories from T012.
- [X] T023 Wire the foundations in `backend/MacroCounter.Api/Program.cs`:
  - `AddDbContext<IdentityDbContext>` with Npgsql using `ConnectionStrings:Identity`; fail at startup with a clear message if it is missing outside the Testing environment;
  - `services.AddSingleton(TimeProvider.System)`;
  - `AddDataProtection().SetApplicationName("MacroCounter").PersistKeysToDbContext<IdentityDbContext>()`. In Production, also `ProtectKeysWithCertificate(...)` from `DataProtection:CertificatePfxBase64` and `DataProtection:CertificatePassword`, and fail at startup if they are missing;
  - `AddIdentityCore<AppUser>(o => { o.Lockout.MaxFailedAccessAttempts = 10; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15); o.User.AllowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyz0123456789._-"; }).AddEntityFrameworkStores<IdentityDbContext>().AddTokenProvider<AuthenticatorTokenProvider<AppUser>>(TokenOptions.DefaultAuthenticatorProvider)`;
  - `Configure<PasswordHasherOptions>(o => o.IterationCount = 210_000)`;
  - register `IAuditLog`, `SecurityOptions` (`Security:`) and `LimitsOptions` (`Limits:`) in `backend/MacroCounter.Api/Security/SecurityOptions.cs` and `backend/MacroCounter.Api/Usage/LimitsOptions.cs`.

  The app must **never** call `Database.Migrate()`.
- [X] T024 (Done for the database and clock; the `IBreachedPasswordChecker` replacement is added with T044, which creates that interface.) Update `backend/MacroCounter.Api.Tests/Endpoints/ApiFactory.cs`:
  - take a `PostgresFixture` and set `ConnectionStrings:Identity` to `AppConnectionString`;
  - replace `TimeProvider` with a shared `FakeTimeProvider` exposed as `Clock`;
  - replace `IBreachedPasswordChecker` with `FakeBreachedPasswordChecker`, created in `backend/MacroCounter.Api.Tests/Infrastructure/FakeBreachedPasswordChecker.cs` (a configurable set of breached passwords, plus an `Unavailable` switch).

  Add `[Collection("Postgres")]` to the existing endpoint test classes. Make the existing estimate and status tests compile again; they are made green again in T050.
- [X] T025 Add `backend/MacroCounter.Api.Tests/Infrastructure/TestUsers.cs` with these helpers:
  - `InviteAsync(fixture, username, role = "user")` calls `macro_admin.invite_user` on the admin connection and returns the temporary code;
  - `Totp.Compute(base32Secret, DateTimeOffset at)` is an RFC 6238 test helper using `HMACSHA1` from `System.Security.Cryptography`, in `backend/MacroCounter.Api.Tests/Infrastructure/Totp.cs`;
  - `ActivateAsync(client, username)` runs the whole setup flow over HTTP (filled in by T049) and returns an `HttpClient` with a full session cookie and the CSRF token preset.
- [X] T026 Create `scripts/dev-db.ps1`. It:
  - creates database `macro_dev` and login role `macro_app` with a random password (if they don't exist), using `MACROCOUNTER_TEST_PG` as the admin connection;
  - runs `dotnet ef migrations script --idempotent` and applies it with `psql`;
  - calls `select macro_admin.grant_app_role('macro_app')`;
  - stores `ConnectionStrings:Identity` with `dotnet user-secrets set --project backend/MacroCounter.Api`;
  - prints the next step (`select macro_admin.invite_user('<you>','owner');`);
  - never echoes the password.
- [X] T027 [P] Create `frontend/src/api/http.ts` (`apiFetch`, `ApiError`, `setCsrfToken`, `authEvents`) so that T015 passes.
- [X] T028 Refactor `frontend/src/api/estimates.ts` and `frontend/src/api/status.ts` to call `apiFetch`. Keep their existing behavior and tests (`frontend/tests/unit/api/estimates.test.ts`, `status.test.ts`) green. Add the `unauthenticated` code to `EstimateErrorCode`, with the message "Sign in again to use AI lookup. Your entries are safe."

**Checkpoint**: `dotnet test backend` passes for the schema, audit and problem tests, and the
migrations apply to a fresh local database. `npm --prefix frontend test` passes.

---

## Phase 3: User Story 1 - Sign in to use the app (Priority: P1) 🎯 MVP

**Goal**: An invited person signs in with username, password and an authenticator code, or
completes first-time setup with a temporary code, and reaches Today. Sessions are server-side,
in HttpOnly cookies, CSRF-protected, and end on sign-out or expiry.

**Independent Test**: With one invited account, complete setup (password → authenticator →
notice) and reach Today. Sign out and sign back in with password + code. Check that wrong
credentials of every kind give the same generic message. Quickstart V1, V2, V4.1, V10.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [X] T029 [P] [US1] Write `PasswordPolicy` tests in `backend/MacroCounter.Api.Tests/Auth/PasswordPolicyTests.cs`:
  - an 11-character password gives `too_short`;
  - 12 characters is accepted;
  - 129 characters gives `too_long`;
  - a password containing the username, case-insensitively, gives `contains_username`;
  - input is NFKC-normalized before the length check (a full-width string normalizes);
  - there are no composition rules (`aaaaaaaaaaaa` is not rejected by the policy itself);
  - several reasons are returned together.
- [X] T030 [P] [US1] Write `BreachedPasswordChecker` tests in `backend/MacroCounter.Api.Tests/Auth/BreachedPasswordCheckerTests.cs`, using a fake `HttpMessageHandler`:
  - the request is `GET https://api.pwnedpasswords.com/range/{first 5 uppercase hex of SHA-1}` with the header `Add-Padding: true`;
  - the request never contains the password or the full hash;
  - a matching suffix with count > 0 means breached;
  - a padding entry with count 0 is not breached;
  - a timeout, a non-2xx response or a network error throws `BreachCheckUnavailableException` (fail closed).
- [X] T031 [P] [US1] Write `EncryptedUserStore` tests in `backend/MacroCounter.Api.Tests/Auth/EncryptedUserStoreTests.cs`:
  - after `SetAuthenticatorKeyAsync`, the raw `user_tokens.value` read through the admin connection is **not** the plaintext key;
  - `GetAuthenticatorKeyAsync` round-trips it;
  - `TryConsumeTotpAsync(user, code, now)` returns false for the same code within 5 minutes and true again after 5 minutes (the replay guard, R3).
- [X] T032 [P] [US1] Write `PostgresTicketStore` tests in `backend/MacroCounter.Api.Tests/Auth/PostgresTicketStoreTests.cs`, using `FakeTimeProvider`:
  - `StoreAsync` returns a 43+ character base64url key, and only its SHA-256 is in `sessions.key_hash`;
  - `RetrieveAsync` returns the ticket while valid;
  - a full session gives null after 24 h idle, and after 7 d absolute even if active;
  - a setup session gives null after 15 min;
  - it gives null when `users.security_stamp` no longer matches the session's stamp, or when `users.disabled_at` is set; an invalid row is deleted;
  - `last_seen_at` is updated only when more than 1 minute has passed;
  - `RemoveAsync` deletes the row.
- [X] T033 [P] [US1] Write `SignInService` tests in `backend/MacroCounter.Api.Tests/Auth/SignInServiceTests.cs`:
  - an active user with the correct password and a valid TOTP gives `SignedIn` and sets `last_sign_in_at`;
  - each of these gives the **same** `Failed` result: wrong password, wrong code, missing code, unknown user, disabled user, an INCOMPLETE account (no password hash and no temp code), and an invited user after `setup_expires_at`. The INCOMPLETE case writes audit reason `account_incomplete`;
  - an invited user with the right temp code (with or without dashes, any case) gives `SetupRequired(step: password)`;
  - a user who set a password but did not finish setup, signing in with that password and no code before the deadline, gives `SetupRequired(step: totp or notice)`;
  - ` Alice ` matches `alice`;
  - the password hasher is called exactly once on **every** path, including unknown users and the temp-code path (verify with a counting `IPasswordHasher` decorator).
- [X] T034 [P] [US1] Write `SetupService` tests in `backend/MacroCounter.Api.Tests/Auth/SetupServiceTests.cs`:
  - the steps must run in order `password → totp → notice`, and a step out of order gives `WrongSetupStep(expected)`;
  - setting the password clears `temp_code_hash` (single use), rotates the security stamp, and writes `password_set`. The stored `password_hash` decodes as Identity format v3 (`0x01` marker) with PRF HMAC-SHA512 and an **iteration count of 210,000**, and it does not contain the plaintext (FR-007);
  - a rejected password writes `password_rejected` and returns the reasons; a breached password gives `breached`; an unavailable HIBP gives `BreachCheckUnavailable` and writes audit reason `breach_check_unavailable`;
  - TOTP start returns a base32 key and an `otpauth://totp/Macro%20Counter:<username>?secret=…&issuer=Macro%20Counter&digits=6&period=30` URI; calling it twice before confirming returns the **same** key;
  - confirming with a valid code sets `two_factor_enabled = true` and writes `totp_enrolled`; each wrong code decrements `attemptsLeft`, and the 5th wrong code deletes the setup session and writes `totp_failed`;
  - the notice step sets `ai_notice_ack_at`, clears `setup_expires_at`, deletes the setup session, and issues a **new** full session with a different key (fixation test).
- [X] T035 [US1] Write auth endpoint integration tests in `backend/MacroCounter.Api.Tests/Auth/AuthEndpointsTests.cs`, using `ApiFactory` and `TestUsers`:
  - `GET /api/auth/session` signed out gives `{state:"signed_out", csrfToken}` and sets `__Host-mc_af`;
  - `POST /api/auth/sign-in` without `X-CSRF-Token` gives 403 `csrf_failed`;
  - the sign-in `Set-Cookie` for `__Host-mc_session` has `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`, with no `Domain`;
  - the full setup over HTTP ends in `state: signed_in` with `user {id, username, role}`;
  - normal sign-in works; a wrong password gives 401 `sign_in_failed` with the exact generic detail;
  - after `POST /api/auth/sign-out` (204), replaying the old cookie on `GET /api/status` gives 401;
  - `POST /api/auth/sign-out-everywhere` revokes a second client's session for the same user;
  - unknown JSON properties give 400, and a body over 4 KB gives 413;
  - `code` not matching `^[0-9]{6}$` gives 400.
- [X] T036 [P] [US1] Write `authMachine` tests in `frontend/tests/unit/auth/authMachine.test.ts`. They cover the pure transitions between the `AuthState` kinds in data-model.md (`loading`, `signed_out`, `setup{step}`, `signed_in{user}`), driven by `SessionState` responses, sign-out, and `session-expired` events. Cover every branch.
- [X] T037 [P] [US1] Write `auth.ts` client tests in `frontend/tests/unit/api/auth.test.ts`:
  - `getSession`, `signIn`, `setupPassword`, `setupTotpStart`, `setupTotpConfirm`, `acknowledgeNotice`, `signOut` and `signOutEverywhere` call the contract paths;
  - responses are validated with zod against `SessionState`;
  - each response's `csrfToken` is passed to `setCsrfToken`;
  - `password_rejected.reasons`, `invalid_code.attemptsLeft` and `rate_limited` are surfaced as typed errors.
- [X] T038 (Touch-target size is measured in the Playwright auth spec (T042); jsdom cannot measure layout.) [P] [US1] Write `SignInScreen` component tests in `frontend/tests/components/SignInScreen.test.tsx`:
  - it shows the fields username, password ("Password or temporary code") and "Authenticator code (leave blank on first sign-in)";
  - the code field has `inputMode="numeric"` and `autocomplete="one-time-code"`;
  - username has `autocomplete="username"` and password has `autocomplete="current-password"`;
  - on failure it shows exactly "Could not sign in. Check your details and try again.";
  - on 429 it shows "Too many attempts. Try again later.";
  - on 503 it shows "Sign-in is temporarily unavailable.";
  - touch targets are ≥ 44 px (class check, as in the existing tests);
  - there is **no** link or button containing "sign up", "register", "create account" or "request" (case-insensitive).
- [X] T039 (Touch-target size is measured in the Playwright auth spec (T042).) [P] [US1] Write `SetupFlow` component tests in `frontend/tests/components/SetupFlow.test.tsx`:
  - the password step shows a reason-specific message for each of `too_short`, `too_long`, `contains_username` and `breached`, and a retry message for `breach_check_unavailable`;
  - the authenticator step renders an `<svg>` QR code (`uqr`), the setup key grouped in 4s, and an "Open in authenticator app" link whose `href` is the `otpauthUri`;
  - a wrong code shows "Code didn't match. N attempts left.";
  - the notice step explains that food text and photos are sent to Claude (Anthropic) and that the owner runs the server, and the button reads "I understand";
  - finishing calls `onSignedIn(user)`;
  - every button, link and input on each step has a touch target of at least 44 px (the same class check as T038).
- [X] T040 [P] [US1] Write `AuthGate` and `SessionExpiredOverlay` component tests in `frontend/tests/components/AuthGate.test.tsx`:
  - while loading, nothing from the app renders;
  - `signed_out` shows `SignInScreen`; `setup` shows `SetupFlow`; `signed_in` renders its children;
  - a `session-expired` event while signed in shows an overlay with `SignInScreen` **on top of** the children, without unmounting them, so an in-progress `ReviewEstimate` draft keeps its state (US1.4 and the edge case);
  - a successful re-sign-in removes the overlay;
  - a `pageshow` event with `persisted = true` re-checks the session.
- [X] T041 [P] [US1] Write `AccountMenu` component tests in `frontend/tests/components/AccountMenu.test.tsx`: it shows the signed-in username; "Sign out" calls `signOut` and then `reload()` (injected); "Sign out everywhere" calls `signOutEverywhere` and then `reload()`.
- [X] T042 [US1] Write an e2e test in `frontend/tests/e2e/auth/first-sign-in.spec.ts` against the real backend. Setup: `scripts/e2e-db.ps1` (T061) invites `e2e-owner` and writes its code to `frontend/tests/e2e/auth/.codes.json`. The test:
  - signs in with the temp code;
  - checks a breached password is rejected (the e2e host uses the fake checker; `Testing:BreachedPasswords` contains `password1234`);
  - sets a strong password;
  - reads the setup key from the page and computes the TOTP code with `frontend/tests/e2e/auth/totp.ts` (`node:crypto` HMAC-SHA1);
  - acknowledges the notice and sees Today;
  - signs out, and sees that pressing Back shows no Today content;
  - signs in again with password + code;
  - sees that the temp code no longer works.

  Also assert SC-001: measured from submitting the sign-in form to Today being visible, a later sign-in takes under 20 s, and setup takes under 30 s excluding the test's own waits. Run it in both the desktop and mobile viewports.

### Implementation for User Story 1

- [X] T043 [P] [US1] Create `backend/MacroCounter.Api/Auth/PasswordPolicy.cs` so that T029 passes.
- [X] T044 [P] [US1] Create `backend/MacroCounter.Api/Auth/BreachedPasswordChecker.cs` (`IBreachedPasswordChecker`, plus an `HttpClient` registered with `AddHttpClient`, a 5-second timeout and `User-Agent: MacroCounter`) so that T030 passes.
- [X] T045 [P] [US1] Create `backend/MacroCounter.Api/Auth/EncryptedUserStore.cs`. It subclasses `UserOnlyStore<AppUser, IdentityDbContext, Guid>`, overrides `GetAuthenticatorKeyAsync`/`SetAuthenticatorKeyAsync` to protect the key with `IDataProtector` purpose `MacroCounter.Totp.v1`, and adds `TryConsumeTotpAsync`. Register it in place of the default store, so that T031 passes.
- [X] T046 [P] [US1] Create `backend/MacroCounter.Api/Auth/PostgresTicketStore.cs` (`ITicketStore`) so that T032 passes. It generates the key with `RandomNumberGenerator.GetBytes(32)` and stores the SHA-256 hash, the ticket protected by `TicketSerializer` plus `IDataProtector`, the `kind` taken from a `session_kind` claim, the user's current `security_stamp` and the absolute expiry. It uses `TimeProvider` for all times.
- [X] T047 [US1] Create `backend/MacroCounter.Api/Auth/SignInService.cs` so that T033 passes.
  - It looks users up by `normalized_username`.
  - It compares the temp code with `CryptographicOperations.FixedTimeEquals` on SHA-256 hashes.
  - It runs a dummy `VerifyHashedPassword` against a static hash on paths that would otherwise skip hashing.
  - It verifies TOTP with `UserManager.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code)` plus `TryConsumeTotpAsync`, and checks the password with `UserManager.CheckPasswordAsync`.
  - It calls `AccessFailedAsync` and `ResetAccessFailedCountAsync` on the lockout counter.
  - It writes the audit events `sign_in` (success/failure with a reason) and `setup_started`.
- [X] T048 [US1] Create `backend/MacroCounter.Api/Auth/SetupService.cs` so that T034 passes. It derives the step from the user row (data-model.md state machine) and uses `PasswordPolicy`, `IBreachedPasswordChecker`, `UserManager.AddPasswordAsync`/`ResetAuthenticatorKeyAsync` and `EncryptedUserStore`.
- [X] T049 [US1] Create `backend/MacroCounter.Api/Auth/AuthEndpoints.cs` with `MapAuthEndpoints(this RouteGroupBuilder api)` for `/auth/session`, `/auth/sign-in`, `/auth/setup/password`, `/auth/setup/totp`, `/auth/setup/totp/confirm`, `/auth/setup/notice`, `/auth/sign-out` and `/auth/sign-out-everywhere`, exactly as in contracts/auth-api.yaml.
  - Use strict JSON (`JsonSerializerOptions` with `UnmappedMemberHandling.Disallow`) and `RequestSizeLimit(4096)`.
  - Sign the user in with `HttpContext.SignInAsync` using claims `sub`, `username`, `role` and `session_kind`.
  - Every response returns a fresh antiforgery request token as `csrfToken`.

  Also in `Program.cs`:
  - `AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(...)` with cookie name `__Host-mc_session`, `HttpOnly`, `SecurePolicy = Always`, `SameSite = Strict`, `SessionStore = PostgresTicketStore`, and `Events.OnRedirectToLogin`/`OnRedirectToAccessDenied` returning `Problems.Unauthenticated` (no redirects);
  - `AddAntiforgery(o => { o.Cookie.Name = "__Host-mc_af"; o.Cookie.SameSite = Strict; o.Cookie.SecurePolicy = Always; o.HeaderName = "X-CSRF-Token"; })`.

  Create `backend/MacroCounter.Api/Security/CsrfEndpointFilter.cs`, which calls `IAntiforgery.ValidateRequestAsync` on every non-GET `/api` endpoint and returns `Problems.CsrfFailed`. Fill in `TestUsers.ActivateAsync` (T025). T035 must pass.
- [X] T050 [US1] Require a full session on the existing endpoints: `.RequireAuthorization()` on `MapEstimateEndpoints` and `/api/status` in `backend/MacroCounter.Api/Endpoints/EstimateEndpoints.cs` and `Program.cs`, plus the `CsrfEndpointFilter`. Update `backend/MacroCounter.Api.Tests/Endpoints/TextEstimateEndpointTests.cs`, `PhotoEstimateEndpointTests.cs` and `StatusEndpointTests.cs` to use `TestUsers.ActivateAsync` and send `X-CSRF-Token`. Add one test per file: no session gives 401 and the `FakeEstimator` records **zero** calls.

  Also write `backend/MacroCounter.Api.Tests/Endpoints/NoIdentityToAnthropicTests.cs` **first** (Tech Constraints: Privacy, "the identity of the requesting user MUST NOT be sent to Anthropic"). It uses `ApiFactory` with the **real** `ClaudeEstimator` over `FakeClaudeSender`, which records the exact request body (`FakeClaudeSender.Body`). Sign in as the user `idcheck-user` and make one text estimate and one photo estimate with a note. Serialize the captured body and its beta headers to text, then assert:
  - none of these appear: the username (any case), the user ID (with and without dashes), the session cookie value, the CSRF token, and the client IP;
  - the body has **no** `metadata` property at all, so even an opaque `metadata.user_id` is ruled out.

  Keep the test green as the estimator changes.
- [X] T051 [P] [US1] Create `frontend/src/api/auth.ts` (zod `SessionStateSchema` from contracts/auth-api.yaml, plus the client functions) so that T037 passes.
- [X] T052 [P] [US1] Create `frontend/src/auth/authMachine.ts` so that T036 passes.
- [X] T053 [P] [US1] Create `frontend/src/auth/SignInScreen.tsx` so that T038 passes. Use the existing `FormBits` components and styles; the layout must be usable at 360 px.
- [X] T054 [P] [US1] Create `frontend/src/auth/SetupFlow.tsx` (password → authenticator → notice; QR with `renderSVG` from `uqr`, inserted as markup that `uqr` generates from the URI only) so that T039 passes.
- [X] T055 [US1] Create `frontend/src/auth/AuthGate.tsx` and `frontend/src/auth/SessionExpiredOverlay.tsx` so that T040 passes. Add the injectable `auth` client and `reload` to `Services` in `frontend/src/app/services.tsx`, and add fakes to `frontend/tests/components/testServices.tsx`.
- [X] T056 [P] [US1] Create `frontend/src/auth/AccountMenu.tsx` so that T041 passes, and add an "Account" entry to `frontend/src/App.tsx` (a new `View` `'account'`, titled "Account").
- [X] T057 [US1] Update `frontend/src/main.tsx` to render `<AuthGate>` around `<App/>`. The services are built after the gate resolves; the database is still the existing `macro-counter` until US4. Sign-out calls `location.replace('/')`.
- [X] T058 (offline.spec.ts needs the remembered active account from US4 to launch offline; it is updated in T088.) [US1] Update `frontend/tests/e2e/helpers.ts` so that `mockApi` also fulfils `GET /api/auth/session` with `{state:"signed_in", csrfToken:"test", user:{id:"00000000-0000-4000-8000-000000000001", username:"tester", role:"user"}}`. Every existing mocked e2e spec (`log-text`, `log-photo`, `recent`, `goal`, `totals-persistence`, `touch-targets`) must stay green. Mock the session in `offline.spec.ts` the same way. Use `role: "user"` deliberately: an owner role would trigger legacy adoption (US4) in these mocked specs.
- [X] T059 [US1] Write tests in `backend/MacroCounter.Api.Tests/Security/TestingSwitchTests.cs`. With `Testing:FakeEstimator=true`, the registered `IEstimator` is the canned fake **only** when the environment is `Testing`; in the Development and Production environments, the real or unavailable estimator is registered and the switch is ignored. The same holds for `Testing:BreachedPasswords`, which only replaces `IBreachedPasswordChecker` in Testing.
- [X] T060 [US1] Implement the Testing-only switches in `backend/MacroCounter.Api/Program.cs`: when `Environment == "Testing"` **and** `Testing:FakeEstimator=true`, register a canned `IEstimator` that returns one banana item; when `Testing:BreachedPasswords` is set in Testing, register a list-based `IBreachedPasswordChecker`. Make T059 pass.
- [X] T061 [US1] Create `scripts/e2e-db.ps1`. It drops and recreates `macro_e2e` plus the role `macro_app_e2e`, applies the migrations and grants, invites `e2e-owner` (owner) and `e2e-friend` (user), and writes `{ "e2e-owner": "<code>", "e2e-friend": "<code>" }` to `frontend/tests/e2e/auth/.codes.json`. Add that file to `frontend/.gitignore`.
- [X] T062 (Done with baseURL http://localhost:5173: the Vite dev server proxies /api to the backend, so nothing must be built first, because Playwright starts web servers in parallel. The database is reset once per run from playwright.config.ts with a stable role password and Pooling=false. Each spec invites its own users through tests/e2e/auth/db.ts so the desktop and mobile projects never collide.) [US1] Add a Playwright project `auth` to `frontend/playwright.config.ts` (`testDir: tests/e2e/auth`, `baseURL: http://localhost:5080`, `workers: 1`, plus a desktop and a mobile viewport variant). Add a `webServer` entry that runs `npm run build && dotnet run --project ../backend/MacroCounter.Api --no-launch-profile` with `ASPNETCORE_ENVIRONMENT=Testing`, `ASPNETCORE_URLS=http://localhost:5080`, `ConnectionStrings__Identity` set to the `macro_e2e` app connection, `Testing__FakeEstimator=true` and `Testing__BreachedPasswords__0=password1234`. Exclude `tests/e2e/auth/**` from the existing projects. Make T042 pass.

**Checkpoint**: US1 works on its own. Quickstart V1, V2, V4.1 and V10 pass, the AI endpoints
refuse anonymous callers, and all earlier 001 tests are green.

---

## Phase 4: User Story 2 - Invite-only access with no sign-up (Priority: P1)

**Goal**: Only owner-provisioned accounts exist. The owner invites, resets, disables, enables,
unlocks and revokes accounts with SQL procedures. The app cannot create accounts, even if it is
compromised.

**Independent Test**: No sign-up UI or route exists. `invite_user` → the person can sign in.
`disable_user` → their live session fails on the next request. `reset_user` → setup is forced
again. As `macro_app`, `insert into macro.users` is denied. Quickstart V5, V12.5.

### Tests for User Story 2 ⚠️

- [X] T063 [P] [US2] Write owner procedure tests in `backend/MacroCounter.Api.Tests/Database/OwnerProceduresTests.cs`, run on the **admin** connection, following contracts/owner-procedures.md:
  - `reset_user`: clears `password_hash`, the authenticator token, `two_factor_enabled` and the replay fields; sets a new hash and deadline; rotates the stamp; deletes all sessions; clears the lockout; keeps `ai_notice_ack_at` and `role`; writes `account_reset`;
  - `disable_user` and `enable_user`: correct fields, sessions deleted on disable, and their audit rows;
  - `unlock_user`: clears `lockout_end` and `access_failed_count`;
  - `revoke_sessions`: returns the number of sessions removed and rotates the stamp;
  - an unknown username raises `no such user: <name>`;
  - each procedure writes exactly one audit row with `actor='owner'`;
  - on the **app** connection, executing any of these procedures fails with 42501.

  (`invite_user` is tested in Phase 2, T014.)
- [X] T064 [P] [US2] Write `users_overview` and `ai_usage_today` view tests in `backend/MacroCounter.Api.Tests/Database/OwnerViewsTests.cs`. The `state` column is `invited`, `setup`, `active`, `expired`, `disabled` or `incomplete`, following the data-model.md state machine (one fixture row per state). `active_sessions` counts only unexpired sessions. On the **app** connection, `select` from either view fails with 42501.
- [X] T065 [US2] Write lifecycle integration tests in `backend/MacroCounter.Api.Tests/Auth/AccountLifecycleTests.cs`:
  - an activated client makes a successful request; then `disable_user` runs; the **next** request gives 401 (SC-005: immediate); sign-in now gives the generic 401;
  - `enable_user` makes sign-in work again;
  - after `reset_user`, the old password plus code gives the generic 401, and the new temp code gives `setup`;
  - an invite older than 72 h (using `FakeTimeProvider` and a `setup_expires_at` in the past) is refused with audit reason `setup_expired`.
- [X] T066 [P] [US2] Write a no-sign-up route test in `backend/MacroCounter.Api.Tests/Security/NoSignUpRouteTests.cs` (SC-004). Using `EndpointDataSource`, check that no route pattern matches `(?i)register|sign-?up|create-?account|invite|/users` (ignoring the static-file fallback), and that `POST` to `/api/auth/register`, `/api/register`, `/api/users` and `/api/auth/sign-up` returns 401 or 404, never 2xx.
- [X] T067 [US2] Write an e2e test in `frontend/tests/e2e/auth/disable.spec.ts`. As `e2e-friend`, complete setup; the test then calls `macro_admin.disable_user('e2e-friend')` through a helper `frontend/tests/e2e/auth/db.ts`, which uses `psql` with `MACROCOUNTER_TEST_PG` against `macro_e2e`. Attempt an AI lookup: the **sign-in screen appears, with no crash and no console errors**. Re-enable the account afterwards.

### Implementation for User Story 2

- [X] T068 [US2] Add a migration `Data/Migrations/*_OwnerProcedures.cs` with `macro_admin.reset_user`, `disable_user`, `enable_user`, `unlock_user` and `revoke_sessions`, and the views `macro_admin.users_overview` and `macro_admin.ai_usage_today`, exactly as specified in contracts/owner-procedures.md and data-model.md. All are `security invoker` with `set search_path = macro, extensions, public, pg_temp`, owned by the migration owner, and have `revoke execute … from public`. Make T063, T064, T065, T066 and T067 pass, adjusting `PostgresTicketStore` (T046) and `SignInService` (T047) for `disabled_at`, stamp changes and `setup_expires_at` where T065 needs it. If T066 fails, remove or rename the offending route; never weaken the test.

**Checkpoint**: Quickstart V5 passes. Owner tasks each take under 5 minutes using the runbook in
contracts/owner-procedures.md.

---

## Phase 5: User Story 3 - Every server feature is protected by default (Priority: P1)

**Goal**: Deny by default. Every endpoint needs a full session unless it is explicitly public
(`/health`, `/auth/session`, `/auth/sign-in`), setup-only, or any-session. No endpoint takes a
user ID, so cross-user access cannot be expressed.

**Independent Test**: The endpoint inventory test checks every endpoint without credentials,
with an expired session, with a revoked session, with a disabled user's session, and with the
wrong session kind. Quickstart V6.

### Tests for User Story 3 ⚠️

- [X] T069 [P] [US3] Write an endpoint inventory test in `backend/MacroCounter.Api.Tests/Security/EndpointInventoryTests.cs` (SC-003):
  - read `specs/003-auth-security-foundations/contracts/auth-api.yaml` (located relative to the repo root) and extract each `path`, method and `x-access` value with a simple line-based parser; there is no YAML package (Principle V). A path with no `x-access` means `full`;
  - enumerate `EndpointDataSource` for `/api/*` routes;
  - assert the two sets are equal;
  - assert each endpoint's metadata matches its declared access: `public` has `AllowAnonymous`; `setup` uses the `SetupSession` policy; `any-session` uses `AnySession`; `full` uses the fallback/`FullSession` policy.
- [X] T070 [US3] Write access-matrix tests in `backend/MacroCounter.Api.Tests/Security/AccessMatrixTests.cs`. A theory over every non-public endpoint from T069 × these credentials: none, an expired full session (FakeTimeProvider + 7 d), an idle full session (+24 h), a signed-out cookie, a revoked session (`revoke_sessions`), a disabled user, a setup session on a `full` endpoint, and a full session on a `setup` endpoint. Expect 401 (or 409 `wrong_setup_step`/403 where the contract says so), never 2xx. For `/estimates/*`, also assert zero `FakeEstimator` calls and zero `ai_usage_daily` rows (US3.1).
- [X] T071 [P] [US3] Write cross-user tests in `backend/MacroCounter.Api.Tests/Security/CrossUserTests.cs` with users A and B both active:
  - A's `sign-out-everywhere` does not end B's session;
  - A's estimate requests increment only A's `ai_usage_daily` row;
  - sending `userId`, `user_id` or `sub` in any JSON body or query is either rejected (400 for unknown JSON properties) or ignored, and never changes whose data is touched;
  - B's session cookie together with A's CSRF token gives 403.
- [X] T072 [P] [US3] Write health/status tests in `backend/MacroCounter.Api.Tests/Endpoints/HealthEndpointTests.cs`: `GET /api/health` returns 200 with exactly `{"status":"ok"}` (no other properties, no version, no AI flag) whether or not an API key is configured; `GET /api/status` without a session returns 401.
- [X] T073 [P] [US3] Write static-file access tests in `backend/MacroCounter.Api.Tests/Security/StaticAccessTests.cs`: `/`, `/index.html` and an asset under `/assets/` are served without a session (the app shell is public); `/api/unknown` without a session returns 401, not the SPA fallback.

### Implementation for User Story 3

- [X] T074 [US3] Create `backend/MacroCounter.Api/Auth/AccessPolicies.cs` with three policies:
  - `FullSession`: authenticated with claim `session_kind=full`; it is also the `FallbackPolicy`;
  - `SetupSession`: claim `session_kind=setup`;
  - `AnySession`: authenticated.

  In `Program.cs`, set `AddAuthorization(o => o.FallbackPolicy = FullSession)`, add `UseAuthentication()`/`UseAuthorization()` after `UseStaticFiles()`, and mark `MapFallbackToFile` with `.AllowAnonymous()` but restricted to non-`/api` paths, so `/api/*` never falls back to `index.html`. Make T070 and T073 pass.
- [X] T075 [US3] In `backend/MacroCounter.Api/Auth/AuthEndpoints.cs`, mark `/auth/session` and `/auth/sign-in` with `.AllowAnonymous()`; the setup endpoints with `.RequireAuthorization("SetupSession")`; `/auth/sign-out` with `"AnySession"`. Remove any explicit `RequireAuthorization()` that now duplicates the fallback. Make T069 and T071 pass. Every endpoint must read the user only from `HttpContext.User` (`sub` claim), never from a body, route or query value.
- [X] T076 [US3] Add `GET /api/health` (`.AllowAnonymous()`, returning `{ status = "ok" }`) to `backend/MacroCounter.Api/Program.cs`, keeping `/api/status` on the fallback policy, so that T072 passes. Check that `frontend/src/api/status.ts` treats a 401 as `aiAvailable: false` without crashing, and add a test case to `frontend/tests/unit/api/status.test.ts`.

**Checkpoint**: Every server feature is protected by default and the inventory test guards
future endpoints.

---

## Phase 6: User Story 4 - Private data per person on a shared browser (Priority: P2)

**Goal**: Each account has its own IndexedDB. Sign-out locks the data without deleting it.
Offline and server-outage launches reopen the last active account. The pre-feature data is
adopted once, by the owner only.

**Independent Test**: A logs food and signs out; B sees nothing; A signs back in and everything is
there. The owner adopts the legacy data and a regular user never does. Quickstart V7, V8, V9.

### Tests for User Story 4 ⚠️

- [X] T077 [P] [US4] Write `DeviceRepository` tests in `frontend/tests/unit/data/deviceRepository.test.ts`, using fake-indexeddb:
  - the database `macro-counter-device` has store `device` and `schemaVersion` 1, and goes through `runMigrations`;
  - `getActiveAccount()` returns undefined when nothing is stored;
  - `setActiveAccount({userId, username, role})` stores `updatedAt` as an ISO string;
  - `clearActiveAccount()` removes it;
  - `isLegacyAdopted()` / `markLegacyAdopted()` work;
  - a `userId` that is not a UUID is rejected (zod).
- [X] T078 [P] [US4] Write per-user database tests in `frontend/tests/unit/data/db.test.ts`: `userDbName(userId)` returns `macro-counter.u.<userId>`; it rejects anything that is not a UUID; two users' databases are separate (an entry created in A is not listed in B); the existing schema migrations run for a new per-user database.
- [X] T079 [P] [US4] Write legacy adoption tests in `frontend/tests/unit/data/legacyAdoption.test.ts`:
  - with role `user`, nothing is copied, the legacy database stays and the flag stays unset;
  - with role `owner` and a legacy database of 3 entries, 2 saved foods and 1 goal, every record is copied with `id`, `createdAt` and `updatedAt` unchanged, then the legacy database is deleted and the flag is set;
  - running it a second time does nothing;
  - with no legacy database, the flag is set and nothing else happens;
  - if a copy fails (fault-injecting repository), the legacy database is **not** deleted and the flag stays unset;
  - if the target ends up with fewer records than the source, nothing is deleted.
- [X] T080 [P] [US4] Extend `frontend/tests/components/AuthGate.test.tsx` with launch tests:
  - online and signed in: the active account is written and services open `macro-counter.u.<id>`;
  - online and signed out: no user database is opened;
  - `getSession` fails with `network`, or 503 `service_unavailable`, while an active account exists: the app renders in `offline` state using that account's database, with the banner "Offline – sign in or reconnect to use AI lookup";
  - the same failure with no active account shows sign-in with "Sign-in is temporarily unavailable.";
  - sign-out clears the active account, keeps the database and calls `reload`.
- [X] T081 (Uses two freshly invited accounts per project; only the legacy-adoption spec needs the single seeded owner, which it resets first.) [US4] Write an e2e test in `frontend/tests/e2e/auth/two-accounts.spec.ts` (SC-007, project `auth`). On one browser context:
  - `e2e-owner` logs 2 entries and sets a protein goal, then signs out;
  - `e2e-friend` signs in (completing setup if needed) and sees an empty Today, no recent foods and no goal; logs 1 entry; signs out;
  - `e2e-owner` signs back in and sees exactly their 2 entries and the goal, and not the friend's entry.
- [X] T082 [US4] Write an e2e test in `frontend/tests/e2e/auth/legacy-adoption.spec.ts`. Seed a pre-feature `macro-counter` IndexedDB in the page with `page.evaluate` (2 entries). Sign in as `e2e-friend`: nothing is adopted. Sign out. Sign in as `e2e-owner`: the 2 entries appear and the legacy database no longer exists (`indexedDB.databases()`). Sign out and back in: there are no duplicates.

### Implementation for User Story 4

- [X] T083 [P] [US4] Create `frontend/src/data/deviceRepository.ts` (`DeviceRepository` interface in `frontend/src/data/repositories.ts`, plus an IndexedDB implementation with its own migration list) so that T077 passes.
- [X] T084 [P] [US4] Add `userDbName(userId)` and `openUserDb(userId)` to `frontend/src/data/db.ts`, reusing `openDb(name)`, so that T078 passes. Keep `DB_NAME` exported as the legacy name.
- [X] T085 [US4] Create `frontend/src/data/legacyAdoption.ts` (`adoptLegacyData({ role, userId, device, openLegacy, openTarget, deleteLegacy })`) so that T079 passes. Copy each store in a single read-write transaction on the target and verify the counts before deleting.
- [X] T086 (Before sign-in the data repositories are a locked placeholder (src/data/lockedData.ts) that refuses every call; AuthGate opens the account's own database and provides memoized services, so effects don't re-run on every gate render.) [US4] Update `frontend/src/auth/AuthGate.tsx` and `frontend/src/main.tsx` for per-user services:
  - after `signed_in`, call `setActiveAccount`, run `adoptLegacyData`, then build `Services` from `openUserDb(user.id)`;
  - if the session check fails with `network` or `service_unavailable` and there is an active account, use the `offline` state with that account's database;
  - on sign-out, close the database, call `clearActiveAccount`, then `reload`.

  Make T080–T082 pass.
- [X] T087 (Tests are in frontend/tests/components/AddFood.test.tsx: the entry mode is chosen in AddFood, not AddFoodText.) [US4] Write component tests in `frontend/tests/components/AddFoodText.test.tsx`. When `Services.aiBlockedReason` is `'offline'`, AI lookup is disabled and shows "Sign in or reconnect to use AI lookup", and manual entry is visible and logs an entry. When it is `undefined`, behavior is unchanged.
- [X] T088 [US4] Add `aiBlockedReason` (`'offline' | 'signed_out' | undefined`) to `Services` in `frontend/src/app/services.tsx`, set it from `AuthGate`, and use it in `frontend/src/features/add-food/AddFood.tsx` and `useEstimateFlow.ts`. Make T087 pass.
- [X] T089 [US4] Update `frontend/tests/e2e/offline.spec.ts` so the offline launch keeps working with an active account. Seed the device database in the page first, then go offline and reload: Today shows the account's data and manual logging works (quickstart V9.1).

**Checkpoint**: Two people on one browser never see each other's data, and the owner's old data
survives.

---

## Phase 7: User Story 5 - Brute-force and cost abuse protection (Priority: P2)

**Goal**: Sign-in has three uniform throttling layers. AI lookups have a per-user burst limit and
daily, global daily and global monthly ceilings, reserved in the database before Claude is called.
Manual entry is never blocked.

**Independent Test**: After 10 failures, a correct sign-in is refused with "try again later", the
same as for an unknown name. The 31st lookup of the day gives `quota_exceeded`, and manual entry
still works. Quickstart V3, V11.

### Tests for User Story 5 ⚠️

- [X] T090 [P] [US5] Write `SignInThrottle` tests in `backend/MacroCounter.Api.Tests/Auth/SignInThrottleTests.cs`, using `FakeTimeProvider`:
  - a sliding window keyed by normalized username: 10 failures within 15 minutes gives `IsBlocked = true` with `RetryAfter`;
  - the 11th call is blocked even after a success is recorded for a different name;
  - failures older than 15 minutes expire;
  - an unknown username behaves exactly the same;
  - `RecordSuccess` clears the key;
  - memory is bounded: entries are evicted after 15 minutes of no activity.
- [X] T091 [US5] Write sign-in limit integration tests in `backend/MacroCounter.Api.Tests/Auth/SignInLimitTests.cs` (SC-006):
  - after 10 wrong passwords for `alice`, the correct password + code gives 429 `rate_limited` with a `Retry-After` header;
  - the same 10 failures for `nobody` give a **byte-identical** problem body (compare JSON without `traceId`), and the same status and headers apart from `Retry-After` values;
  - after the 15-minute window passes (FakeTimeProvider) and `unlock_user` runs, sign-in succeeds;
  - Identity's persisted lockout: after a restart (a new `ApiFactory` on the same database) with `lockout_end` still in the future, a correct sign-in gives the same 429;
  - per IP: 21 attempts from one `X-Forwarded-For` IP across different usernames, within 15 minutes, gives 429 on the 21st;
  - the `sign_in_locked` and `rate_limited` audit rows are written.
- [X] T092 [P] [US5] Write `AiQuotaService` tests in `backend/MacroCounter.Api.Tests/Usage/AiQuotaServiceTests.cs`, using `FakeTimeProvider` and limits from options:
  - `TryReserveAsync(userId)` succeeds 30 times and the 31st gives `Exceeded(user_daily, resetAt = next 00:00Z)`;
  - with `GlobalDaily = 3` and three users, the 4th reservation overall gives `global_daily`, and `ai_usage_global_daily.ceiling_hit_at` is set;
  - with `GlobalMonthly = 5` and days spread across one month, the reservation gives `global_monthly` with `resetAt` on the 1st of next month at 00:00Z;
  - a reservation that fails a later check rolls back the earlier increments, so counts are unchanged;
  - concurrency: 50 parallel `TryReserveAsync` calls for one user with a limit of 30 give exactly 30 successes and `count = 30` in the database;
  - the UTC day boundary at 23:59:59Z / 00:00:00Z starts a new day;
  - `quota_exceeded` and `ceiling_hit` audit rows are written with the matching reason.
- [X] T093 [US5] Write estimate quota integration tests in `backend/MacroCounter.Api.Tests/Endpoints/EstimateQuotaTests.cs`:
  - when the quota is exceeded, `POST /api/estimates/text` gives 429 `quota_exceeded` with `scope` and `resetAt` in the body, and the `FakeEstimator` records **no** call;
  - an estimator failure (`AiUnavailableException`) still uses up the reservation (no refund, R8);
  - the burst limiter: a 7th request within one minute from the same user gives 429 `rate_limited`, and a second user is unaffected;
  - the same checks apply to `/estimates/photo`.
- [X] T094 [P] [US5] Write frontend quota handling tests in `frontend/tests/unit/api/estimates.test.ts` and `frontend/tests/components/AddFoodText.test.tsx`:
  - `quota_exceeded` with `scope: user_daily` shows "You've reached today's AI lookup limit. It resets at <local time, e.g. 5:00 PM>. You can still add food manually.";
  - `global_daily` and `global_monthly` show "AI lookup has reached its overall limit for now. It resets at <local date/time>. You can still add food manually.";
  - `rate_limited` shows "Too many lookups in a short time. Wait a minute and try again.";
  - in every case the manual-entry button is visible and works (FR-022).
- [X] T095 (Done with its own Vite dev server on 5174 proxying to a second backend on E2E_API_PORT+1, because Playwright starts web servers in parallel. The backend is built once in the config's setup step and both backends use `dotnet run --no-build`.) [US5] Write an e2e test in `frontend/tests/e2e/auth-quota/quota.spec.ts` in a **dedicated Playwright project `auth-quota`** (`testDir: tests/e2e/auth-quota`, `baseURL: http://localhost:5081`, `workers: 1`). Its own `webServer` entry runs the same backend command as the `auth` project, on `ASPNETCORE_URLS=http://localhost:5081` with `Limits__Ai__PerUserDaily=2`, against the same `macro_e2e` database. Exclude `tests/e2e/auth-quota/**` from the other projects. Make 3 text lookups as `e2e-owner`: the 3rd shows the daily-limit message, and adding the food manually logs it to Today.

### Implementation for User Story 5

- [X] T096 [P] [US5] Write tests in `backend/MacroCounter.Api.Tests/Usage/SpendCapTests.cs` (research R8):
  - `LimitsOptions` binds `Limits:Ai:WorstCaseCostPerRequestUsd` (default `0.35`);
  - `SpendCap.MonthlyWorstCaseUsd` = `GlobalMonthly × WorstCaseCostPerRequestUsd` (3,000 × 0.35 = 1,050) and `DailyWorstCaseUsd` = `GlobalDaily × WorstCaseCostPerRequestUsd` (200 × 0.35 = 70);
  - at startup one Information log line states both values and the configured model, with no key;
  - startup fails if any limit is ≤ 0 or `WorstCaseCostPerRequestUsd` is ≤ 0.
- [X] T097 [P] [US5] Create `backend/MacroCounter.Api/Auth/SignInThrottle.cs` (a singleton using `TimeProvider` and a `ConcurrentDictionary` of timestamp queues, swept periodically) so that T090 passes.
- [X] T098 [US5] In `Program.cs`:
  - add `AddRateLimiter` with a partitioned fixed-window policy `"sign-in"`, keyed by `HttpContext.Connection.RemoteIpAddress` (20 per 15 minutes, no queue);
  - set `OnRejected` to write `Problems.RateLimited` plus a `rate_limited` audit row;
  - apply it to `/auth/sign-in` and all `/auth/setup/*` endpoints;
  - add `UseForwardedHeaders` with `ForwardedHeaders.XForwardedFor | XForwardedProto` and `ForwardLimit = 1`, before rate limiting. In Testing, trust the loopback test server.

  Integrate `SignInThrottle` and the Identity lockout into `SignInService` so that every block returns the identical `Problems.RateLimited`. Make T091 pass.
- [X] T099 [P] [US5] Create `backend/MacroCounter.Api/Usage/AiQuotaService.cs`. `TryReserveAsync(Guid userId, CancellationToken)` runs in one `ReadCommitted` transaction:
  1. `insert … on conflict (day) do nothing` for the global row, then `select … for update` on it;
  2. check `count < GlobalDaily` and `sum(count) for the month < GlobalMonthly`;
  3. `insert into ai_usage_daily … on conflict (user_id, day) do update set count = ai_usage_daily.count + 1 where ai_usage_daily.count < @limit returning count`;
  4. increment the global row;
  5. commit, or roll back and return `Exceeded(scope, resetAt)`.

  It writes the audit rows. T092 must pass.
- [X] T100 [US5] Create `backend/MacroCounter.Api/Usage/AiLimitsEndpointFilter.cs`, applied to `/estimates/text` and `/estimates/photo` in `EstimateEndpoints.cs`. It runs the per-user token bucket (a `"ai-burst"` rate-limiter policy partitioned by the `sub` claim, 6 per minute) and then `AiQuotaService.TryReserveAsync` **before** the handler, returning `Problems.QuotaExceeded` or `Problems.RateLimited`. Make T093 pass.
- [X] T101 [US5] Create `backend/MacroCounter.Api/Usage/SpendCap.cs`, add `WorstCaseCostPerRequestUsd` to `backend/MacroCounter.Api/Usage/LimitsOptions.cs` and `appsettings.json`, and log the computed caps at startup in `Program.cs`. Make T096 pass.
- [X] T102 [US5] Add the `quota_exceeded` and `rate_limited` codes, with `scope`/`resetAt` parsing, to `frontend/src/api/estimates.ts`, and render the messages (local time via `Intl.DateTimeFormat`) in `frontend/src/features/add-food/AddFood.tsx` so that T094 and T095 pass.

**Checkpoint**: Guessing passwords is slowed uniformly and the AI bill has a hard ceiling.

---

## Phase 8: User Story 6 - Security audit trail and owner visibility (Priority: P3)

**Goal**: Every FR-024 event is recorded with time, account (if known) and outcome. There are
never secrets or food content. The owner can review it, and only the owner can purge it.

**Independent Test**: A scripted run produces every event type, and a scan finds no secrets or
food text in the audit table or in the captured logs. Quickstart V13.

### Tests for User Story 6 ⚠️

- [X] T103 [US6] Write an audit coverage test in `backend/MacroCounter.Api.Tests/Audit/AuditCoverageTests.cs` (SC-009). One scripted scenario: invite, a failed sign-in, setup (including a rejected password, a breached password, a wrong TOTP code and the notice), sign-in, a lockout, the IP rate limit, sign-out, sign-out-everywhere, `revoke_sessions`, `disable_user`, `enable_user`, `unlock_user`, `reset_user`, quota exceeded and the ceiling hit. Assert that **every** value of the `AuditEvent` enum appears at least once, with `occurred_at`, the right `user_id` (null only when the account is unknown) and an `outcome`.
- [X] T104 [US6] Write an audit and log secret scan in `backend/MacroCounter.Api.Tests/Audit/SecretScanTests.cs`. Run the T103 scenario with an `ILoggerProvider` that captures every log message and exception. Then read the whole `audit_events` table as a text dump (`select row_to_json(a)::text`) and assert that **none** of these appear in the dump or in the captured logs:
  - every password used;
  - every temporary code (with and without dashes);
  - every TOTP code and setup key;
  - the session cookie values and CSRF tokens;
  - the food descriptions sent to `/estimates/text` (`"2 scrambled eggs"`) and photo notes;
  - the bytes of the photo, as base64.

  Unknown usernames that were typed in (`"Pa55word!not-a-user"`) must also be absent (data-model.md rule).
- [X] T105 [P] [US6] Write tests for the `recent_audit` view and `purge_expired` in `backend/MacroCounter.Api.Tests/Database/AuditRetentionTests.cs`:
  - `macro_admin.recent_audit` returns the last 30 days, newest first, joined to `username`;
  - `macro_admin.purge_expired()` deletes audit rows older than 180 days, sessions past `absolute_expires_at`, and `ai_usage_*` rows older than 400 days, keeps everything else, and returns the number of rows removed;
  - the app role cannot execute `purge_expired` (42501).

### Implementation for User Story 6

- [X] T106 (No change needed: T103 passed on its first run, so every event type was already written.) [US6] Add the missing audit writes found by T103 in `SignInService`, `SetupService`, `AuthEndpoints` (sign-out, sign-out-everywhere), the rate-limiter `OnRejected` handler and `AiQuotaService`, all in their existing files. Make T103 pass.
- [X] T107 (No leak found, even with logging at Trace. EF command logging is pinned to Warning, and EnableSensitiveDataLogging is never called.) [US6] Fix any leak found by T104. Check `backend/MacroCounter.Api/Ai/ClaudeEstimator.cs` logging (`LogWarning(ex, "Claude returned HTTP {Status}: {Message}")`) and drop `ex.Message` if it can echo request content. Set `Microsoft.EntityFrameworkCore.Database.Command` logging to Warning in `appsettings.json`, so SQL parameters are never logged, and confirm `EnableSensitiveDataLogging` is **never** called. Make T104 pass.
- [X] T108 [US6] Add a migration `Data/Migrations/*_AuditRetention.cs` with the `macro_admin.recent_audit` view and `macro_admin.purge_expired()`. Also add a guarded `pg_cron` schedule: `do $$ begin if exists (select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('macro-purge', '15 3 * * *', 'select macro_admin.purge_expired()'); end if; end $$`. Make T105 pass.

**Checkpoint**: The owner can answer "who signed in, who failed, who got locked, who hit limits"
from the SQL editor.

---

## Phase 9: User Story 7 - Hardened delivery to the browser (Priority: P3)

**Goal**: HTTPS only with HSTS, the strict header set, origin allowlisting, a real `AllowedHosts`,
generic production errors and no `Server` header.

**Independent Test**: Header and origin integration tests pass in the Production environment.
The built app runs under the CSP with zero violations. Quickstart V12 passes on the deployed host.

### Tests for User Story 7 ⚠️

- [X] T109 (A missing asset returns 401, not 404: no endpoint matches it, so deny-by-default applies.) [P] [US7] Write security header tests in `backend/MacroCounter.Api.Tests/Security/SecurityHeadersTests.cs`. Check every header and value in contracts/http-hardening.md on `/`, `/index.html`, a static asset, `/api/health`, a 401 API response and a 404:
  - `Cache-Control: no-store` on `/api/*` and `index.html`, but not on `/assets/*`;
  - no `Server` header, no `X-Powered-By`, no `Access-Control-Allow-*`;
  - in Development, the CSP has no `upgrade-insecure-requests` and `connect-src` includes `ws://localhost:5173`;
  - in Production, the CSP is exactly the contract string.
- [X] T110 [P] [US7] Write origin check tests in `backend/MacroCounter.Api.Tests/Security/OriginCheckTests.cs`:
  - `POST /api/auth/sign-in` with `Origin: https://evil.example` gives 403 `csrf_failed`, even with a valid CSRF token;
  - with no `Origin` and `Sec-Fetch-Site: cross-site`, it gives 403;
  - with no `Origin` and no `Sec-Fetch-Site` (a non-browser client), it is allowed through to CSRF validation;
  - an allowed origin passes;
  - GET requests are never origin-blocked.
- [X] T111 [P] [US7] Write production configuration tests in `backend/MacroCounter.Api.Tests/Security/ProductionConfigTests.cs`, using `ApiFactory` in the Production environment with `AllowedHosts=app.example`, a test Data Protection certificate generated in the test, and `Security:AllowedOrigins:0=https://app.example`:
  - an HTTPS request carries `Strict-Transport-Security: max-age=31536000; includeSubDomains`;
  - an HTTP request redirects to HTTPS (308);
  - `Host: other.example` gives 400;
  - an endpoint that throws (a test-only endpoint mapped through `ConfigureTestServices`) gives a 500 problem+json with no stack trace, exception type name, `at ` frames or file paths;
  - startup fails with a clear error if `ConnectionStrings:Identity` or the Data Protection certificate is missing, or if `AllowedHosts` is `*`.
- [X] T112 [US7] Write an e2e CSP test in `frontend/tests/e2e/auth/csp.spec.ts` (project `auth`, served by the backend from the production build). Collect `securitypolicyviolation` events and console errors while doing sign-in, setup (with the QR code), a text estimate with the fake estimator, the photo picker preview (blob image) and service worker registration. Assert **zero** violations.

### Implementation for User Story 7

- [X] T113 [P] [US7] Create `backend/MacroCounter.Api/Security/SecurityHeadersMiddleware.cs` with the header set from contracts/http-hardening.md (the CSP differs by environment) and `Cache-Control: no-store` for `/api/*` and `index.html` (through `StaticFileOptions.OnPrepareResponse` and the fallback). Set `builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false)`. Make T109 pass.
- [X] T114 [P] [US7] Create `backend/MacroCounter.Api/Security/OriginCheckMiddleware.cs` (unsafe methods on `/api/*` only; allowlist from `SecurityOptions.AllowedOrigins`) and register it before authentication, so that T110 passes.
- [X] T115 (Also fixed: the localhost origins moved from appsettings.json to appsettings.Development.json and appsettings.Testing.json. .NET merges arrays by index, so Production had inherited them.) [US7] Add Production hardening to `Program.cs`:
  - `UseHsts()` with `MaxAge = 365 days` and `IncludeSubDomains = true`, plus `UseHttpsRedirection()` with status 308, both Production only;
  - a startup check that throws if `AllowedHosts` is `*` or empty, or if `Security:AllowedOrigins` is empty;
  - `UseExceptionHandler` with ProblemDetails customised to drop `exception` details, and no developer exception page outside Development.

  Make T111 pass.
- [X] T116 (The one violation was Zod 4 probing for `new Function` (script-src eval). Fixed with `z.config({ jitless: true })` in src/zodConfig.ts, imported first in main.tsx. No 'unsafe-inline' or 'unsafe-eval' added.) [US7] If T112 finds violations, fix them at the source; never add `'unsafe-inline'`. For example, set `vite-plugin-pwa`'s `injectRegister: 'script'` in `frontend/vite.config.ts` if it inlines anything, or move inline styles into `frontend/src/styles.css`. Make T112 pass.

**Checkpoint**: All hardening checks pass in the Production environment configuration.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Supply chain, docs, deployment, and the governance gates

- [X] T117 (The secret-scan pattern uses … so the script stays ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 scripts as ANSI. On a Windows checkout with core.autocrlf=true, `dotnet format` reports line endings for every file, including older ones; CI on Linux is the authoritative gate.) Update `scripts/check.ps1`:
  - run `dotnet restore backend --locked-mode` first;
  - add `dotnet list backend package --vulnerable --include-transitive` and fail if its output contains `High` or `Critical`;
  - add `npm --prefix frontend audit --audit-level=high`;
  - run `scripts/e2e-db.ps1` before the e2e step, and include the `auth` Playwright project;
  - fail early with a clear message if `MACROCOUNTER_TEST_PG` is unset;
  - add a **secret scan** step (FR-030) that fails if any git-tracked file, or any file in the built `backend/MacroCounter.Api/wwwroot/`, matches `sk-ant-[A-Za-z0-9_-]{20,}`, `Password=[^;"'<\s]{4,}`, `-----BEGIN (RSA |EC )?PRIVATE KEY-----` or `"ApiKey"\s*:\s*"[^"]+"`. The public CA `.crt` (T118) and documented placeholders such as `Password=<pw>` are allowlisted by exact path or pattern.

  Run it and fix or risk-accept any high or critical finding in writing in plan.md (Constitution VII).
- [X] T118 (Supabase Root 2021 CA, valid until 2031-04-26, committed as `certs/supabase-root-ca.crt` and copied to the build output.) [P] Add the Supabase root CA as `backend/MacroCounter.Api/certs/supabase-root-ca.crt`. **Ask the user** to download it from Supabase Dashboard → Database Settings → SSL; it is public, not a secret. Copy it to the output in `MacroCounter.Api.csproj`, and document `Root Certificate=certs/supabase-root-ca.crt;SSL Mode=VerifyFull` for `ConnectionStrings:Identity` in `README.md`.
- [X] T119 [P] Write a test in `backend/MacroCounter.Api.Tests/Security/ProductionConfigTests.cs`: in Production, startup fails with a clear error when `ConnectionStrings:Identity` has `SSL Mode` other than `VerifyFull` (including missing), and succeeds with `VerifyFull`.
- [X] T120 Add that startup check to `backend/MacroCounter.Api/Program.cs`. Make T119 pass.
- [X] T121 [P] Update `README.md`:
  - prerequisites (PostgreSQL 17, `MACROCOUNTER_TEST_PG`, `scripts/dev-db.ps1`);
  - first sign-in as the owner;
  - the owner runbook, linked to contracts/owner-procedures.md;
  - remove the "Using it on your phone over LAN HTTP" section and say to use the HTTPS deployment instead (plan, Spec Follow-ups 3);
  - update the architecture blurb: the backend now stores identity and security data only;
  - say what is sent to Claude (Constitution VII Accountability).
- [X] T122 [P] Apply plan.md's Spec Follow-up 2 to `specs/003-auth-security-foundations/spec.md`: add the "What is sent to Claude" acknowledgement step to FR-004. Follow-up 1 (FR-018: owner only) was applied on 2026-10-14.
- [X] T123 [P] Update `specs/001-ai-macro-logging/contracts/estimates-api.yaml` with a note pointing to `specs/003-auth-security-foundations/contracts/auth-api.yaml` for authentication, CSRF and the 401/403/429 responses.
- [X] T124 Write `docs/deploy.md` following quickstart.md § "Production deployment":
  - Supabase: Data API off, Network Restrictions, applying the idempotent migration script, creating the `macro_app` login and `grant_app_role('macro_app')`, enabling `pg_cron`, and MFA on the owner's Supabase account;
  - Azure App Service: Linux B1, one instance, Always On, HTTPS Only, and App Settings or Key Vault references for every secret;
  - generating the Data Protection PFX with `New-SelfSignedCertificate` and base64-encoding it;
  - zip deploy.

  Link it from `README.md`. Never include real secrets or hostnames.
- [X] T125 (Done 2026-10-19, results in `checklists/validation.md`. V12.1, HTTP→HTTPS, is left for T126 on the deployed host. Three fixes along the way:
  - two feature-002 e2e tests no longer report as skipped;
  - a database outage now returns `503 service_unavailable` instead of a generic 500 (V9.2);
  - a lockout is now audited with the account when it starts (V13).)
  Run `scripts/check.ps1` until everything passes, with no skipped tests, and then run every manual scenario V1–V13 in quickstart.md locally. **Ask the user** to do the steps that need a phone authenticator app, and record the results in `specs/003-auth-security-foundations/checklists/validation.md`.
- [ ] T126 Before anyone other than the owner is invited (Constitution Governance), run `/security-review` on the branch and an ASVS L2 checklist pass, saved as `specs/003-auth-security-foundations/checklists/asvs-l2.md`, covering V2 Authentication, V3 Session, V4 Access Control, V5 Validation, V7 Errors and Logging, V8 Data Protection, V13 API and V14 Configuration. Resolve each finding or risk-accept it in writing in plan.md. Then deploy (`docs/deploy.md`) and run quickstart V12 against the live host.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T001 must pass before anything that touches the database.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every story.**
- **US1 (Phase 3)**: depends on Foundational. It provides sign-in, sessions and `TestUsers.ActivateAsync`, which **every later backend story's tests use**.
- **US2 (Phase 4)** and **US3 (Phase 5)**: both depend on US1 and can then run in parallel.
- **US4 (Phase 6)**: depends on US1 (frontend `AuthGate`). It is independent of US2, US3, US5, US6 and US7.
- **US5 (Phase 7)**: depends on US1. T098 changes `SignInService`, so it is best done after US2's T068 to avoid conflicts.
- **US6 (Phase 8)**: depends on US1, US2 and US5, because its coverage scenario uses their events.
- **US7 (Phase 9)**: depends on Foundational and US1 (for the CSP e2e test). The header and origin work (T109–T111, T113–T115) can start right after Foundational.
- **Polish (Phase 10)**: after all stories. T126 is the last gate before sharing.

### Within Each User Story

- Tests are written and **seen failing** before the implementation.
- Backend: policy/store/service → endpoints → wiring in `Program.cs`.
- Frontend: API client → pure state → components → `main.tsx` wiring → e2e.

### Parallel Opportunities

- Setup: T004–T007 in parallel after T002/T003.
- Foundational tests T010–T015 in parallel; T027 (frontend) in parallel with all backend work.
- US1: backend tests T029–T034 in parallel; frontend tests T036–T041 in parallel; implementations T043–T046 in parallel, and T051–T054 and T056 in parallel.
- US2 and US3 can be built in parallel after US1, by different people or agents.
- US4 (frontend only) can be built in parallel with US2, US3 and US5 (backend).
- US7 header and origin work can be built in parallel with US2–US5.

---

## Parallel Example: User Story 1

```text
# Backend tests together (all different files):
T029 PasswordPolicyTests.cs   T030 BreachedPasswordCheckerTests.cs   T031 EncryptedUserStoreTests.cs
T032 PostgresTicketStoreTests.cs   T033 SignInServiceTests.cs   T034 SetupServiceTests.cs

# Frontend tests together:
T036 authMachine.test.ts   T037 auth.test.ts   T038 SignInScreen.test.tsx
T039 SetupFlow.test.tsx    T040 AuthGate.test.tsx   T041 AccountMenu.test.tsx

# Then independent implementations together:
T043 PasswordPolicy.cs  T044 BreachedPasswordChecker.cs  T045 EncryptedUserStore.cs  T046 PostgresTicketStore.cs
T051 auth.ts  T052 authMachine.ts  T053 SignInScreen.tsx  T054 SetupFlow.tsx  T056 AccountMenu.tsx
```

## Parallel Example: after US1

```text
Agent A: Phase 4 (US2: owner procedures, grants)      — backend/Data/Migrations, Database tests
Agent B: Phase 5 (US3: deny-by-default inventory)     — backend/Auth/AccessPolicies.cs, Security tests
Agent C: Phase 6 (US4: per-user local data)           — frontend/src/data, frontend/src/auth
Agent D: Phase 9 T109–T111, T113–T115 (US7 headers)   — backend/Security/*
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup, then Phase 2 Foundational.
2. Phase 3 (US1): sign-in, setup and sessions; AI endpoints closed to anonymous callers.
3. **STOP and VALIDATE**: quickstart V1, V2, V4.1 and V10. At this point the app is safe from
   anonymous AI spending, but it is **not yet safe to share**. US2 and US3 (P1) complete the
   access-control story, and the full governance gate in T126 is required before inviting anyone.

### Incremental Delivery

1. US1 → US2 + US3 (all P1): access control complete.
2. US4 → US5 (P2): shared-browser privacy and cost ceilings. These are needed before a second
   person uses the app.
3. US6 → US7 (P3): audit and hardening. Both are needed before public deployment.
4. Polish → T126 security review → deploy → invite friends.

---

## Notes

- [P] tasks use different files and have no dependency on unfinished tasks.
- Never weaken a security test to make it pass; fix the code, or record a written risk acceptance
  in plan.md.
- Never put a real password, temporary code, connection string or API key in a file, a test, a
  commit or a chat. Scripts store secrets only in User Secrets or environment variables.
- Commit after each task or logical group, and keep tests green at every checkpoint.
