# ASVS Level 2 Checklist: Auth & Security Foundations (T126)

**Purpose**: Check feature 003 against OWASP ASVS 4.0.3 Level 2 before anyone other than the owner is invited (Constitution: Governance)
**Date**: 2026-10-21
**Feature**: [spec.md](../spec.md) · threat model in [plan.md](../plan.md#threat-model-principle-vii-baseline-owasp-asvs-l2--top-10)
**Source**: the official ASVS 4.0.3 requirement list (`OWASP/ASVS` tag `v4.0.3`, `4.0/docs_en/…-en.csv`), every requirement marked Level 2 in chapters V2, V3, V4, V5, V7, V8, V13 and V14 (173 requirements).

## How to read this

- **Met**: the requirement holds. The evidence is a file, a test or a contract.
- **N/A**: the app has no such feature (for example SMS, OAuth, SOAP or GraphQL).
- **Met (fixed, Gn)**: it was a gap in the first pass and was fixed for T126; Gn is under [Gaps and decisions](#gaps-and-decisions).
- **Risk-accepted**: it doesn't hold, and the owner accepted that in writing ([plan.md](../plan.md#accepted-risks-t126-asvs-level-2)). "(partial)" means it partly holds.
- **Partial**: it mostly holds; the row says what differs and why that is accepted.
- **Deploy**: met by a step in [docs/deploy.md](../../../docs/deploy.md). It is confirmed on the live host as part of T126.
- **Met (live)**: a Deploy row confirmed on the live host.

Paths are relative to `backend/MacroCounter.Api/` unless they start with `frontend/` or `specs/`.

## Security review

`/security-review` ran on the branch on 2026-10-21. It found one issue, which was fixed:

- **Second factor skipped at the notice step** (Medium, authentication bypass).
  - **Problem:** an invitee could confirm their authenticator but never acknowledge the "What is sent to Claude" notice. Then, until the 72-hour setup deadline, the password alone resumed setup at the notice step, and acknowledging the notice issued a full session. The enrolled authenticator was never asked for.
  - **Fix:** `Auth/SignInService.cs` (`SignInDuringSetup`) now requires a valid, unused authenticator code once `TwoFactorEnabled` is true. A missing or wrong code is a normal generic failure and counts toward the lockout.
  - **Tests:** written first, they failed before the fix.
    - `SignInServiceTests.Once_the_authenticator_is_confirmed_resuming_setup_needs_the_code`
    - `AuthEndpointsTests.A_setup_left_at_the_notice_cannot_be_finished_with_the_password_alone` reproduces the attack over HTTP.
  - **Docs:** `contracts/auth-api.yaml` and T020 in tasks.md were updated.

No other finding met the review's confidence bar.

## V2 Authentication

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | Met | `Auth/PasswordPolicy.cs` (`MinLength` 12, counted in Unicode code points after NFKC) |
| 2.1.2 | 64 allowed, over 128 denied | Met | `MaxLength` 128 (`appsettings.json`); `PasswordPolicyTests` |
| 2.1.3 | No truncation | Met | The whole normalized password is hashed (`PasswordPolicy.Normalize`, `SignInService.VerifyPassword`) |
| 2.1.4 | Any printable Unicode allowed | Met | No character rules; NFKC so visually equal input matches |
| 2.1.5 | Users can change their password | Met (fixed, [G1](#g1-no-self-service-password-change-215-216-333)) | `POST /api/auth/password` from the account screen (`Auth/AuthEndpoints.cs`, `frontend/src/auth/ChangePasswordForm.tsx`); `PasswordChangeTests`, e2e `password-change.spec.ts` |
| 2.1.6 | Change needs current and new password | Met (fixed, G1) | Needs the current password **and** an unused authenticator code (`SetupService.ChangePasswordAsync`) |
| 2.1.7 | Breached-password check, k-anonymity | Met | `Auth/BreachedPasswordChecker.cs` (HIBP range API, 5-char SHA-1 prefix, padding, fail closed). Checked whenever a password is chosen. Sign-in doesn't re-check, but no password can be set without passing |
| 2.1.8 | Password strength meter | Risk-accepted | None; length and breach rules instead ([G2](#g2-no-strength-meter-and-no-show-password-218-2112)) |
| 2.1.9 | No composition rules | Met | Length, username and breach checks only (research R2) |
| 2.1.10 | No rotation or history rules | Met | None exist |
| 2.1.11 | Paste and password managers allowed | Met | Plain inputs with `autoComplete="current-password"` / `"new-password"` (`frontend/src/auth/SignInScreen.tsx`, `SetupFlow.tsx`) |
| 2.1.12 | Option to view the masked password | Met (fixed, G2) | Show/Hide on every password field (`PasswordInput` in `frontend/src/features/shared/FormBits.tsx`); `SignInScreen.test.tsx`, `SetupFlow.test.tsx` |
| 2.2.1 | Anti-automation; ≤100 failures per hour per account | Met | Three layers (`Security/RateLimits.cs`, `Auth/SignInThrottle.cs`, lockout in `SignInService`): at most 10 failures per 15 minutes, so at most 40 an hour. `SignInLimitTests` |
| 2.2.2 | Weak authenticators only as secondary | N/A | No SMS or email factor |
| 2.2.3 | Secure notifications on auth changes | Risk-accepted | The app stores no contact details, so it can't notify ([G3](#g3-no-security-notifications-223-255-285)) |
| 2.3.1 | Initial codes random, ≥6 chars, short expiry, not the long-term password | Met | `macro_admin.new_temporary_code` (100-bit random, 20 characters), 72-hour `setup_expires_at`, stored as SHA-256, single use; the person must choose a password (`SetupService`) |
| 2.3.2 | Support U2F/FIDO devices | Risk-accepted | TOTP only ([G4](#g4-no-webauthn--fido2-232)) |
| 2.3.3 | Renewal instructions for time-bound authenticators | N/A | No authenticator expires |
| 2.4.1 | Salted, hashed with an approved KDF | Met | ASP.NET Identity v3 hasher: PBKDF2-HMAC-SHA512, 128-bit salt (`Data/IdentityServices.cs`) |
| 2.4.2 | Salt ≥32 bits, unique per credential | Met | 128-bit random salt per hash (Identity v3 format) |
| 2.4.3 | PBKDF2 iterations ≥100,000 | Met | 210,000 (`Security:Password:Pbkdf2Iterations`) |
| 2.4.4 | bcrypt work factor | N/A | PBKDF2 is used |
| 2.4.5 | Extra KDF iteration with a secret salt (pepper) | Risk-accepted | No pepper ([G5](#g5-no-password-pepper-245)) |
| 2.5.1 | Activation secret not sent in clear text | Met | The owner hands the temporary code over in person or on a trusted channel (`contracts/owner-procedures.md`); the app never sends it |
| 2.5.2 | No hints or secret questions | Met | None |
| 2.5.3 | Recovery never reveals the current password | Met | `reset_user` clears the hash and issues a new temporary code |
| 2.5.4 | No shared or default accounts | Met | No seeded accounts; every account is invited by name (`InviteUser` migration) |
| 2.5.5 | User notified when a factor changes | Risk-accepted | As 2.2.3 ([G3](#g3-no-security-notifications-223-255-285)) |
| 2.5.6 | Secure recovery mechanism | Met | Recovery is the owner's `reset_user`. It ends every session, clears password and authenticator, and requires setup again with a new key (`OwnerProceduresTests`) |
| 2.5.7 | Lost MFA: identity proofing at enrolment level | Met | The owner knows every person and resets in person, the same as the original invite |
| 2.6.1–2.6.3 | Look-up secrets | N/A | No recovery codes |
| 2.7.1–2.7.6 | Out-of-band verifiers | N/A | No SMS, email or push codes |
| 2.8.1 | TOTP has a defined lifetime | Met | 30-second steps, accepted for at most a few steps around now (Identity `AuthenticatorTokenProvider`) |
| 2.8.2 | OTP keys highly protected | Met | Encrypted with Data Protection (`Auth/EncryptedUserStore.cs`). The key ring is encrypted with a certificate in Production (`Data/IdentityServices.cs`) |
| 2.8.3 | Approved algorithms for OTP | Met | RFC 6238 HMAC-SHA1, keys from the system CSPRNG (`GenerateNewAuthenticatorKey`) |
| 2.8.4 | TOTP usable once in its validity period | Met | `EncryptedUserStore.TryConsumeTotpAsync` (5-minute replay window); `EncryptedUserStoreTests` |
| 2.8.5 | Reused TOTP logged, rejected, holder notified | Risk-accepted (partial) | Rejected, and audited as a failed `sign_in`; no notification ([G3](#g3-no-security-notifications-223-255-285)) |
| 2.8.6 | Lost OTP device can be revoked immediately | Met | `reset_user` rotates the security stamp, deletes every session and forces a new key |
| 2.8.7 | Biometrics only as a secondary factor | N/A | No biometrics |
| 2.9.1–2.9.3 | Cryptographic verifiers | N/A | No smart cards or FIDO (see 2.3.2) |
| 2.10.1 | Service secrets not unchanging credentials | Risk-accepted | The database login and the Anthropic key are static secrets ([G6](#g6-static-service-credentials-2101)) |
| 2.10.2 | Service accounts not default credentials | Met | `macro_app` is created with a long random password (deploy.md step 1.6); never `postgres` |
| 2.10.3 | Service passwords protected from offline recovery | Met (live) | All four secrets are Key Vault references (deploy.md step 2.4), all `Resolved` for the app's managed identity, 2026-10-29 |
| 2.10.4 | No secrets in source code | Met | Config only; `scripts/check.ps1` secret scan (350 files clean); User Secrets in development |

## V3 Session Management

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 3.1.1 | No session tokens in URLs | Met | The cookie only; no token parameters anywhere |
| 3.2.1 | New token on authentication | Met | `Auth/SessionRotation.cs` deletes the old session and issues a new key on every sign-in and when setup completes; `AuthEndpointsTests.The_full_setup_over_http_ends_signed_in_with_a_new_session_key` |
| 3.2.2 | ≥64 bits of entropy | Met | 256-bit `RandomNumberGenerator` key (`Auth/PostgresTicketStore.cs`) |
| 3.2.3 | Tokens stored in the browser securely | Met | `HttpOnly` cookie only; the CSRF token is kept in memory (`frontend/src/api/http.ts`) |
| 3.2.4 | Approved algorithms for tokens | Met | CSPRNG key; the database stores its SHA-256 |
| 3.3.1 | Logout and expiry invalidate the token | Met | The row is deleted on sign-out or when invalid; `AuthEndpointsTests.A_signed_out_cookie_cannot_be_replayed`; `no-store` and the `pageshow` re-check (validation V4.1) |
| 3.3.2 | Periodic re-authentication | Met | 24-hour idle and 7-day absolute expiry, checked server-side on every request (`PostgresTicketStore.RetrieveAsync`) |
| 3.3.3 | Option to end other sessions after a password change | Met (fixed, G1) | A password change always ends every other session (the security stamp rotates) and keeps this one; `PasswordChangeTests.The_password_changes_other_sessions_end_and_this_one_stays_signed_in` |
| 3.3.4 | View and log out of active sessions | Risk-accepted (partial) | "Sign out everywhere" exists, but there's no list of sessions ([G7](#g7-no-list-of-active-sessions-334)) |
| 3.4.1 | `Secure` | Met | `Auth/AuthServices.cs`; `AuthEndpointsTests.The_session_cookie_is_host_only_httponly_secure_and_strict` |
| 3.4.2 | `HttpOnly` | Met | Same |
| 3.4.3 | `SameSite` | Met | `Strict` |
| 3.4.4 | `__Host-` prefix | Met | `__Host-mc_session`, `__Host-mc_af` |
| 3.4.5 | Most precise path when sharing a domain | Met | `__Host-` means host-only with `Path=/`; the app has its own host |
| 3.5.1 | Users can revoke OAuth tokens | N/A | No OAuth |
| 3.5.2 | Session tokens, not static API keys | Met | Server-side sessions |
| 3.5.3 | Stateless tokens are signed or encrypted | N/A | Sessions are stateful. The ticket stored with them is also Data Protection–encrypted |
| 3.7.1 | Full session or re-auth before sensitive changes | Met | Every non-setup endpoint needs a full session (fallback policy, `Auth/AccessPolicies.cs`). There are no account-change endpoints; setup steps need the setup session the credentials just created |

## V4 Access Control

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 4.1.1 | Enforced on a trusted service layer | Met | ASP.NET authorization policies; the client is never trusted (`Auth/AccessPolicies.cs`) |
| 4.1.2 | Access attributes can't be changed by users | Met | Claims come from the server-side ticket; `macro_app` can't update `role` or `disabled_at` (column grants, `RolesGrantsAndRls` migration) |
| 4.1.3 | Least privilege | Met | `macro_app` grants (no `INSERT` on users, insert-only audit); `macro_admin` owner-only; `AccessMatrixTests` |
| 4.1.5 | Fail securely, including on exceptions | Met | Fallback policy denies; exceptions become generic 500 or 503 with no session issued (`Data/DatabaseUnavailableHandler.cs`) |
| 4.2.1 | IDOR protection | Met | No endpoint takes a user or record ID; everything is keyed by the session's user (threat T6) |
| 4.2.2 | Strong anti-CSRF | Met | `Security/CsrfEndpointFilter.cs` on every unsafe `/api` request including sign-in; `Security/OriginCheckMiddleware.cs`; `SameSite=Strict` |
| 4.3.1 | Admin interfaces use MFA | Deploy | Administration is the Supabase dashboard and SQL editor. MFA on the owner's Supabase account (deploy.md step 1.1) |
| 4.3.2 | No directory browsing or metadata files | Met | Static files only from `wwwroot` (Vite build output), no directory browser |
| 4.3.3 | Step-up auth or segregation for high value | N/A | Low-value personal app with one administrator |

## V5 Validation, Sanitization and Encoding

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | Met | Inputs only from typed JSON or multipart bodies; no query parameters are read |
| 5.1.2 | Mass assignment | Met | `Endpoints/StrictJson.cs` rejects unknown properties; request records hold only the fields allowed |
| 5.1.3 | Positive validation of all input | Met | Lengths, `^[0-9]{6}$` codes, the username pattern (`IdentityDbContext.UsernamePattern`), the JPEG magic number (`Endpoints/EstimateEndpoints.cs`) |
| 5.1.4 | Structured data strongly typed | Met | Typed records; `Problems.InvalidRequest` on failure |
| 5.1.5 | Redirects only to an allow list | Met | The only redirect is HTTP→HTTPS on the same host |
| 5.2.1 | HTML from WYSIWYG sanitized | N/A | No HTML input |
| 5.2.2 | Unstructured data length-limited | Met | Descriptions ≤500, notes ≤300, auth bodies ≤4 KB |
| 5.2.3 | SMTP/IMAP injection | N/A | No mail |
| 5.2.4 | No `eval` or dynamic code | Met | None; CSP `script-src 'self'` without `unsafe-eval` |
| 5.2.5 | Template injection | N/A | No server templates |
| 5.2.6 | SSRF | Met | Outbound requests only to fixed hosts (HIBP base address, Anthropic SDK); no user-supplied URLs |
| 5.2.7 | User SVG sandboxed | Met | Only `image/jpeg` with a JPEG signature is accepted |
| 5.2.8 | Markdown/CSS/XSL content | N/A | None accepted |
| 5.3.1 | Context-aware output encoding | Met | React escaping; JSON responses via System.Text.Json |
| 5.3.2 | Character set preserved | Met | UTF-8 throughout |
| 5.3.3 | XSS protection | Met | React with no `dangerouslySetInnerHTML`; strict CSP (`Security/SecurityHeadersMiddleware.cs`); `SecurityHeadersTests`, e2e `csp.spec.ts` |
| 5.3.4 | Parameterized queries | Met | EF Core and Npgsql parameters (`PostgresTicketStore`); procedures take parameters |
| 5.3.5 | Escaping where no parameters | N/A | All queries are parameterized |
| 5.3.6 | JSON injection and eval | Met | System.Text.Json; the browser parses with `response.json()` |
| 5.3.7 | LDAP injection | N/A | No LDAP |
| 5.3.8 | OS command injection | N/A | No process execution |
| 5.3.9 | LFI/RFI | N/A | No file paths from input |
| 5.3.10 | XPath/XML injection | N/A | No XML from input |
| 5.4.1 | Memory-safe strings | Met | Managed .NET and TypeScript |
| 5.4.2 | Constant format strings | Met | Structured logging templates are constants (`LoggerMessage`) |
| 5.4.3 | Integer overflow | Met | Bounded counters and lengths; quota arithmetic in SQL |
| 5.5.1 | Serialized objects integrity-protected | Met | Session tickets are Data Protection–encrypted (authenticated) |
| 5.5.2 | XML parsers restricted (XXE) | Met | Only the framework reads the Data Protection key ring, which comes from the app's own database |
| 5.5.3 | Untrusted deserialization avoided | Met | Typed System.Text.Json, no polymorphic type handling |
| 5.5.4 | `JSON.parse` in browsers | Met | `fetch(...).json()` and Zod (`frontend/src/api/http.ts`) |

## V7 Error Handling and Logging

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 7.1.1 | No credentials logged | Met | No request, body or cookie logging; audit has reason codes only; `AuditCoverageTests` scans the audit table and the logs for every secret used |
| 7.1.2 | No other sensitive data logged | Met | Food text and photos are never logged (same test; validation V13) |
| 7.1.3 | Security events logged, including access-control and validation failures | Met (fixed, [G8](#g8-refused-requests-are-not-logged-713-722)) | Authentication, lockout, limits and owner actions are audited (FR-024). Every refused `/api` request (4xx) is logged at Warning with method, path, status and IP, never the query or body (`Security/RefusedRequestLogging.cs`; `RefusedRequestLogTests`) |
| 7.1.4 | Enough detail for a timeline | Met | `occurred_at` (timestamptz), event, outcome, account, actor, reason, source IP (`data-model.md`) |
| 7.2.1 | All authentication decisions logged | Met | `sign_in` success and failure, `sign_in_locked`, `rate_limited`, setup events; no tokens or passwords |
| 7.2.2 | Failed access-control decisions logged | Met (fixed, G8) | As 7.1.3 |
| 7.3.1 | Log injection prevented | Met | Typed audit columns with CHECK constraints; structured logging |
| 7.3.3 | Logs protected | Met | `macro_app` can only insert audit rows; reading is owner-only (`macro_admin.recent_audit`) |
| 7.3.4 | Synchronized time, UTC | Met | `timestamptz` from the database clock; App Service and Supabase use NTP |
| 7.4.1 | Generic error with an ID | Met | ProblemDetails with `traceId` and no internals; `DatabaseOutageTests`, `ProductionConfigTests` |
| 7.4.2 | Exception handling throughout | Met | Expected failures are typed results (`SetupResult`, `SignInOutcome`) |
| 7.4.3 | Last-resort handler | Met | `UseExceptionHandler` (`Program.cs`) |

## V8 Data Protection

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 8.1.1 | Sensitive data not cached by intermediaries | Met | `Cache-Control: no-store` on `/api` and HTML (`SecurityHeadersMiddleware`) |
| 8.1.2 | Server-side temporary copies protected or purged | Met | Photos and descriptions are held in memory for the Claude call only and never stored |
| 8.1.3 | Few request parameters | Met | Small typed bodies |
| 8.1.4 | Detect and alert on abnormal request volumes | Risk-accepted (partial) | Rate limits and quotas stop it; `ceiling_hit` and `rate_limited` are audited; nothing alerts the owner ([G9](#g9-no-alerting-814)) |
| 8.2.1 | Anti-caching headers | Met | `no-store` (validation V12.2) |
| 8.2.2 | No sensitive data in browser storage | Risk-accepted | Food logs live in IndexedDB by design (offline-first). Accepted in plan.md threats T6 and T14 |
| 8.2.3 | Authenticated data cleared after session end | Risk-accepted | Sign-out keeps the local log on the device, locked to that account in the app (FR-017; plan.md T14) |
| 8.3.1 | No sensitive data in query strings | Met | Everything is in POST bodies |
| 8.3.2 | Users can export or delete their data | Risk-accepted | No export or delete in the app ([G10](#g10-no-data-export-or-account-deletion-832)) |
| 8.3.3 | Clear notice and opt-in before use | Met | The "What is sent to Claude" notice must be acknowledged before any AI use (FR-021; setup step 3) |
| 8.3.4 | Sensitive data identified, with a policy | Met | plan.md assets and threat model; data-model.md |
| 8.3.5 | Access to sensitive data audited | N/A | The server stores no health data; account data access is the owner's (Supabase) |
| 8.3.6 | Sensitive data overwritten in memory | Risk-accepted | Not possible for .NET strings or JavaScript; see [G11](#g11-memory-zeroing-836) |
| 8.3.7 | Encryption with approved, authenticated algorithms | Met | Data Protection (AES-256-CBC with HMAC-SHA256) for TOTP secrets and tickets; TLS 1.2+ |
| 8.3.8 | Retention and automatic deletion | Met | `macro_admin.purge_expired()` daily via `pg_cron`: audit after 180 days, expired sessions, usage after 400 days |

## V13 API and Web Service

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 13.1.1 | Same encodings and parsers everywhere | Met | One ASP.NET Core host |
| 13.1.3 | No secrets in API URLs | Met | None |
| 13.1.4 | Authorization at route and resource level | Met | Route policies plus queries keyed by the session's user |
| 13.1.5 | Unexpected content types rejected (406/415) | Partial | Rejected, but with 400 `invalid_request` rather than 415 (`StrictJson`, the photo endpoint's form check). Accepted as is: the contract defines 400 |
| 13.2.1 | Only valid HTTP methods | Met | Only GET and POST are mapped; any other method matches no endpoint and is refused 401 by deny-by-default (`RefusedRequestLogTests.A_method_the_api_does_not_use_is_logged`) |
| 13.2.2 | JSON schema validation before accepting input | Met | Strict typed deserialization plus field validation (`StrictJson`, `contracts/auth-api.yaml`) |
| 13.2.3 | CSRF protection for cookie APIs | Met | As 4.2.2 |
| 13.2.5 | Content-Type checked | Met | `HasJsonContentType` / `HasFormContentType` |
| 13.2.6 | Messages trustworthy in transit | Met | TLS only (HSTS and redirect in Production); TLS VerifyFull to the database |
| 13.3.1–13.3.2 | SOAP | N/A | |
| 13.4.1–13.4.2 | GraphQL | N/A | |

## V14 Configuration

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 14.1.1 | Secure, repeatable build and deploy | Partial | CI gate on every PR (`.github/workflows/ci.yml`); deployment is a documented manual zip deploy (deploy.md §3) |
| 14.1.2 | Compiler protections | Met | Managed code; `TreatWarningsAsErrors`; no `AllowUnsafeBlocks` |
| 14.1.3 | Server hardened | Met | `Security/ProductionHardening.cs`: no `Server` header, HSTS, 308 redirect, refuses `AllowedHosts=*`, no allowed origin, or non-VerifyFull TLS |
| 14.1.4 | Re-deployable from a runbook or backups | Met (live) | `docs/deploy.md`; idempotent migration script. First live deploy 2026-10-28; §3 corrected for the zip-path issue it found |
| 14.2.1 | Components up to date, checked at build | Met | Lock files; NuGet and npm vulnerability scans in the gate (high or critical blocks merging) |
| 14.2.2 | Unneeded features removed | Met | No Swagger or developer pages; test switches only in the `Testing` environment (`Testing/TestingSwitches.cs`) |
| 14.2.3 | SRI for externally hosted assets | N/A | Everything is self-hosted |
| 14.2.4 | Components from trusted repositories | Met | nuget.org and npmjs.com via lock files |
| 14.2.5 | SBOM maintained | Met (fixed, [G12](#g12-no-sbom-1425)) | CycloneDX SBOMs for the backend (`dotnet-CycloneDX`, pinned in `dotnet-tools.json`) and the frontend (`npm sbom`) on every CI run, as the `sbom` artifact (`.github/workflows/ci.yml`) |
| 14.2.6 | Third-party libraries sandboxed | N/A | No plugin or scripting surface |
| 14.3.2 | Debug modes off in Production | Met | The developer exception page exists only in Development; Production uses the generic handler |
| 14.3.3 | No version information in headers | Met | `Server` and `X-Powered-By` removed (validation V12.2) |
| 14.4.1 | Content-Type with charset | Met | `application/json; charset=utf-8`, `application/problem+json` |
| 14.4.2 | `Content-Disposition: attachment` on API responses | Met (fixed, [G13](#g13-no-content-disposition-on-api-responses-1442)) | `attachment; filename="api.json"` on every `/api` response (`SecurityHeadersMiddleware`; `SecurityHeadersTests.Api_responses_are_attachments_so_a_browser_never_renders_them`; http-hardening.md) |
| 14.4.3 | CSP | Met | `SecurityHeadersMiddleware`; no inline script |
| 14.4.4 | `nosniff` | Met | Every response |
| 14.4.5 | HSTS with subdomains | Met (live) | `max-age` 365 days, `includeSubDomains` in Production (`ProductionHardening`); live V12 2026-10-29: `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| 14.4.6 | Referrer-Policy | Met | `no-referrer` |
| 14.4.7 | No framing | Met | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| 14.5.1 | Only methods in use accepted | Met | Others are refused (401, deny by default) and logged (G8) |
| 14.5.2 | Origin not used for authentication | Met | Origin can only refuse a request (`OriginCheckMiddleware`), never allow one; the CSRF token is still required |
| 14.5.3 | CORS strict allow list, no `null` | Met | No CORS is configured; the browser blocks cross-origin reads |
| 14.5.4 | Proxy headers authenticated | Risk-accepted (partial) | `X-Forwarded-For` is trusted one hop deep from any source (`Security/RateLimits.cs`). App Service is the only way in, so this only affects per-IP limits and audit IPs ([G14](#g14-forwarded-headers-trusted-from-any-source-1454)) |

## Gaps and decisions

**Decided by the owner on 2026-10-21.**
- **Fixed, with tests:** G1, the show-password half of G2, G8, G12 and G13.
- **Accepted in writing:** every other gap, in [plan.md § Accepted risks](../plan.md#accepted-risks-t126-asvs-level-2).

The recommendations below are kept as the record of each decision.

### G1. No self-service password change (2.1.5, 2.1.6, 3.3.3)
People can't change their own password. The only path is the owner's `reset_user`, which makes them choose a new password and authenticator.
**Recommendation: fix.** Add `POST /api/auth/password` (full session) that takes the current password, an authenticator code and the new password. It runs the same policy and breach check, rotates the security stamp, and keeps only the current session.

### G2. No strength meter and no show-password (2.1.8, 2.1.12)
**Recommendation: fix the show-password toggle** (small, client-only). **Accept the meter**: the length rule plus the breach check already block weak passwords, and the error says why.

### G3. No security notifications (2.2.3, 2.5.5, 2.8.5)
The app collects no email or phone number, by design (data minimization), so there's no channel to notify on.
**Recommendation: accept.** All these events are audited, and the owner, who makes every reset, knows each person.

### G4. No WebAuthn / FIDO2 (2.3.2)
**Recommendation: accept** for now (research R3 chose TOTP). Consider passkeys as a later feature.

### G5. No password pepper (2.4.5)
**Recommendation: accept.** PBKDF2 at 210,000 iterations with a per-user salt. A pepper kept outside the database would add a second secret to manage and lose, for limited gain at this size.

### G6. Static service credentials (2.10.1)
The `macro_app` database password and the Anthropic key are long-lived secrets. Supabase's pooler needs a password.
**Recommendation: accept.** Keep them in Key Vault (deploy.md), and rotate them if exposed.

### G7. No list of active sessions (3.3.4)
**Recommendation: accept.** "Sign out everywhere" covers the need for a few users.

### G8. Refused requests are not logged (7.1.3, 7.2.2, 14.5.1)
401, 403 (CSRF or Origin) and 405 responses, and input validation failures, leave no record. `Microsoft.AspNetCore` logs at Warning.
**Recommendation: fix cheaply.** Log refused `/api` requests at Warning, with method, path, status and IP and never the body, in the existing middleware. This doesn't go to the audit table: unauthenticated noise would flood it.

### G9. No alerting (8.1.4)
**Recommendation: accept.** The limits stop abuse automatically. The owner can check `macro_admin.ai_usage_today` and `recent_audit`, and can set an Azure alert on 429 or 5xx rates later.

### G10. No data export or account deletion (8.3.2)
The food log is only on the person's device. The server holds the account, usage counters and the audit trail.
**Recommendation: accept now, track it as a follow-up.** The owner can disable the account. Deleting it, with audit rows kept (their `user_id` becomes null), would need a `macro_admin.delete_user`.

### G11. Memory zeroing (8.3.6)
**Recommendation: accept.** Managed runtimes can't reliably zero strings.

### G12. No SBOM (14.2.5)
**Recommendation: fix cheaply.** Generate a CycloneDX SBOM for NuGet and npm in CI as a build artifact.

### G13. No `Content-Disposition` on API responses (14.4.2)
**Recommendation: fix.** One header for `/api` responses in `SecurityHeadersMiddleware`, with a test. `nosniff` and the CSP already limit the risk.

### G14. Forwarded headers trusted from any source (14.5.4)
**Recommendation: accept, with a deploy step.** Restrict the App Service so it's reachable only through its own front end, which is the default; no custom ingress. Spoofing would only skew per-IP limits and audit IPs.
