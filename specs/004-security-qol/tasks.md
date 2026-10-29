---
description: "Task list for Security Quality-of-Life Improvements"
---

# Tasks: Security Quality-of-Life Improvements

**Input**: Design documents from `/specs/004-security-qol/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED by Constitution Principle I (Test-First, NON-NEGOTIABLE) and the Testing rule
of Principle VII. Write each test task first, run it, and see it **fail** before you start the
implementation task it covers. Claude, HIBP and the live Supabase project are never contacted from
tests. Backend tests run against the local PostgreSQL test database as `macro_app`, the same as in
feature 003.

**Organization**: Tasks are grouped by user story (US1–US3 from spec.md), so each story can be
built and checked as its own increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: The user story the task belongs to

## Path Conventions

- Backend: `backend/MacroCounter.Api/`, tests in `backend/MacroCounter.Api.Tests/`
- Frontend: `frontend/src/`, tests in `frontend/tests/{unit,components,e2e}/`
- Real-backend e2e specs live in `frontend/tests/e2e/auth/` (Playwright project `auth`), as in 003.

## Defaults used everywhere (from research.md and data-model.md; configurable)

| Setting | Value |
|---|---|
| Pending sign-in (`mfa` session) | idle and absolute **5 min** (`Session:MfaLifetime`); at most **5** wrong codes per pending session (`Totp:SetupMaxFailures`) |
| Remembered device | `__Host-mc_device` (HttpOnly, Secure, SameSite=Strict, Path=/), 256-bit random token, SHA-256 at rest, **fixed 7 days** (`Session:RememberDeviceLifetime`), never extended |
| Lockout | Unchanged: 10 failures per account per 15 min, **now counting wrong passwords and wrong codes together** |
| Step 1 failure | `401 sign_in_failed`, message **"Username or password is incorrect."**, same for every cause, mean timing within 100 ms |
| Full / setup sessions | Unchanged: 24 h idle / 7 d absolute; 15 min |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a green baseline and make the 004 contract the live one.

- [X] T001 Run the full gate on branch `004-security-qol` before any change: `dotnet test backend` and, in `frontend/`, `npm test` and `npm run e2e`. Record any test that already fails in the Notes section at the end of this file. If the local gate cannot finish because of memory pressure, follow the project rule: push and let PR CI be the gate
- [X] T002 Point `ReadContract()` in `backend/MacroCounter.Api.Tests/Security/EndpointInventoryTests.cs` at `specs/004-security-qol/contracts/auth-api.yaml` instead of the 003 file, and accept the new access level `mfa`, alongside `public`, `setup`, `any-session` and `full`, wherever the test maps an access level to a policy. Run it and see it **fail**: `/api/auth/mfa` is in the contract but not in the app

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The new session kind, configuration, audit codes, policies and the database migration. Every story depends on these.

**⚠️ CRITICAL**: No user-story work starts until this phase is complete.

### Tests for the foundation (write first, see them fail)

- [X] T003 [P] Add migration tests in a new `backend/MacroCounter.Api.Tests/Database/TwoStepSignInMigrationTests.cs` (use the existing `Postgres` collection and fixture):
  - (a) `macro.sessions` accepts `kind = 'mfa'` and still rejects `'other'`.
  - (b) `macro.trusted_devices` exists with columns `token_hash bytea primary key`, `user_id uuid not null references macro.users(id) on delete cascade`, `security_stamp text not null`, `created_at timestamptz not null`, `expires_at timestamptz not null`, and an index on `user_id`.
  - (c) As `macro_app`: `insert`, `select` and `delete` on `trusted_devices` succeed, and `update` is **refused** (permission denied).
  - (d) RLS is enabled on `trusted_devices`.
  - (e) The audit check constraints accept the event types `password_accepted`, `device_remembered` and `device_forgotten`, and the reasons `remembered_device` and `invite_code`.
  - (f) After `macro_admin.reset_user`, `disable_user` and `revoke_sessions`, the user has 0 rows in `trusted_devices`.
  - (g) `macro_admin.purge_expired()` deletes `trusted_devices` rows whose `expires_at < now()` and keeps unexpired ones.
- [X] T004 [P] Extend `backend/MacroCounter.Api.Tests/Auth/PostgresTicketStoreTests.cs` with these tests:
  - A ticket with `SessionKind = "mfa"` is stored and retrieved.
  - It is refused once `Session:MfaLifetime` (5 min) passes since creation, for both idle and absolute expiry. Use `FakeTimeProvider`.
  - It is refused after a security stamp change or a disable.
  - `StoreAsync` still throws for an unknown kind.
- [X] T005 [P] Extend the access-level tests in `backend/MacroCounter.Api.Tests/Security/AccessMatrixTests.cs`:
  - An `mfa` session is refused (401/403) by every `full`-access endpoint and every `setup` endpoint.
  - It is accepted by `/api/auth/sign-out` (`any-session`).
  - A `full` or `setup` session is refused by `/api/auth/mfa`.

### Implementation for the foundation

- [X] T006 Add `MfaLifetime` (default `TimeSpan.FromMinutes(5)`) and `RememberDeviceLifetime` (default `TimeSpan.FromDays(7)`) to `SessionSettings` in `backend/MacroCounter.Api/Security/SecurityOptions.cs`. Add the same keys with the same values to the `Security:Session` section of `backend/MacroCounter.Api/appsettings.json`, if that section lists the others
- [X] T007 Add the `SessionRecord.MfaKind = "mfa"` constant. Add a `TrustedDevice` record class in `backend/MacroCounter.Api/Data/Records.cs` with the properties `byte[] TokenHash`, `Guid UserId`, `string SecurityStamp`, `DateTimeOffset CreatedAt` and `DateTimeOffset ExpiresAt`. Map it in `backend/MacroCounter.Api/Data/IdentityDbContext.cs` to `macro.trusted_devices` with snake_case columns, `token_hash` as the primary key, an FK to users with cascade delete, and an index on `user_id`. Change the `ck_sessions_kind` check to `kind in ('setup', 'full', 'mfa')`
- [X] T008 Add `AuditEvent.PasswordAccepted`, `DeviceRemembered` and `DeviceForgotten`, and `AuditReason.RememberedDevice` and `InviteCode`, in `backend/MacroCounter.Api/Audit/AuditLog.cs`. Keep the existing snake_case mapping, so they are stored as `password_accepted`, `device_remembered`, `device_forgotten`, `remembered_device` and `invite_code`. Update the audit check constraints in `IdentityDbContext.cs` to include them
- [X] T009 Generate the migration `TwoStepSignIn` with `dotnet ef migrations add TwoStepSignIn --project backend/MacroCounter.Api` into `backend/MacroCounter.Api/Data/Migrations/`. Then add raw SQL to its `Up`, following the style of `20261014205638_RolesGrantsAndRls.cs` and `20261014220636_OwnerProcedures.cs`:
  - `alter table macro.trusted_devices enable row level security`.
  - Redefine `macro_admin.grant_app_role` so it also grants `select, insert, delete` (no `update`) on `macro.trusted_devices` and adds `trusted_devices` to the RLS policy loop. Then re-run it for the app role, the same way the earlier migration invokes it.
  - Redefine `macro_admin.reset_user`, `disable_user` and `revoke_sessions` so each also runs `delete from macro.trusted_devices where user_id = v_id`.
  - Redefine `macro_admin.purge_expired` so it also deletes `trusted_devices` rows with `expires_at < now()`.
  - Write a `Down` that restores the previous function bodies, and drops the table and constraint values.
  - Make T003 pass.
- [X] T010 Update `backend/MacroCounter.Api/Auth/PostgresTicketStore.cs`:
  - `StoreAsync` accepts `SessionRecord.MfaKind`, with lifetime `Session.MfaLifetime`.
  - `RetrieveAsync` uses `MfaLifetime` as the idle limit for `mfa`, the same way `setup` uses `SetupLifetime`.
  - Factor the kind → (absolute, idle) lookup into one private method.
  - Make T004 pass.
- [X] T011 Add a `Remember = "remember"` claim name in `backend/MacroCounter.Api/Auth/AuthClaims.cs`. In `backend/MacroCounter.Api/Auth/AccessPolicies.cs`:
  - Add a `MfaSession` policy that requires `SessionKind = mfa`.
  - Widen `AnySession` to `full`, `setup` and `mfa`.
  - Leave `FullSession` as both the default and the fallback policy.
  - Update the doc comments ("Either kind" → "Any kind").
- [X] T012 In `IssueSession` in `backend/MacroCounter.Api/Auth/AuthEndpoints.cs`:
  - Pick the lifetime by kind (`full` → `AbsoluteLifetime`, `setup` → `SetupLifetime`, `mfa` → `MfaLifetime`).
  - Accept an optional `bool remember` that adds the `remember=true` claim.
  - Return `State(..., "mfa")` for the `mfa` kind.
  - Make T005 compile, with the `/auth/mfa` part still failing until US1.

**Checkpoint**: The migration applies, the new kind is stored and expires, and policies refuse `mfa` everywhere except sign-out. The existing suite is still green apart from T002 and the parts of T005 that need `/auth/mfa`.

---

## Phase 3: User Story 1 - Password first, then a separate authenticator screen (Priority: P1) 🎯 MVP

**Goal**:
- A wrong password fails on the sign-in screen.
- A correct one shows a separate screen asking only for the 6-digit code, and a correct code
  lands on Today.

**Independent Test**: With a fully set-up account, a wrong password shows "Username or password is incorrect." and no code screen. The right password then the right code reaches Today (quickstart scenarios 5–9).

### Tests for User Story 1 (write first, see them fail)

- [X] T013 [P] [US1] Rework `backend/MacroCounter.Api.Tests/Auth/SignInServiceTests.cs` for the step-1 service method `VerifyPasswordAsync(username, password, rememberDevice, deviceToken, sourceIp, ct)`:
  - An active account with the right password returns `PasswordAccepted` (needs code) and writes the audit event `password_accepted` / info.
  - A wrong password, an unknown username, a disabled account and an incomplete account each return the single `Failed` instance and each run exactly one hash verification (keep the existing `BurnOneHash` assertions).
  - A wrong password increments `AccessFailedCount` and calls `SignInThrottle.RecordFailure`.
  - A correct password that returns `PasswordAccepted` does **not** reset `AccessFailedCount` and does **not** call `SignInThrottle.RecordSuccess` (threat T10). Assert that the counts from earlier failures survive it.
  - The 10th failure sets `LockoutEnd` and audits `sign_in_locked`.
  - A locked account returns `Locked`.
  - Remove the tests that send `code` to step 1.
- [X] T014 [P] [US1] Create `backend/MacroCounter.Api.Tests/Auth/MfaStepTests.cs` (HTTP level, using `AuthClient`):
  - Sign-in with the right password returns `200 {"state":"mfa"}` and sets `__Host-mc_session`.
  - `POST /api/auth/mfa` with the right code returns `state=signed_in` with a **different** session cookie value, and the old cookie value is refused when replayed (`SessionCookieHeader()`).
  - A wrong code returns `400 invalid_code` with `attemptsLeft` 4, 3, 2, 1. The 5th wrong code returns `400 invalid_code` with `attemptsLeft: 0`, deletes the pending session and clears its cookie, and the next `/auth/mfa` gets 401.
  - A code reused within the replay window is refused.
  - Wrong codes increment `AccessFailedCount` and count toward the username throttle: 5 wrong passwords plus 5 wrong codes in 15 minutes leaves the account locked, and the next correct password returns 429.
  - A lockout set while a pending session is open makes `/auth/mfa` return 429.
  - Counter reset (threat T10): 9 wrong codes spread over 3 pending sessions, each opened with the correct password, then 1 more wrong code, leave the account locked. A correct password in between resets nothing.
  - The pending session is refused after 5 minutes (`FakeTimeProvider`), with 401.
  - `POST /api/auth/sign-out` with the pending session returns 204, and `/auth/mfa` then gets 401.
  - A pending session calling `GET /api/estimates/...` or another full endpoint is refused.
  - Audit: a wrong code writes `sign_in` / failure / `invalid_code`, and a correct code writes `sign_in` / success.
  - Two clients sharing one pending cookie: after the first succeeds, the second gets 401.
- [X] T015 [P] [US1] Update `backend/MacroCounter.Api.Tests/Auth/AuthEndpointsTests.cs`:
  - `POST /api/auth/sign-in` with a `code` property returns 400, because unknown fields are rejected.
  - `rememberDevice` accepts only a boolean.
  - The 401 problem body text is "Username or password is incorrect."
  - `GET /api/auth/session` always includes `deviceRemembered` (false here).
  - `GET /api/auth/session` with a pending session returns `state=mfa`.
- [X] T016 [P] [US1] Update `backend/MacroCounter.Api.Tests/Infrastructure/AuthClient.cs` so `SignInAsync(username, password, code = null, bool? rememberDevice = null)`:
  - Posts `{ username, password }` when `rememberDevice` is null (the box was not touched), and `{ username, password, rememberDevice }` otherwise. An explicit `false` means "forget this device" (FR-016a), so the helper never sends it by default.
  - If the response state is `mfa` and `code` is not null, posts `/api/auth/mfa` with `{ code }` and returns that state.
  - Add `PasswordStepAsync` and `MfaAsync` helpers for tests that need the steps separately.
  - Run the whole backend suite. Existing callers in `AccountLifecycleTests`, `PasswordChangeTests`, `SignInLimitTests`, `AuditScenario`, `DatabaseOutageTests`, `OriginCheckTests` and `RefusedRequestLogTests` should keep passing once US1 is implemented. Fix any that assumed one-request sign-in.
- [X] T017 [P] [US1] Update `frontend/tests/unit/api/auth.test.ts`:
  - `signIn(username, password, rememberDevice?: boolean)` posts exactly `{username, password}` when `rememberDevice` is `undefined`, and `{username, password, rememberDevice}` otherwise.
  - The new `verifyMfa(code)` posts `{code}` to `/api/auth/mfa` with the CSRF header.
  - `SessionStateSchema` accepts `state: 'mfa'` and requires `deviceRemembered: boolean`.
  - `400 invalid_code` maps to `AuthError` code `invalid_code` with `attemptsLeft`.
- [X] T018 [P] [US1] Update `frontend/tests/unit/auth/authMachine.test.ts`:
  - From `signed_out`, a session with `state=mfa` goes to `{kind:'mfa'}`.
  - `session-expired` in `mfa` goes to `{kind:'signed_out', notice:'mfa_expired'}`.
  - A new event `mfa-attempts-exceeded` in `mfa` goes to `{kind:'signed_out', notice:'mfa_attempts'}`.
  - An `mfa` session while `signed_in` or `offline` goes to `reload`.
  - From `mfa`, `state=signed_in` goes to `signed_in`.
- [X] T019 [P] [US1] Update `frontend/tests/components/SignInScreen.test.tsx`:
  - There is no authenticator code field (`queryByLabelText(/authenticator/i)` is null).
  - Submitting calls `auth.signIn(username, password, undefined)`.
  - A 401 shows exactly "Username or password is incorrect.", clears the password and keeps the username.
  - The `mfa_expired` notice shows "Your sign-in timed out. Enter your password again."
  - The `mfa_attempts` notice shows "Too many incorrect codes. Enter your password again."
- [X] T020 [P] [US1] Create `frontend/tests/components/MfaScreen.test.tsx` per `specs/004-security-qol/contracts/ui-flow.md`:
  - Heading "Enter your authenticator code".
  - The field labelled "Authenticator code" has `inputmode="numeric"` and `autocomplete="one-time-code"`, is focused on mount, and strips non-digits.
  - "Verify" is disabled until there are 6 digits.
  - The right code calls `auth.verifyMfa` and passes the session to `onSession`.
  - A 400 shows "That code is incorrect. Try again." and clears the field. When `attemptsLeft ≤ 2` it adds "*n* attempts left."
  - A 400 with `attemptsLeft: 0` calls the attempts-exceeded handler, not the expired one.
  - A 401 calls the expired handler.
  - A 429 shows "Too many attempts. Try again later."
  - "Use a different account" calls `auth.signOut` and then the signed-out handler.
- [X] T021 [P] [US1] Update `frontend/tests/components/AuthGate.test.tsx`:
  - A session with `state=mfa` renders `MfaScreen`, not the app or `SetupFlow`.
  - After `verifyMfa` resolves with `signed_in`, the app renders.
- [X] T022 [P] [US1] Update the helper `signIn` in `frontend/tests/e2e/auth/flows.ts`:
  - Fill "Password (or Invite Code)".
  - Optionally tick "Remember User".
  - Click "Sign in".
  - If a `code` is given, wait for the heading "Enter your authenticator code", fill "Authenticator code" and click "Verify".
  - Then create `frontend/tests/e2e/auth/mfa.spec.ts` covering quickstart scenarios 5 (wrong password: no code screen), 6 (unknown user: same message), 7 (wrong then right code reaches Today) and 9 ("Use a different account").

### Implementation for User Story 1

- [X] T023 [US1] Split `backend/MacroCounter.Api/Auth/SignInService.cs` into two steps:
  - Step 1, `VerifyPasswordAsync`:
    - Keep the throttle, lockout, disabled, canonical-name and `BurnOneHash` paths exactly as they are.
    - An active account (password, `TwoFactorEnabled`, key present) with the right password returns the new outcome `PasswordAccepted(user)` and audits `password_accepted` / info.
    - `PasswordAccepted` MUST NOT reset `AccessFailedCount` or `LockoutEnd`, and MUST NOT call `throttle.RecordSuccess`. In the `SignInAsync` wrapper, call `RecordSuccess` only for `SignedIn`, and for `SetupRequired` with step `password` or `totp`. Only a completed authenticator step (`VerifyMfaAsync` success) resets the counters (threat T10).
    - The setup paths stay in `SignInDuringSetup`, minus the `code` check. US2 adjusts them.
  - Step 2, `VerifyMfaAsync(user, code, sessionKey, sourceIp, ct)`:
    - Re-check the lockout, then use `CodeAccepted`.
    - On success, reset `AccessFailedCount` and `LockoutEnd`, set `LastSignInAt`, call `throttle.RecordSuccess`, and audit `sign_in` / success.
    - On failure, call `RecordFailure` with reason `invalid_code`, call `throttle.RecordFailure(name)`, and increment the session's `setup_failed_codes` through `PostgresTicketStore.IncrementSetupFailuresAsync`. At `Totp:SetupMaxFailures`, remove the session and return `PendingRevoked`. Otherwise return `InvalidCode(attemptsLeft)`.
  - Update the class doc comment (it now cites 004 research R1 instead of 003 R4).
  - Make T013 pass.
- [X] T024 [US1] Update `backend/MacroCounter.Api/Auth/AuthEndpoints.cs`:
  - `SignInRequest(string? Username, string? Password, bool? RememberDevice)`: drop `Code`, so `StrictJson` rejects it, and update the validation message to "Enter a username and a password."
  - Map `PasswordAccepted` to `IssueSession(..., SessionRecord.MfaKind, remember: request.RememberDevice == true)`.
  - Map `/auth/mfa` (`.RequireAuthorization(AccessPolicies.MfaSession).RequireRateLimiting(RateLimits.SignIn)`) to a new `VerifyMfa` handler:
    - Validate `CodeRequest` with `SixDigits()`.
    - Call `VerifyMfaAsync`.
    - On success, call `IssueSession(full)`. That rotates the key through `SessionRotation`, so the pending row is deleted.
    - On `InvalidCode`, return `Problems.InvalidCode(attemptsLeft)`.
    - On `PendingRevoked`, sign out (which clears the cookie) and return `Problems.InvalidCode(0)`, so the client can tell "too many codes" apart from a timeout.
    - On `Locked`, return `Problems.RateLimited`.
  - `GetSession` returns `state=mfa` for an `mfa` session.
  - Add `bool DeviceRemembered` to `SessionState`, always serialized and `false` for now; US3 fills it.
  - Make T002, T005, T014 and T015 pass.
- [X] T025 [US1] Change the sign-in failure text to "Username or password is incorrect." in `Problems.SignInFailed()` in `backend/MacroCounter.Api/Endpoints/Problems.cs`, and update `backend/MacroCounter.Api.Tests/Endpoints/ProblemsTests.cs` to match
- [X] T026 [P] [US1] Update `frontend/src/api/auth.ts`:
  - `SessionStateSchema`: `state` enum gains `'mfa'`, and `deviceRemembered: z.boolean()` is added.
  - `signIn(username, password, rememberDevice?: boolean)` omits `rememberDevice` from the body when it is `undefined`.
  - Add `verifyMfa(code)`, which posts `/api/auth/mfa`.
  - Add `verifyMfa` to `authApi`.
  - Update the header comment.
  - Make T017 pass.
- [X] T027 [P] [US1] Update `frontend/src/auth/authMachine.ts`:
  - Add the `{ kind: 'mfa' }` state.
  - Add `'mfa_expired'` and `'mfa_attempts'` to the `signed_out` notice union, and the `mfa-attempts-exceeded` event.
  - Make the transitions match T018.
- [X] T028 [US1] Update `frontend/src/auth/SignInScreen.tsx`:
  - Remove the code state and field.
  - Call `auth.signIn(username.trim(), password, undefined)`. US3 adds the checkbox.
  - Set `SIGN_IN_FAILED = 'Username or password is incorrect.'`.
  - Add the notice texts `mfa_expired` → "Your sign-in timed out. Enter your password again." and `mfa_attempts` → "Too many incorrect codes. Enter your password again."
  - On failure, keep the username.
  - Rewrite the doc comment: password only; the code is asked for on the next screen (004 R1).
  - Make T019 pass.
- [X] T029 [US1] Create `frontend/src/auth/MfaScreen.tsx` with exactly the text and behaviour in `specs/004-security-qol/contracts/ui-flow.md` ("Authenticator screen"). Reuse `FieldError` and the `stack auth-form` classes from `SignInScreen`. Props: `onSession`, `onExpired`, `onAttemptsExceeded` and `onSignedOut`. Make T020 pass
- [X] T030 [US1] Route the `mfa` state to `MfaScreen` in `frontend/src/auth/AuthGate.tsx`, with the same page chrome as the sign-in screen. Wire `onExpired` to dispatch `session-expired`, `onAttemptsExceeded` to dispatch `mfa-attempts-exceeded`, and `onSignedOut` to a fresh `getSession()`. Make T021 and T022 pass

**Checkpoint**: A returning user signs in in two steps. A wrong password fails before the code screen, and code failures share the lockout. MVP complete.

---

## Phase 4: User Story 2 - First sign-in with an invite code, then authenticator setup (Priority: P1)

**Goal**:
- "Password (or Invite Code)" accepts the invite code.
- "Set your password" (with confirmation) comes before authenticator setup, then the notice.
- An unfinished setup resumes at the right step.

**Independent Test**: Invite a new account. Use the invite code, set and confirm a password, set up the authenticator, acknowledge the notice, and reach Today. Then sign out and sign in with the password and a code (quickstart scenarios 1–4).

### Tests for User Story 2 (write first, see them fail)

- [X] T031 [P] [US2] Add these cases to `backend/MacroCounter.Api.Tests/Auth/SignInServiceTests.cs` and `backend/MacroCounter.Api.Tests/Auth/SetupServiceTests.cs`:
  - A valid, unexpired invite code returns `SetupRequired(step: password)` and audits `setup_started` / success / `invite_code`.
  - A used, wrong or expired invite code returns `Failed` with one hash burn (unchanged).
  - A correct password with no authenticator, before `SetupExpiresAt`, returns `SetupRequired(step: totp)` **without** asking for a code (FR-013).
  - The same after the deadline returns `Failed`, audited with `setup_expired`.
  - A correct password with the authenticator enrolled but the notice not acknowledged returns `PasswordAccepted` (code needed), and then `VerifyMfaAsync` returns `SetupRequired(step: notice)`.
  - For that notice-pending account, the correct password leaves `AccessFailedCount` and the username throttle untouched (threat T10). Only the successful code resets them.
- [X] T032 [P] [US2] Add to `backend/MacroCounter.Api.Tests/Auth/MfaStepTests.cs`: for an account stopped at the notice step, `/auth/mfa` with the right code returns `state=setup, setupStep=notice` with a new `setup` session (a different cookie value). Acknowledging the notice then returns `signed_in`
- [X] T033 [P] [US2] Update `frontend/tests/components/SignInScreen.test.tsx`: the password field's label is exactly "Password (or Invite Code)". Update `frontend/tests/components/SetupFlow.test.tsx`:
  - The password step heading is "Set your password".
  - Mismatched entries show "The passwords do not match." and call nothing.
  - After `setupPassword` resolves with `setupStep=totp`, the heading "Add an authenticator" is shown next.
- [X] T034 [P] [US2] Update `frontend/tests/e2e/auth/first-sign-in.spec.ts` and `completeSetup` in `frontend/tests/e2e/auth/flows.ts` for the new labels and the "Set your password" heading. Add these e2e cases:
  - (a) Set a password, close the page before the authenticator, sign in again with the password, and land on "Add an authenticator" with no code screen.
  - (b) A reused invite code shows "Username or password is incorrect."
  - (c) On "Set your password" and again on "Add an authenticator", `page.goBack()` never shows Today or any signed-in screen. The page shows the setup step or the sign-in screen.
  - Replace every `getByLabel('Password or temporary code')` in `frontend/tests/e2e/**` and `frontend/tests/components/**` with `getByLabel('Password (or Invite Code)')`.

### Implementation for User Story 2

- [X] T035 [US2] Update `SignInDuringSetup` in `backend/MacroCounter.Api/Auth/SignInService.cs`:
  - The invite-code path audits `setup_started` with reason `invite_code`.
  - The password path no longer checks a code. When `TwoFactorEnabled` is false, it returns `SetupRequired(step: totp)`. When `TwoFactorEnabled` is true (the notice is pending), it returns `PasswordAccepted` so that the code is asked for on the MFA screen.
  - Move the existing `user.AccessFailedCount = 0` (currently just before the `SetupStarted` audit) so it runs **only** on the `SetupRequired` paths, never before returning `PasswordAccepted` (threat T10).
  - In `VerifyMfaAsync`, when `SetupSteps.Next(user) == Notice`, return `SetupRequired(user, Notice)` instead of signing in, and do not set `LastSignInAt`.
  - Make T031 pass.
- [X] T036 [US2] In the `/auth/mfa` handler in `backend/MacroCounter.Api/Auth/AuthEndpoints.cs`, map `SetupRequired` to `IssueSession(..., SessionRecord.SetupKind, setupStep, remember: <remember claim of the pending session>)`. Make T032 pass
- [X] T037 [P] [US2] Change the password field label to exactly "Password (or Invite Code)" in `frontend/src/auth/SignInScreen.tsx`
- [X] T038 [P] [US2] In `frontend/src/auth/SetupFlow.tsx`:
  - Rename the password-step heading "Choose a password" to "Set your password".
  - Make sure the mismatch message is exactly "The passwords do not match."
  - Replace any user-facing "temporary code" wording with "invite code".
  - Make T033 and T034 pass.

**Checkpoint**: A new user goes invite code → set and confirm password → authenticator → notice → Today. US1 still passes.

---

## Phase 5: User Story 3 - Remember User for a week (Priority: P2)

**Goal**:
- Ticking "Remember User" and completing sign-in lets this browser skip the authenticator step for
  that account for 7 days.
- Sign-out everywhere, a reset, a password change and a disable end it immediately.

**Independent Test**: Sign in with the box ticked and sign out. Signing in again on the same browser needs only the password, while another browser, another account, or 7 days later asks for a code (quickstart scenarios 10–14).

### Tests for User Story 3 (write first, see them fail)

- [X] T039 [P] [US3] Create `backend/MacroCounter.Api.Tests/Auth/TrustedDeviceTests.cs` (HTTP level, `FakeTimeProvider`). Cover:
  - **Remembering**:
    - (a) Sign-in with an explicit `rememberDevice: true` followed by a correct `/auth/mfa` sets `__Host-mc_device` with the attributes HttpOnly, Secure, SameSite=Strict, Path=/ and an expiry 7 days out. One `trusted_devices` row exists, whose `token_hash` is the SHA-256 of the cookie's token (never the raw token), and `device_remembered` is audited.
    - (b) A later sign-in on that client with the right password, both with `rememberDevice` **absent** and with `true`, returns `state=signed_in` directly, audits `sign_in` / success / `remembered_device`, and leaves `expires_at` unchanged (FR-017).
    - (c) The same with a **wrong** password returns 401 (the password is always required).
  - **What does not get remembered**:
    - (d) An explicit `rememberDevice: true` at step 1 then abandoning step 2 creates no row and no cookie (FR-015).
    - (e) With `rememberDevice` absent or `false` (no device yet), the authenticator step creates no row.
  - **Limits on use**:
    - (f) A second account signing in on the same client with `rememberDevice` absent gets `state=mfa`, gets no device row of its own, and leaves the first account's row and cookie intact. The first account still signs in without a code afterwards (FR-003, US3 scenario 8).
    - (g) At 7 days plus 1 second, `state=mfa` is returned. Expiry is decided by server time (`FakeTimeProvider`), whatever the cookie's `Expires` says.
  - **Opting out and revocation**:
    - (h) With an explicit `rememberDevice: false` and a valid device cookie for this account, the row is deleted, the cookie is cleared, `device_forgotten` is audited, and the response is `state=mfa` (FR-016a).
    - (i) A normal `/auth/sign-out` keeps the row and the cookie (FR-018).
    - (j) `/auth/sign-out-everywhere`, a password change via `/api/auth/password`, `macro_admin.reset_user` and `macro_admin.disable_user` each make the next sign-in ask for a code, and leave 0 rows for the user.
  - **Replacing and protecting the cookie**:
    - (k) When a second account signs in with an explicit `rememberDevice: true` on the same client, the first account's row is deleted and the cookie is replaced after the second account's code.
    - (l) A tampered or unknown device cookie is ignored: the response is `state=mfa` and the request does not error.
  - **Session state and setup**:
    - (m) `GET /api/auth/session` returns `deviceRemembered: true` only while a valid device cookie is present.
    - (n) First sign-in with an invite code and `rememberDevice: true`: **no** row exists after `/auth/setup/totp/confirm`. The row is created when `/auth/setup/notice` completes setup. Abandoning setup before the notice leaves no row.
- [X] T040 [P] [US3] Extend `backend/MacroCounter.Api.Tests/Audit/SecretScanTests.cs` (and `AuditCoverageTests.cs` if it lists event types) so that, after the T039 scenarios, no audit row and no log line contains the device token or its base64 or hex hash. Also check that `password_accepted`, `device_remembered` and `device_forgotten` are covered
- [X] T041 [P] [US3] Update `frontend/tests/components/SignInScreen.test.tsx`:
  - A checkbox labelled exactly "Remember User" sits after the password field in tab order.
  - It is unticked when the `deviceRemembered` prop is false and ticked when it is true.
  - If the person never touches it, `auth.signIn` is called with `rememberDevice` `undefined`, whatever the initial value.
  - After any change event, the box's final value is passed. Ticking then unticking passes `false`. Unticking then re-ticking a pre-ticked box passes `true`.
  - A signed-in session returned directly from `signIn` (remembered device) calls `onSession` with no code screen.
- [X] T042 [P] [US3] Create `frontend/tests/e2e/auth/remember-user.spec.ts` covering quickstart scenarios 10 (ticked: no code next time), 11 (a new browser context still asks for a code), 12 (unticking forgets the device), 12a (a second account leaving the pre-ticked box alone neither gets remembered nor displaces the first) and 13 ("Sign out everywhere" in a second context ends remembering)

### Implementation for User Story 3

- [X] T043 [US3] Create `backend/MacroCounter.Api/Auth/TrustedDeviceStore.cs`, registered as scoped in `backend/MacroCounter.Api/Auth/AuthServices.cs`, with a cookie-name constant `DeviceCookie = "__Host-mc_device"`. Its API:
  - `ReadToken(HttpContext)`: unprotects the cookie value with a Data Protection purpose of `"MacroCounter.DeviceToken.v1"`. Returns null on a missing or invalid cookie.
  - `FindValidAsync(token, ct)`: returns the `user_id` when `now < expires_at`, the stamp matches `users.security_stamp`, and `users.disabled_at is null`. Otherwise null, and it deletes an expired or stale row.
  - `RememberAsync(context, user, ct)`: deletes the row of any current cookie, inserts a new row with a 32-byte `RandomNumberGenerator` token, `token_hash = SHA256(token)`, the user's current stamp, and `expires_at = now + RememberDeviceLifetime`. It appends the cookie (HttpOnly, Secure, SameSite=Strict, Path=/, `Expires = expires_at`, protected value) and audits `device_remembered`.
  - `ForgetAsync(context, ct)`: deletes the current cookie's row, deletes the cookie and audits `device_forgotten`.
  - `ForgetAllForUserAsync(userId, ct)`.
  - Use raw Npgsql commands in the style of `PostgresTicketStore`. There is no `update` statement, because the app role cannot update.
- [X] T044 [US3] Wire remembering into step 1 in `backend/MacroCounter.Api/Auth/SignInService.cs` and `AuthEndpoints.cs`. `SignInRequest.RememberDevice` is `bool?`, where `null` means "not changed". After a **successful** password check on an active account, apply exactly the table in `specs/004-security-qol/research.md` R3:
  - Valid device cookie for this user, `RememberDevice` null or true: return `SignedIn(user, viaRememberedDevice: true)`, audit with reason `remembered_device`, and reset the counters as a full sign-in does.
  - Valid device cookie for this user, `RememberDevice` false: call `ForgetAsync`, then continue to `PasswordAccepted`.
  - Any other cookie state: `PasswordAccepted`, with the `remember` claim set only when `RememberDevice == true`. Never touch another account's device at step 1.
  - The device lookup must not run on any failure path, so failure timing is unchanged (R4). Make T039 (b), (c), (f), (g), (h) and (l) pass.
- [X] T045 [US3] Create devices after the authenticator step:
  - In `VerifyMfa` (`AuthEndpoints.cs`), when the pending session's `remember` claim is `true`:
    - If the result is a full session, call `TrustedDeviceStore.RememberAsync` after `IssueSession`.
    - If the result is a setup session at the notice step, carry the claim onto that setup session instead.
  - In `AcknowledgeNotice` (`AuthEndpoints.cs`), when setup completes (`Advanced { NextStep: null }`) and the setup session's `remember` claim is `true`, call `RememberAsync` after issuing the full session. `ConfirmTotp` creates no device.
  - In the setup-start path (step 1 returning `SetupRequired`), set the `remember` claim on the setup session only when `SignInRequest.RememberDevice == true`.
  - Make T039 (a), (d), (e), (k) and (n) pass.
- [X] T046 [US3] Revocation:
  - In `SignOutEverywhere` (`AuthEndpoints.cs`), call `ForgetAllForUserAsync` and delete the device cookie.
  - Confirm that `SetupService.StorePasswordAsync` rotating the stamp invalidates devices. No delete is needed, but add a comment citing 004 FR-018.
  - Leave `SignOut` untouched.
  - Make T039 (i) and (j) pass.
- [X] T047 [US3] `GetSession` in `AuthEndpoints.cs` sets `DeviceRemembered = token is not null && await devices.FindValidAsync(token) is not null`, with `token = devices.ReadToken(context)`. `ReadToken` unprotects first, so a missing or tampered cookie costs no database query. Make T039 (m) pass
- [X] T048 [US3] Frontend:
  - In `frontend/src/auth/SignInScreen.tsx`, add the "Remember User" checkbox below the password field (a label that wraps the input, with a touch target of at least 44 px). Its initial value comes from a new `deviceRemembered` prop. Keep a `touched` flag that is set on any change event, and pass `touched ? checked : undefined` to `auth.signIn` (FR-003).
  - In `frontend/src/auth/AuthGate.tsx`, pass `session.deviceRemembered` from the last session response.
  - Add any checkbox styling to the existing auth form stylesheet. Do not add a new CSS file unless none exists.
  - Make T041 and T042 pass.

**Checkpoint**: All three stories work independently. A remembered browser signs in with the password only, and every revocation path ends it.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T049 [P] Create `backend/MacroCounter.Api.Tests/Auth/SignInTimingTests.cs` (SC-004). Use the real PBKDF2 hasher. Send 30 step-1 requests each for an unknown username, a wrong password and a used invite code, interleaved, after 5 warm-up requests. Assert that all three bodies are byte-identical and that the means differ by less than 100 ms. Mark the test `[Trait("Category","Timing")]` so CI can rerun it once if it flakes under load. Disable the throttle and lockout through test options so they do not interfere
- [X] T050 [P] Add a wording guard test in `frontend/tests/unit/auth/wording.test.ts`. It reads every `.tsx` and `.ts` file under `frontend/src/` and fails if the case-insensitive text "temporary code" appears in a string literal or JSX text (FR-001). Fix any remaining hits in `frontend/src/` (for example `AccountMenu.tsx` and `ChangePasswordForm.tsx`)
- [X] T051 [P] Check the 360 px layout in `frontend/tests/e2e/auth/mfa.spec.ts`: add a test at `viewport: { width: 360, height: 740 }` on the sign-in screen and the authenticator screen. It asserts there is no horizontal scroll (`document.documentElement.scrollWidth <= 360`), and that the "Remember User" checkbox label and the "Verify" and "Use a different account" controls have bounding boxes of at least 44 × 44 (FR-023)
- [X] T052 [P] Update the owner docs: in `specs/003-auth-security-foundations/quickstart.md` and any deploy or owner runbook under `docs/` or the repo root that tells friends to put the "temporary code" in the password field, change the instructions to the new two-screen flow and the "invite code" wording. Add one line to `specs/003-auth-security-foundations/research.md` R4: "Superseded by 004 research R1 (two-step sign-in)."
- [X] T053 Update `specs/003-auth-security-foundations/checklists/asvs-l2.md`: note the 2.2.1 deviation (password oracle, risk-accepted in the "Recorded ASVS deviations" table of `specs/004-security-qol/plan.md`). Add an entry for the remembered-device control (3.x session-equivalent token: HttpOnly, hashed, fixed expiry, revocable)
- [X] T054 Run `/security-review` on the branch diff. Resolve or risk-accept, in writing in this file's Notes, every finding about the pending session, the device cookie or the migration grants
- [ ] T055 Run the full gate (`dotnet test backend`; in `frontend/`, `npm test`, `npm run lint` if present, `npm run e2e`; plus `dotnet list package --vulnerable` and `npm audit`). Then walk through every manual scenario in `specs/004-security-qol/quickstart.md` and record pass or fail in Notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T002 is a failing test that becomes green in T024.
- **Foundational (Phase 2)**: depends on Setup and **blocks all stories**. T003–T005 come before T006–T012. T009 depends on T007 and T008. T010 depends on T006 and T007. T012 depends on T010 and T011.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on US1. It changes the same `SignInService` step split and the `/auth/mfa` handler.
- **US3 (Phase 5)**: depends on US1, which supplies the step-1 and step-2 endpoints and the `remember` claim plumbing from T012. It does not depend on US2, except T045's setup-completion (notice) branch, which needs the `remember` claim carried onto the setup session (T036).
- **Polish (Phase 6)**: after the stories you intend to ship.

### Within each story

The tests ([P] where marked) come first and must fail. Then backend service → endpoints → frontend API → state machine → components. Tasks that touch the same file (`SignInService.cs`, `AuthEndpoints.cs`, `SignInScreen.tsx`) run in the order listed.

### Parallel opportunities

- Phase 2 tests: T003, T004 and T005 together.
- US1 tests: T013–T022 are all different files and can be written together. Of the implementation, T026 and T027 (frontend) can run alongside T023–T025 (backend).
- US2: T031–T034 together. T037 and T038 together.
- US3: T039–T042 together.
- Polish: T049–T052 together.

## Parallel Example: User Story 1

```text
# Write all failing tests at once:
T013 SignInServiceTests.cs      T014 MfaStepTests.cs        T015 AuthEndpointsTests.cs
T016 AuthClient.cs              T017 auth.test.ts           T018 authMachine.test.ts
T019 SignInScreen.test.tsx      T020 MfaScreen.test.tsx     T021 AuthGate.test.tsx
T022 flows.ts + mfa.spec.ts

# Then backend and frontend implementation side by side:
Backend:  T023 → T024 → T025
Frontend: T026, T027 (parallel) → T028 → T029 → T030
```

## Implementation Strategy

### MVP first (US1)

1. Phases 1–2: the green baseline, the migration, the session kind and the policies.
2. Phase 3 (US1): two-step sign-in for existing accounts. **Stop and validate** with quickstart 5–9. This alone delivers the main requested change: a wrong password fails before the MFA screen.

### Incremental delivery

1. Add US2 (invite wording and setup routing). Validate with quickstart 1–4.
2. Add US3 (Remember User). Validate with quickstart 10–14.
3. Polish: timing (SC-004), wording guard, 360 px, docs, ASVS note, security review, full gate.

Each checkpoint leaves the app deployable. US1 without US3 simply never offers the checkbox. US3 needs US1.

## Notes

- `[P]` = different files, no unfinished dependency. `[USn]` maps to spec user stories.
- Commit after each task or logical group, using small focused commits (Development Workflow).
- Record T001 baseline failures, T054 review outcomes and T055 manual results here.

### Implementation log (2026-10-29)

- **T001 baseline**: green on `004-security-qol` before any change (backend 431, frontend 513, e2e 69).
  The local `node_modules` was missing `uqr`; `npm ci` fixed it.
- **Deviations from the task text**:
  - T035 (setup routing) was built together with T023, because removing `code` from step 1 forces it.
    The T031 tests were written alongside the T013 tests, before either.
  - A pending sign-in started on the sign-in screen or the expired overlay stays inside a new
    `SignInFlow` component (password screen, then code screen). The machine's `mfa` state is used
    only when a pending sign-in is found at launch. This means a pending sign-in never reloads the
    page over someone's data (US1.4).
  - `deviceRemembered` lives in `AuthGate`'s reducer, not in `useState`, because the
    `react-hooks/set-state-in-effect` lint rule flags it.
  - A 429 on the code screen keeps the screen and shows the message; "Use a different account" goes
    back. `contracts/ui-flow.md` is updated to match.
- **T054 `/security-review`**: no findings with high enough confidence. It checked that pending and
  setup sessions can't reach full endpoints, that each step rotates the session (no fixation),
  device-token forging, cross-account use and revocation, that lockouts aren't reset by a correct
  password, the SQL parameters and grants, and that setup can't finish without TOTP.
- **T055 automated gate**: passes.
  - Backend: 495 tests.
  - Frontend: lint, typecheck, 607 tests with coverage.
  - e2e: 83 of 85 passed. 1 failed in auth-mobile at the CSRF race below, and 1 did not run
    because it depends on that project. 24 repeat runs of the affected specs all passed.
  - Scans: no vulnerable NuGet packages; npm audit has 4 low-severity issues only.
  - `dotnet format`: clean for every changed file. The only complaints are end-of-line warnings in
    untouched files, which have CRLF in this Windows working copy.
- **T055 manual quickstart walk-through**: **not done yet**. It needs a person with an
  authenticator app. Left open.
- **Known flake, already in 003**: two `GET /api/auth/session` requests start at launch. If the
  second one answers after a fast sign-in, it overwrites the CSRF token with the signed-out token,
  and the next setup step gets `403 csrf_failed`. Not fixed here.
