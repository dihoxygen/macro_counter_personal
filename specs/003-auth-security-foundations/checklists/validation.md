# Validation Record: Auth & Security Foundations (T125)

**Purpose**: Record the merge gate and every manual scenario in [quickstart.md](../quickstart.md#manual-validation-scenarios), run locally
**Date**: 2026-10-18
**Feature**: [spec.md](../spec.md)

## How it was run

- Branch `003-auth-security-foundations` at `a38bd83`, plus the e2e skip fix below and the V9.2 and V13 fixes. Windows 11, local PostgreSQL 18, database `macro_dev`.
- The owner (on the phone) did the steps that need an authenticator app: V1 on a fresh `val-phone` account, and the owner sign-ins in V8.2.
- Claude drove every other step in Playwright Chromium against test accounts `val-a`, `val-b` and `val-c` (invited for this run). Codes came from the setup key with RFC 6238, which is what an authenticator app computes.
- These backends ran from the same build:

  | Port | Environment | Used for | Overrides |
  |---|---|---|---|
  | 5080 | Development | The owner's V1 | None |
  | 5085 | Development | V2–V9 | `Security:SignIn:PerIpLimit=1000`, because every scripted sign-in comes from 127.0.0.1. The per-username limit and lockout tested in V3 are unchanged. |
  | 5086 | Testing, fake estimator | V10, V11 | The quickstart settings, so no Claude call is made and nothing is billed |
  | 5086 | Testing | V12 | `AllowedHosts=localhost` |

  Development used the live Have I Been Pwned range API (V1.3) and never called Claude.

## Merge gate: `scripts/check.ps1`

- [x] All 10 steps passed on the final tree, with the V9.2 and V13 fixes. This was the fifth run.
  - Earlier runs: the first two passed before the fixes (406 backend tests), and the third passed after the V9.2 fix (411).
  - On the fourth run, one feature-002 e2e test failed once: "Retake brings the live preview back" timed out waiting for the snapshot. It then passed 72 of 72 times with `--repeat-each=8`. It's camera-only and unrelated to the backend change, so it was a timing flake.
  - Backend: 412 passed, 0 skipped. The fixes added the 5 `DatabaseOutageTests` and 1 lockout-audit test.
  - Frontend unit and component: 559 passed in 45 files.
  - E2E: 67 passed, 0 skipped.
  - Vulnerability scans (NuGet, npm): 0 high or critical findings.
  - Secret scan: clean across 350 files.
- [x] No skipped tests. Two feature-002 e2e tests used `test.skip` to run in only one viewport project, so Playwright reported them as skipped in the other project. Each now runs only in its own project, set in `playwright.config.ts`:
  - The desktop file-dialog test is tagged `@desktop-only`, and the mobile project has `grepInvert: /@desktop-only/`.
  - `touch-targets.spec.ts` is in the desktop project's `testIgnore`.

  Coverage is unchanged.

## Manual scenarios

### V1. First-time setup
- [x] V1.1–V1.6 scripted on `val-a`. All passed:
  - no sign-up, register or request option;
  - the temporary code leads to "Choose a password";
  - `password1234` is rejected as breached;
  - a password containing the username is rejected ("Don't include your username.");
  - the QR code, the setup key and the `otpauth://` link are shown;
  - a wrong code shows "Code didn't match. 4 attempts left.";
  - the "What is sent to Claude" notice appears, then Today, after 2.4 s of app time;
  - reusing the temporary code gives the generic "Could not sign in".
- [x] V1 with a phone authenticator (`val-phone`, owner). Passed. The owner scanned the QR code with the phone app, and its code was accepted. The audit shows `setup_started`, `password_rejected`, `password_set`, `totp_enrolled` and `ai_notice_acknowledged`, and Today came up about 20 s after the password was chosen.

### V2. Normal sign-in and generic failures
- [x] V2.1: Today reached in 258 ms.
- [x] V2.2: a wrong password, an unknown username, a wrong code and no code all gave the same message ("Could not sign in. Check your details and try again.") with HTTP 401, in 193, 156, 195 and 141 ms.
- [x] V2.3: ` VAL-A ` with the right credentials signs in.

### V3. Brute force
- [x] V3.1: after 10 wrong attempts for `val-c`, the 11th, with correct credentials, shows "Too many attempts. Try again later." `users_overview.locked_until` was set.
- [x] V3.2: the unknown username `ghost-user` gave identical messages at every step.
- [x] V3.3: after `unlock_user('val-c')` and an app restart, sign-in works.

### V4. Sign-out, Back, and sign out everywhere
- [x] V4.1: after Sign out, Back shows no signed-in screen.
- [x] V4.2: after "Sign out everywhere" in B, a third signed-in browser that opens AI lookup gets the "Sign in again" overlay (`/api/status` returned 401).

### V5. Owner disables and resets
- [x] V5.1: after `disable_user('val-b')`, the friend's next server action shows the sign-in overlay with no page errors. Signing in while disabled fails generically.
- [x] V5.2: `enable_user` then `reset_user`. The friend chose a password again, got a **new** authenticator key and reached Today. The Claude notice was not shown again, because `reset_user` keeps `ai_notice_ack_at` (owner-procedures.md). Each owner task takes seconds.

### V6. Deny by default
- [x] `POST /api/estimates/text` with no session returned 401, both with and without `Origin`.
- [x] `GET /api/status` returned 401.
- [x] `GET /api/health` returned 200 `{"status":"ok"}`.
- [x] The server log shows no outbound request to `api.anthropic.com`. The same log does show the outbound HIBP calls, so outbound requests are logged.

### V7. Two people on one browser
- [x] V7.2: B's Today screen had no entries, recent foods or goal from A, after A logged 2 entries and set a 140 g goal.
- [x] V7.3: A's entries and goal were all there, and B's entry was not.

### V8. Legacy data adoption
- [x] V8.1: the pre-feature `macro-counter` database was seeded (the same seed as the e2e test), then `val-a` (a regular user) signed in. Nothing was adopted, the user started empty, and the legacy database was kept.
- [x] V8.2: the owner signed in by hand (password and phone code) in a fresh browser profile seeded with the same legacy data. Both previous entries appeared and the legacy database was deleted. After signing out and back in, each entry appeared once and the legacy database was still gone.

### V9. Offline and server outage
- [x] V9.1: offline (with the service worker active), a reload opened Today with the user's data, and manual logging worked. AI lookup shows "Offline – sign in or reconnect to use AI lookup".
- [x] V9.2 (offline grace): with PostgreSQL stopped, a signed-in browser reloaded into Today with its data, and manual logging worked.
- [x] V9.2 (sign-in message): passed after a fix, on the rerun. A sign-in attempt during the outage shows "Sign-in is temporarily unavailable.", and `/api/health` with a session cookie returns 503 `service_unavailable` with no exception details.
  - The signed-out sign-in screen shows no notice until the person tries to sign in. That's expected: the anonymous session check never touches the database, so the server can't know it's down until a sign-in needs it.
  - **First run failed:** the same attempt showed the generic "Could not sign in. Check your details and try again.", which tells the person their details are wrong when the server is down.
    - Every database outage reached `UseExceptionHandler` as an unhandled exception (Npgsql connection refused, sometimes wrapped by EF Core in `InvalidOperationException`), so the API returned a generic `500`, which the client maps to `unknown`.
    - auth-api.yaml says `503 service_unavailable` ("The identity database is unreachable"), and `Problems.ServiceUnavailable()` existed but nothing called it.
  - **Fix:** `Data/DatabaseUnavailableHandler.cs`, an `IExceptionHandler` registered in `Program.cs`, turns a transient `NpgsqlException` (possibly wrapped) on `/api` into `503 service_unavailable`. Every other error stays the generic 500 (FR-031).
    - The client already mapped `service_unavailable` to "Sign-in is temporarily unavailable.", so no client change was needed.
    - The tests came first: `Security/DatabaseOutageTests.cs` has 5 tests (session check, sign-in from an open screen, a signed-in request with a bare or wrapped error, and a non-outage database error that stays 500). 4 of them failed before the fix.

### V10. Session expiry mid-review
- [x] With `IdleTimeout=00:01:00`, an AI estimate showed the review. Next:
  1. A new description was typed, and 2 minutes passed.
  2. Estimate brought up the "Sign in again" overlay.
  3. After signing in, the typed draft was still there.

### V11. Quotas
- [x] V11.1: with `PerUserDaily=2`, the first two lookups were reviewed. The third showed "You've reached today's AI lookup limit. It resets at 7:00 PM. You can still add food manually." That is 00:00 UTC in local time, and the wording of tasks.md T094; the quickstart only paraphrases it. Manual entry then still worked.
- [x] V11.2: with `GlobalDaily=1`, `val-b` was refused with "AI lookup has reached its overall limit for now. It resets at Oct 18, 2026, 7:00 PM. …". `ai_usage_today.ceiling_hit_at` was set (10:47:26), matching the `ceiling_hit` audit row.

### V12. Production hardening smoke check
Checked locally (Testing environment, `AllowedHosts=localhost`). The live-host run is part of T126.
- [ ] V12.1: HTTP→HTTPS 308. Production only, so it can't be checked locally. It is covered by `ProductionHardeningTests` (T111) and is deferred to T126 on the deployed host.
- [x] V12.2: `/` carries every header from http-hardening.md:
  - CSP, in its non-Production form (adds `ws://localhost:5173`, no `upgrade-insecure-requests`);
  - `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, COOP, CORP and `Permissions-Policy`;
  - `Cache-Control: no-store` on `/` and `/api/*`.

  There is no `Server`, `X-Powered-By` or `Access-Control-*` header. HSTS is Production only (T111, then T126).
- [x] V12.3: a `POST /api/auth/sign-in` with `Origin: https://evil.example` returned 403 `csrf_failed`.
- [x] V12.4: `Host: other.example` returned 400.
- [x] V12.5: as `macro_app` on local `macro_dev`, `insert into macro.users …` failed with "permission denied for table users". This is to be repeated in the Supabase SQL editor in T126.

### V13. Audit trail
- [x] `select * from macro_admin.recent_audit;` after every scenario above. Each FR-024 event has rows with a time and, where the account is known, the account:

  | FR-024 event | Audit rows |
  |---|---|
  | Sign-in success and failure | `sign_in` with `success`, or `failure` with `bad_credentials` or `account_disabled` |
  | Lockouts | `sign_in_locked` with the account (after the fix below), and `rate_limited` |
  | Sign-out | `sign_out` |
  | Session revocation | `sign_out_everywhere` (V4.2), and `session_revoked` from the owner's `revoke_sessions('val-b')`, run for this check |
  | Account disable and reset | `account_disabled`, `account_enabled`, `account_reset`, `account_unlocked`, `account_invited` |
  | Password and second-step changes | `setup_started`, `password_set`, `password_rejected`, `totp_enrolled`, `ai_notice_acknowledged` |
  | Limit hits | `quota_exceeded` with `quota_user_daily` or `quota_global_daily`, `ceiling_hit` and `rate_limited` |

  - Rows with no account are expected: sign-ins with unknown names, and `rate_limited`, which is keyed by the typed name and never stores it (data-model.md). The global `ceiling_hit` has no account either.
  - `totp_failed` did not occur: it is written only when a setup session runs out of code attempts, which no scenario does. `AuditCoverageTests` covers it.
- [x] No passwords, codes, tokens or food text. A regex scan of every column of every `macro.audit_events` row matched 0 rows. It looked for:
  - the run's passphrase, `password1234` and the temporary codes;
  - the logged foods;
  - `otpauth`, `__Host-` and any 32-character base32 setup key.
- [x] Lockout audit fixed. The first V13 read found no lockout row tied to `val-c`. After V3.1, the audit had 10 `bad_credentials` rows and then only `rate_limited` rows with no account, so the record did not say which account was locked.
  - **Cause:** the name throttle and the account lockout both trip at 10 failures, and the throttle is checked first. `sign_in_locked` was written only when a locked account got past the throttle, in practice only after an app restart.
    - `AuditScenario` hid this by raising `PerUsernameFailures` to 100.
  - **Fix:** `SignInService.RecordFailure` now writes `sign_in_locked` (reason `locked`) with the account when the 10th failure sets the lockout. Responses are unchanged, so a lockout still looks the same as a throttled unknown name (FR-006).
    - The new test, `A_lockout_is_audited_against_the_account_when_it_starts_with_the_default_limits`, came first and failed before the fix.
    - `The_account_lockout_survives_a_restart` now expects 2 `sign_in_locked` rows: one when the lockout starts, and one for the attempt refused after the restart.
  - **Confirmed live** on the Development backend: 11 wrong sign-ins for `val-c` gave 401 ten times, then 429. The audit shows 10 `bad_credentials` rows, then `sign_in_locked` (`locked`, `val-c`) on the 10th, then `rate_limited`. `val-c` was then unlocked.
