# Quickstart & Validation: Auth & Security Foundations

This guide covers how to set the feature up locally, run the tests, and check each user story by
hand. For the contracts, see [auth-api.yaml](./contracts/auth-api.yaml),
[owner-procedures.md](./contracts/owner-procedures.md) and
[http-hardening.md](./contracts/http-hardening.md). For the data shapes, see
[data-model.md](./data-model.md).

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| .NET SDK | 10.x | Backend |
| Node.js | 24.x | Frontend |
| PostgreSQL | 17.x local (`winget install PostgreSQL.PostgreSQL.17`) | The test and dev identity store. Docker is **not** required (R14). |
| `dotnet-ef` | 10.x (`dotnet tool install --global dotnet-ef`) | Generates migration SQL |
| An authenticator app | Any app that supports TOTP | For manual validation |
| Supabase project | Free tier is fine | **Production only.** Not used by tests or local development. |

## Local setup (once)

1. Install PostgreSQL 17 and note the `postgres` password. In your own terminal, set the test
   admin connection string:
   `setx MACROCOUNTER_TEST_PG "Host=localhost;Username=postgres;Password=<pw>"`
2. Create the dev database and apply the migrations as the owner:
   `scripts/dev-db.ps1`. It creates `macro_dev` and the `macro_app` role, applies the idempotent
   migration script, and puts the `macro_app` connection string in User Secrets as
   `ConnectionStrings:Identity`.
3. Invite yourself as the owner (in `psql -d macro_dev`):
   `select macro_admin.invite_user('<you>', 'owner');` and write down the code.
4. Run the app as before (README). Use `http://localhost:5080`, or Vite on `:5173`. The `__Host-`
   cookies need a secure context, and `localhost` counts as one. **Phone access over LAN HTTP no
   longer works**; use the deployed HTTPS site instead (plan, Spec Follow-ups).

## Automated tests (the merge gate)

`scripts/check.ps1` runs all of these. Claude, HIBP and Supabase are never contacted.

| Suite | Command | Covers |
|---|---|---|
| Backend | `dotnet test backend` (needs `MACROCOUNTER_TEST_PG`) | Endpoint inventory (SC-003/004), sign-in and lockout (SC-006), sessions and revocation (SC-005), cross-user access, quotas (SC-008), audit content scan (SC-009), headers, CSRF and origin, owner procedures and grants |
| Frontend unit/component | `npm --prefix frontend test` | Auth state machine, sign-in and setup screens, `DeviceRepository`, legacy adoption, session-expired overlay that keeps drafts |
| End-to-end | `scripts/e2e-db.ps1; npm --prefix frontend run e2e` | Full first-time setup, two-account isolation (SC-007), sign-out and Back, offline grace, quota message plus manual entry |
| Supply chain | `dotnet list backend package --vulnerable --include-transitive`, `npm --prefix frontend audit --audit-level=high` | SC-010 (0 high or critical findings) |

The e2e database script invites `e2e-owner` and `e2e-friend`, and writes their temporary codes to
an untracked file that the tests read. The tests read the TOTP setup key from the setup screen
and compute codes with a small `node:crypto` helper.

## Manual validation scenarios

Run these against the local app. Expected results are in **bold**.

### V1. First-time setup (US1.5, US2.3, SC-001, SC-002)
1. Open the app signed out. **The sign-in screen has no sign-up, register or "request invite"
   option.**
2. Enter your username and the temporary code, and leave the code field empty. **You get "Choose
   a password".**
3. Try `password1234`. **It is rejected as a known breached password.** Try a password that
   contains your username. **It is rejected.**
4. Set a strong password. **A QR code, the setup key and an "open in authenticator" link
   appear.** Enter a wrong code. **You see "Code didn't match" with the attempts left.** Enter
   the right code.
5. **The "What is sent to Claude" notice appears.** Acknowledge it. **You land on Today**, and all
   of this takes under 30 seconds after the code is scanned.
6. Sign out, then sign in with the temporary code again. **You get the generic "Could not sign
   in"** (the code was single-use).

### V2. Normal sign-in and generic failures (US1.1, US1.2, FR-006)
1. Sign in with username, password and code. **You reach Today in under 20 seconds.**
2. Try each of these: a wrong password, an unknown username, a wrong code, and no code. **Every
   case shows the same message**, and the response time is about the same.
3. Enter ` YOU ` (spaces and capitals) with the right credentials. **You are signed in.**

### V3. Brute force (US5.1, SC-006)
1. Make 10 wrong attempts for your username. **The 11th attempt, even with correct credentials,
   shows "Too many attempts. Try again later."**
2. Do the same for a username that doesn't exist. **The behavior and message are identical.**
3. Run `select macro_admin.unlock_user('<you>');` and wait out the 15-minute window, or restart
   the app. **Sign-in works.**

### V4. Sign-out, Back, and sign out everywhere (US1.3, FR-011)
1. Sign in on two browsers, A and B. In A, choose **Sign out**. **A shows sign-in. Pressing Back
   shows no signed-in screen.**
