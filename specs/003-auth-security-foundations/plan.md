# Implementation Plan: Auth & Security Foundations

**Branch**: `003-auth-security-foundations` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-auth-security-foundations/spec.md`

## Summary

This feature turns the single-user, stateless macro counter into an invite-only app that can be
safely put on the public internet.

- **Identity store and auth.** The existing ASP.NET Core backend gains ASP.NET Core Identity
  (username + PBKDF2 password + TOTP). Data lives in a private schema of a **Supabase-hosted
  PostgreSQL** database, used only as a database ([R1](./research.md#r1-who-does-authentication-supabase-auth-or-the-aspnet-backend)).
- **Sessions.** Sessions are server-side: an `HttpOnly` `__Host-` cookie holds a random key, and
  the session row is checked on every request. Revocation is therefore immediate.
- **Deny by default.** Every endpoint requires a full session through a fallback authorization
  policy.
- **No account creation in the app.** Accounts are created, reset and disabled only by the owner,
  through SQL procedures in a `macro_admin` schema. The app's database role has no `INSERT` on
  users at all.
- **Abuse limits.** Sign-in is protected by three uniform rate-limit layers, and AI lookups by
  per-user and global quotas reserved in the database before Claude is called.
- **Audit trail.** Security events go to an insert-only audit table.
- **Browser hardening.** Strict headers (CSP, HSTS and others), CSRF tokens and origin checks.
- **Private local data.** Food data stays in the browser, now in **one IndexedDB database per
  account**. The pre-feature data is adopted once, by the owner.

## Technical Context

**Language/Version**: C# 14 / .NET 10 (LTS) backend; TypeScript 6.0 (strict) + React 19 frontend
(unchanged)

**Primary Dependencies**:
- Existing: ASP.NET Core Minimal APIs, `Anthropic`, Vite, `idb`, `zod`, `vite-plugin-pwa`.
- **New**: `Npgsql.EntityFrameworkCore.PostgreSQL`, `Microsoft.AspNetCore.Identity.EntityFrameworkCore`,
  `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore`, `Microsoft.EntityFrameworkCore.Design`
  (build only), `uqr` (frontend QR code). See [R13](./research.md#r13-new-dependencies-principle-v)
  for the reasons.
- Built-in framework pieces are used for cookies, antiforgery, rate limiting, HSTS and forwarded
  headers.

**Storage**:
- Server: Supabase PostgreSQL, schema `macro` (users, user_tokens, sessions, ai_usage_*,
  audit_events, data_protection_keys) and schema `macro_admin` (owner procedures and views). No food
  data.
- Client: IndexedDB `macro-counter.u.<userId>` per account, plus `macro-counter-device`.
- See [data-model.md](./data-model.md).

**Testing**:
- Backend: xUnit + `WebApplicationFactory`, run against a throwaway **local PostgreSQL 17**
  database as the least-privilege `macro_app` role ([R14](./research.md#r14-test-database-without-docker-fr-032-spec-environment)).
- Frontend: Vitest + React Testing Library + fake-indexeddb, and Playwright e2e against a local
  `macro_e2e` database.
- `FakeTimeProvider` is used for expiry and quota windows.
- Claude, HIBP and Supabase are never called from tests.

**Target Platform**:
- Browsers: unchanged.
- Server: Linux on **Azure App Service B1, single instance**, with managed HTTPS
  ([R15](./research.md#r15-hosting-spec-environment-fr-027)). Development stays on Windows.

**Project Type**: Web application (React SPA + ASP.NET Core API), the existing two projects

**Performance Goals**:
- Sign-in to Today in under 20 s, or under 30 s on first setup (SC-001). These times are mostly
  the person typing; the server time is under 500 ms p95 including one PBKDF2 verify (about
  100–200 ms at 210k iterations).
- The session check adds under 15 ms p95 per API call when the host and Supabase are in the same
  region.

**Constraints**:
- Revocation within 1 minute (SC-005); the design makes it immediate.
- Lockout after 10 failures in 15 minutes (SC-006).
- Local logging works offline and during server outages (Principle III).
- No secrets in the repository, bundle or logs.
- Strict CSP with no `'unsafe-inline'`.
- One app instance, because of the in-memory limiters.

**Scale/Scope**:
- Under 20 accounts and about 30 AI lookups per user per day.
- New screens: Sign in, Setup (password → authenticator → notice), and an account menu (sign
  out / sign out everywhere).
- 9 new API endpoints (see [contracts/auth-api.yaml](./contracts/auth-api.yaml)).

No NEEDS CLARIFICATION remains. All unknowns (auth provider, hashing, MFA, session design,
provisioning, limits, CSRF/CORS, hosting, test database without Docker) are resolved in
[research.md](./research.md) R1–R16.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. Test-First** | Every security behavior gets a failing test first. FR-032's list is covered: unauthenticated access, expired/revoked sessions, disabled accounts, cross-user access, sign-in rate limits, quotas, no sign-up route. The owner procedures and grants are tested against real PostgreSQL. `/speckit-tasks` must order each test before its implementation. | ✅ Planned |
| **II. Correct Nutrition Math** | Not touched. The nutrition modules and their 100% coverage gates are unchanged. | ✅ N/A |
| **III. Local-First, Sync-Ready** | The server stores no food data (FR-019). There is one IndexedDB database per user ID (separate DB, not a key prefix). Sign-out keeps the data but locks it. The new `DeviceRepository` sits behind the storage abstraction. The device DB is versioned with a tested migration. Legacy adoption is tested. Offline use works for a previously signed-in account. | ✅. ⚠️ Data export is still a separate feature, as in 001; nothing new here |
| **IV. Fast Logging (Desktop & Mobile)** | The sign-in and setup screens work at 360 px with touch targets of at least 44 px, and the authenticator code field uses the numeric keyboard. Logging still takes at most 3 interactions once signed in. The 24-hour idle and 7-day sessions avoid re-entering a code every day ([R5](./research.md#r5-sessions-storage-lifetime-revocation-fr-009--fr-012-sc-005)). | ✅ |
| **V. Simplicity** | Every new dependency is justified in R13. No admin UI and no self-service recovery. Header middleware is written by hand instead of a package. No router library. | ✅. New server-side state is recorded under Complexity Tracking |
| **VI. AI Lookup** | AI endpoints now require auth, a per-user burst limit, a per-user daily cap and global daily and monthly ceilings, all checked before the Claude call. Errors are clear, and manual entry is unaffected. The single AI client module, schema validation and model config are unchanged. The user's identity is never sent to Anthropic. | ✅ |
| **VII. Security & Auth** | Point by point: | |
| ‣ Access | Invite-only through owner-issued, **single-use, expiring** temporary codes, which are the constitution's "invites" ([R6](./research.md#r6-provisioning-invite-only-accounts-in-the-database-fr-002-fr-003-fr-008-sc-011)). No sign-up anywhere, enforced by tests and by database grants. A fallback policy requires auth, and the public endpoints (health, session, sign-in) are explicit and tested. | ✅ |
| ‣ Credentials | PBKDF2-SHA512 at 210k iterations plus TOTP, with HIBP k-anonymity checks that fail closed. No plaintext passwords stored or logged. Only vetted Identity and Data Protection code; no hand-rolled crypto. | ✅. PBKDF2 is the constitution's "strong password hash" (it names Argon2id/bcrypt only as examples). Reason in R2 |
| ‣ Sessions | Short-lived and server-revocable, in an `HttpOnly; Secure; SameSite=Strict; __Host-` cookie. Sign-out and sign out everywhere both work. Antiforgery tokens on all unsafe requests. | ✅ |
| ‣ Authorization | Every request is tied to the session's user ID, and endpoints never take a user ID as input, so a cross-user request cannot even be expressed. There is a distinct `owner` role. The owner's duties (invites, disabling, viewing usage) are done through `macro_admin` procedures and views, which a regular user cannot reach. | ✅. The owner role's powers live in the database, not in app endpoints, by spec decision (no admin UI). The owner-procedures runbook says the same |
| ‣ Transport & hardening | HTTPS only with HSTS, a strict CSP, nosniff, Referrer-Policy and frame-ancestors. No CORS middleware, so there is no `*`. `AllowedHosts` is the real host in production. See [contracts/http-hardening.md](./contracts/http-hardening.md). | ✅. `appsettings.json` currently has `AllowedHosts: *`; production overrides it |
| ‣ Abuse resistance | Sign-in, setup (invite redemption) and AI endpoints are rate limited, with lockout after repeated failures. Sizes and types are validated on the server. | ✅ |
| ‣ Secrets & config | The connection string, Anthropic key and Data Protection certificate come from User Secrets (dev) or App Settings / Key Vault (production). Production config has no developer exception page and no `*` hosts. | ✅ |
| ‣ Supply chain | NuGet lock files are turned on (they are **new**; the repo has none today). The `dotnet list package --vulnerable` and `npm audit` checks and a secret scan are added to `scripts/check.ps1`. **CI** (new, `.github/workflows/ci.yml`) runs that script on every pull request and push to `master` (R13). | ✅ Planned. Making the check required needs branch protection on `master`, a repository setting the owner turns on |
| ‣ Logging & privacy | The insert-only audit table covers every event in FR-024. The schema allows only reason codes, never free text, and an automated scan checks for secrets. | ✅ |
| ‣ Threat model | See below. | ✅ |
| ‣ Accountability | The setup notice tells each friend what is sent to Claude and that the owner runs the server, and it must be acknowledged before any AI lookup. The owner can disable an account and revoke its sessions immediately. | ✅ |
| **Tech Constraints: Storage** | The server-side store holds identity and security data only, and Supabase was chosen in this plan as the constitution allows. | ✅ |
| **Tech Constraints: Privacy** | HIBP receives only 5 hex characters of a SHA-1 hash. No user data goes to any third party. Claude requests are unchanged and carry no user identity. | ✅ |
| **Governance** | A security review (`/security-review` plus an ASVS L2 pass) must happen before anyone other than the owner is invited (quickstart, Production deployment step 4). | ✅ Planned |

**Gate result (pre-research)**: PASS. **Post-design re-check (after Phase 1)**: PASS. The data
model has no food entities on the server. The contracts declare an access level for every endpoint.
The grants make account creation impossible from the app. No new violations.

### Threat model (Principle VII; baseline OWASP ASVS L2 / Top 10)

**Assets**:
1. The owner's Claude API key and budget.
2. Account credentials (password hashes, TOTP secrets, temporary codes).
3. Session keys.
4. Each person's local food data (health information).
5. The audit trail.

**Trust boundaries**:
1. Browser ↔ App Service (public internet, TLS).
2. App Service ↔ Supabase PostgreSQL (TLS VerifyFull, network-restricted).
3. App Service ↔ Anthropic and HIBP (outbound TLS).
4. Owner ↔ Supabase dashboard (the owner's own Supabase account, which must use MFA).
5. Person ↔ person on a shared browser.

| # | Threat (OWASP category) | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Anonymous use of AI endpoints spends the budget (A01) | Fallback deny policy and an endpoint-inventory test; quotas reserved before the call; global monthly ceiling | Worst-case spend is bounded by `GlobalMonthly` |
| T2 | Credential stuffing or guessing (A07) | Breached-password rejection; 3 rate-limit layers; TOTP required; generic errors; even timing | An attacker can deliberately lock an account (the owner unlocks it) |
| T3 | Username enumeration (A07) | Identical response and timing for unknown, disabled and incomplete accounts; the per-username limiter applies to names that don't exist | — |
| T4 | Session theft by XSS or a stolen cookie (A03/A07) | `HttpOnly` `__Host-` cookie; strict CSP with no inline scripts; React escaping; the key is stored hashed; idle and absolute expiry; sign out everywhere | A stolen device with an open browser session (until expiry or revocation) |
| T5 | CSRF or login CSRF (A01) | `SameSite=Strict`; antiforgery token on every unsafe request, including sign-in; Origin and `Sec-Fetch-Site` checks | — |
| T6 | Cross-user data access (A01) | No endpoint takes a user ID; all queries are keyed by the session's user; local data in separate per-user databases | Someone with DevTools access on a shared profile can read IndexedDB (R9) |
| T7 | Compromised app process creates or re-enables accounts (A04) | `macro_app` has no `INSERT` on users and no `UPDATE` on role or disabled_at; `macro_admin` is owner-only | A compromised process could still read hashes and TOTP secrets. Those secrets are encrypted with Data Protection, whose keys are certificate-protected in production. |
| T8 | Supabase Data API or other DB exposure (A05) | Data API off; private schema; RLS with no policies; grants revoked from anon and authenticated; Network Restrictions; TLS VerifyFull | A compromise of the owner's Supabase account (mitigated by MFA on that account) |
| T9 | Secret leakage through the repo, logs or errors (A02/A09) | Secrets only from config or Key Vault; ProblemDetails with no internals; no body or cookie logging; audit schema allows reason codes only | — |
| T10 | Temporary-code interception (A07) | 100-bit random code, single use, 72-hour expiry, hash stored; given out in person or over a trusted channel | The friend has to treat the code as secret until they use it |
| T11 | TOTP replay or brute force (A07) | Replay guard; codes count toward the lockout; 5 attempts per setup session | — |
| T12 | Clickjacking, MIME sniffing, referrer leaks (A05) | `frame-ancestors 'none'`, XFO, nosniff, `no-referrer` | — |
| T13 | Vulnerable dependencies (A06) | Lock files; vulnerability scans in the gate (high or critical blocks merging) | Zero-day vulnerabilities |
| T14 | Shared-browser exposure after sign-out (privacy) | `no-store` on HTML; the `pageshow` session re-check; reload on sign-out; the active-account marker is cleared | A person who never signs out leaves their data open to the next user of that browser profile |

## Project Structure

### Documentation (this feature)

```text
specs/003-auth-security-foundations/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R16
├── data-model.md        # Phase 1: server tables, grants, state machine, browser storage changes
├── quickstart.md        # Phase 1: setup, test commands, validation scenarios V1–V13, deployment
├── contracts/
│   ├── auth-api.yaml          # OpenAPI 3.1: auth, setup, session, health; security on /estimates
│   ├── owner-procedures.md    # macro_admin SQL procedures, views and owner runbook
│   └── http-hardening.md      # Required headers, refused requests, logging rules
├── checklists/
└── tasks.md             # Phase 2 output (/speckit-tasks; NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── MacroCounter.Api/
│   ├── Program.cs                     # + auth, fallback policy, rate limiter, headers, forwarded headers
│   ├── appsettings.json               # + Security:*, Limits:* (defaults from research)
│   ├── appsettings.Production.json    # NEW: AllowedHosts, AllowedOrigins, HSTS on
│   ├── certs/supabase-root-ca.crt     # NEW: public CA for SSL VerifyFull
│   ├── packages.lock.json             # NEW (lock files turned on)
│   ├── Data/
│   │   ├── IdentityDbContext.cs       # schema "macro", explicit snake_case mapping, DP keys
│   │   └── Migrations/                # EF migrations + raw SQL: grants, RLS, macro_admin.*
│   ├── Auth/
│   │   ├── AppUser.cs
│   │   ├── AuthEndpoints.cs           # /auth/session, sign-in, setup/*, sign-out(-everywhere)
│   │   ├── SignInService.cs           # combined password+TOTP check, temp code, even timing
│   │   ├── SetupService.cs            # password → totp → notice state machine
│   │   ├── PasswordPolicy.cs          # length, username check, NFKC
│   │   ├── BreachedPasswordChecker.cs # IBreachedPasswordChecker → HIBP range API
│   │   ├── EncryptedUserStore.cs      # UserOnlyStore with an encrypted authenticator key and replay guard
│   │   ├── PostgresTicketStore.cs     # ITicketStore: hashed keys, idle/absolute/stamp/disabled checks
│   │   ├── SignInThrottle.cs          # per-username sliding window (uniform for unknown names)
│   │   └── AccessPolicies.cs          # FullSession (fallback), SetupSession, AnySession
│   ├── Security/
│   │   ├── SecurityHeadersMiddleware.cs
│   │   ├── OriginCheckMiddleware.cs
│   │   ├── CsrfEndpointFilter.cs
│   │   └── SecurityOptions.cs
│   ├── Usage/
│   │   ├── AiQuotaService.cs          # transactional reservation (user daily, global daily/monthly)
│   │   └── LimitsOptions.cs
│   ├── Audit/
│   │   └── AuditLog.cs                # insert-only, closed set of event types and reasons
│   ├── Endpoints/                     # EstimateEndpoints: + quota filter; Problems: + new codes
│   └── Ai/ Contracts/ Nutrition/      # unchanged
└── MacroCounter.Api.Tests/
    ├── Infrastructure/                # PostgresFixture (MACROCOUNTER_TEST_PG), ApiFactory + sign-in helpers
    ├── Auth/                          # sign-in, setup, sessions, lockout, throttle, password policy
    ├── Security/                      # endpoint inventory, no-sign-up routes, headers, CSRF/origin, errors
    ├── Usage/                         # quotas incl. concurrency and day/month boundaries
    ├── Audit/                         # every event type, secret/food scan
    ├── Database/                      # owner procedures and macro_app grants
    └── Endpoints/ Ai/ Nutrition/      # existing, updated to sign in first

frontend/
├── src/
│   ├── api/http.ts                    # NEW: shared fetch (CSRF header, 401 → session-expired event)
│   ├── api/auth.ts                    # NEW: session, sign-in, setup, sign-out clients (zod-validated)
│   ├── api/estimates.ts, status.ts    # use http.ts; + quota_exceeded / unauthenticated handling
│   ├── auth/
│   │   ├── authMachine.ts             # pure AuthState transitions (fully unit-tested)
│   │   ├── AuthGate.tsx               # launch logic: online session / offline grace / sign-in
│   │   ├── SignInScreen.tsx
│   │   ├── SetupFlow.tsx              # password → authenticator (uqr QR) → notice
│   │   ├── SessionExpiredOverlay.tsx  # re-auth without losing review drafts
│   │   └── AccountMenu.tsx            # sign out / sign out everywhere
│   ├── data/
│   │   ├── db.ts                      # openDb(name) reused with a per-user name
│   │   ├── deviceRepository.ts        # NEW: active account + legacyAdopted (versioned)
│   │   └── legacyAdoption.ts          # NEW: owner-only, copy-verify-delete
│   ├── main.tsx                       # builds per-user Services after AuthGate resolves
│   └── App.tsx                        # + account menu entry
└── tests/
    ├── unit/auth/, unit/data/         # authMachine, deviceRepository, legacyAdoption, http.ts
    ├── components/                    # SignInScreen, SetupFlow, AuthGate, SessionExpiredOverlay
    └── e2e/                           # setup, two-account isolation, sign-out/back, offline, quota