2. In B, choose **Sign out everywhere**, then try an AI lookup in a browser that was still signed
   in. **You are asked to sign in.**

### V5. Owner disables and resets (US2.4, US2.5, SC-005, SC-011)
1. While a friend's session is active, run `select macro_admin.disable_user('<friend>');`. **Their
   next action that talks to the server shows the sign-in screen (no crash), and sign-in fails
   generically.**
2. Run `enable_user`, then `reset_user`, and give the new code. **The friend repeats V1 steps
   2–5.** Each owner task takes under 5 minutes.

### V6. Deny by default (US3, SC-003)
1. `curl -i -X POST http://localhost:5080/api/estimates/text -H "Content-Type: application/json" -d "{\"description\":\"egg\"}"`
   **Returns 401 (or 403 csrf_failed). No Claude call is made: the estimator mock or log shows
   no call.**
2. `curl -i http://localhost:5080/api/status`. **Returns 401.**
   `curl -i http://localhost:5080/api/health`. **Returns 200 `{"status":"ok"}` and nothing else.**

### V7. Two people on one browser (US4, SC-007)
1. As A, log 2 entries and set a goal. Sign out.
2. Sign in as B. **B's Today screen is empty: no entries, recent foods or goal from A.** B logs
   1 entry. Sign out.
3. Sign in as A. **All of A's data is there, and B's entry is not.**

### V8. Legacy data adoption (US4.3, FR-018)
1. On a browser profile that still has data from before this feature (the `macro-counter`
   IndexedDB), sign in first as a **regular user**. **Nothing is adopted, and the user starts
   empty.** Sign out.
2. Sign in as the **owner**. **All the previous entries, saved foods and goals appear.** Sign
   out and back in. **There are no duplicates. The legacy database is gone (DevTools →
   Application).**

### V9. Offline and server outage (Edge cases, Principle III)
1. While signed in, go offline (DevTools) and reload. **Today opens with your data, and manual
   logging works. AI lookup says to reconnect or sign in.**
2. Stop PostgreSQL and reload while online. **The same offline grace applies, and the sign-in
   screen (if shown) says the service is temporarily unavailable.**

### V10. Session expiry mid-review (US1.4, edge case)
1. Set `Security:Session:IdleTimeout` to `00:01:00`, get an AI estimate, wait 2 minutes, then
   request another estimate. **A sign-in overlay appears. After you sign in, the review draft is
   still there.**

### V11. Quotas (US5.2, US5.3, SC-008)
1. Set `Limits:Ai:PerUserDaily` to `2`. Make 3 lookups. **The 3rd shows "Daily AI limit reached,
   resets at <local time>", and manual entry still works.**
2. Set `GlobalDaily` to `1` and use a second account. **That account is refused with the overall
   limit message. `macro_admin.ai_usage_today` shows `ceiling_hit_at`.**

### V12. Production hardening smoke check (US7, SC-010)
Against the deployed HTTPS URL:
1. `curl -sI http://<host>/` **returns a 308 (or 301) redirect to HTTPS.**
2. `curl -sI https://<host>/` **includes every header in http-hardening.md, with no `Server`
   header.**
3. `curl -si -X POST https://<host>/api/auth/sign-in -H "Origin: https://evil.example" -H "Content-Type: application/json" -d "{}"`
   **returns 403 csrf_failed.**
4. `curl -si https://<host>/api/health -H "Host: other.example"` **returns 400.**
5. In the Supabase SQL editor, as `macro_app`:
   `insert into macro.users(id, username) values (gen_random_uuid(), 'x');` **fails with
   permission denied.**

### V13. Audit trail (US6, SC-009)
After V1–V5 and V11, run `select * from macro_admin.recent_audit;`. **There is one row per event
type listed in FR-024, each with a time and the account where known. No passwords, codes, tokens
or food text appear anywhere** (the automated scan also checks this).

## Production deployment (reference: Azure App Service, R15)

1. **Supabase**:
   - Create a project in the host's region.
   - Turn **off** the Data API.
   - Turn on Network Restrictions (the host's outbound IPs plus your own IP).
   - Apply `dotnet ef migrations script --idempotent` in the SQL editor.
   - Create the `macro_app` password.
   - Enable `pg_cron` and schedule `macro_admin.purge_expired()`.
2. **App Service** (Linux B1, one instance, Always On, HTTPS Only). Put these in App Settings,
   preferably as Key Vault references; none of them go in the repository:
   - `ConnectionStrings__Identity`: Supavisor session pooler, user `macro_app.<ref>`,
     `SSL Mode=VerifyFull`
   - `Anthropic__ApiKey`
   - `DataProtection__CertificatePfxBase64` and `DataProtection__CertificatePassword`
   - `Security__AllowedOrigins__0=https://<host>`
   - `AllowedHosts=<host>`
   - `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`
3. `npm --prefix frontend run build; dotnet publish backend/MacroCounter.Api -c Release`, then
   zip-deploy the output.
4. Run V12, then `/security-review` and the ASVS L2 checklist **before** inviting anyone other than
   the owner (Constitution: Governance).