scripts/
├── check.ps1        # + locked restore, vulnerability scans
├── dev-db.ps1       # NEW: create macro_dev + macro_app, apply migrations, set user secret
└── e2e-db.ps1       # NEW: reset and seed macro_e2e
```

**Structure Decision**: Keep the existing two projects (`backend/` ASP.NET Core and `frontend/`
React). Server code is organized by concern (`Auth/`, `Security/`, `Usage/`, `Audit/`, `Data/`),
like the existing `Ai/` and `Nutrition/`. Frontend auth UI goes in a new `src/auth/` feature
folder. Storage changes stay in `src/data/` behind the repository interfaces.

## Glossary

| Term | Meaning |
|---|---|
| Temporary credential (spec) = temporary code (plan) = invite (constitution) | The one-time, 72-hour code `macro_admin.invite_user` or `reset_user` returns. It is single-use and only its SHA-256 hash is stored. |
| Setup session / full session | A setup session exists only during first-time setup (15 minutes) and reaches only the setup endpoints. A full session is a normal signed-in session. |
| Owner | The one account with `role = 'owner'`, and the person who runs the `macro_admin` procedures in the Supabase SQL editor. |
| App role (`macro_app`) | The least-privilege database login the backend uses. It cannot create users, change roles or read the audit table. |

## Spec Follow-ups

These are proposed spec edits that come out of planning. None blocks implementation.

1. **FR-018 wording**: ✅ Done 2026-10-14, as decided by the owner. FR-018 now reads "adopted only
   by the owner account", matching US4 scenario 3, so a friend can never get the owner's health
   data ([R9](./research.md#r9-per-account-local-data-on-a-shared-browser-fr-016--fr-018-sc-007)).
2. **Notice step**: the constitution's Accountability rule adds a "What is sent to Claude"
   acknowledgement to first-time setup. The spec could list it under FR-004.
3. **LAN HTTP phone access** (from 001) goes away, because `__Host-`/`Secure` cookies need HTTPS
   off `localhost`. Phones use the deployed HTTPS site. Update the README when implementing.

## Complexity Tracking

| Violation / added complexity | Why needed | Simpler alternative rejected because |
|---|---|---|
| The backend is no longer stateless: there is a server-side database (Supabase PostgreSQL) | Identity, sessions, quotas and audit must be persistent and shared (FR-003, FR-009, FR-021, FR-024). The constitution v2.0.0 permits it. | Keeping it stateless (signed tokens, in-memory quotas) cannot revoke sessions immediately, loses quotas on restart, and has nowhere for the owner to add users |
| EF Core + Identity + Data Protection EF (4 new packages) | Vetted password, lockout, TOTP and key-ring handling (VII forbids hand-rolled crypto) | A hand-written Npgsql store re-implements security-critical code. Supabase Auth fails the username, cookie and revocation requirements (R1). |
| Three sign-in throttling layers | Uniform responses to prevent enumeration (FR-006), restart-proof lockout (SC-006), and per-IP flood control (FR-020) | One layer alone either leaks whether an account exists or resets on restart |
| A separate local test PostgreSQL (no Docker) | Tests must exercise real SQL, grants and locking without touching the live database | SQLite or InMemory cannot run the owner procedures or the grants; Docker is not available (R14) |
