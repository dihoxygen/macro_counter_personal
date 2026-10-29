# Implementation Plan: Security Quality-of-Life Improvements

**Branch**: `004-security-qol` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-security-qol/spec.md`

## Summary

Sign-in becomes two steps, and devices can be remembered for a week:

- **Step 1, password.** `POST /api/auth/sign-in` checks only the password, or the invite code on
  first sign-in.
  - A wrong password fails right there, with one uniform message and uniform timing.
  - A correct one opens a 5-minute **pending sign-in**. This is a new `mfa` kind of server-side
    session, so it reuses all of 003's cookie and revocation machinery.
- **Step 2, authenticator.** `POST /api/auth/mfa` takes the code and rotates the pending session
  into a full one. Code failures share the password lockout. The UI gets a separate authenticator
  screen ([R1](./research.md#r1-two-step-sign-in-replaces-the-single-request-fr-001--fr-010-supersedes-003-r4),
  [R2](./research.md#r2-lockout-and-throttling-across-both-steps-fr-009-fr-020-sc-007)).
- **First sign-in is unchanged in substance.** The existing setup flow already goes invite code →
  new password + confirm → authenticator → notice. Only the label ("Password (or Invite Code)")
  and the copy change. A person who chose a password but never enrolled is now routed straight to
  authenticator setup.
- **Remember User.** This is an `HttpOnly` `__Host-mc_device` cookie backed by a new
  `trusted_devices` table: hashed token, fixed 7-day expiry, and the security stamp copied at
  creation. A remembered device skips only the authenticator step. Every existing revocation path
  (password change, sign-out everywhere, owner reset, disable, revoke) rotates the stamp, so it
  also ends remembering
  ([R3](./research.md#r3-remember-user--trusted-device-that-skips-only-the-authenticator-fr-015--fr-019)).
- **The accepted trade-off.** This deliberately reverses 003 R4: step 1 now reveals whether a
  password is right. This is a deviation from the ASVS baseline, not from the constitution. The
  threat model below records how that risk is bounded.

## Technical Context

**Language/Version**: C# 14 / .NET 10 backend; TypeScript 6.0 (strict) + React 19 frontend
(unchanged)

**Primary Dependencies**: Unchanged. ASP.NET Core Identity and cookies, Data Protection, Npgsql /
EF Core, zod, Vite, Playwright. No new packages
([R6](./research.md#r6-no-new-dependencies-principle-v)).

**Storage**:
- Supabase PostgreSQL, schema `macro`:
  - The `sessions.kind` check gains `mfa`.
  - A new `trusted_devices` table.
  - New audit event and reason codes.
- Owner procedures `reset_user`, `disable_user`, `revoke_sessions` and `purge_expired` are
  redefined to delete device rows.
- `grant_app_role` is redefined to grant `select, insert, delete` on the new table.
- No client storage changes. See [data-model.md](./data-model.md).

**Testing**:
- Backend: xUnit + `WebApplicationFactory` against local PostgreSQL 17 as `macro_app`, with
  `FakeTimeProvider` for the 5-minute and 7-day windows.
- Frontend: Vitest + React Testing Library, and Playwright e2e.
- `EndpointInventoryTests` is pointed at `specs/004-security-qol/contracts/auth-api.yaml`, which
  becomes the live contract, and learns the `mfa` access level.

**Target Platform**: Unchanged (Azure App Service B1; evergreen desktop and mobile browsers).

**Project Type**: Web application (`backend/` + `frontend/`).

**Performance Goals**:
- SC-002: under 20 s from sign-in to Today.
- SC-002a: under 10 s on a remembered device.
- The one extra round trip is negligible.

**Constraints**:
- Failure responses on step 1 are indistinguishable in body and mean timing (within 100 ms,
  SC-004).
- No token is readable by page scripts.
- Deny by default must still hold with the new session kind.

**Scale/Scope**: Fewer than 20 users. One new endpoint, one new table, one new screen, plus changes
to about 8 backend and 6 frontend files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| **I. Test-First** | Each behaviour gets a failing test first: backend `SignInServiceTests` (reworked), `MfaStepTests`, `TrustedDeviceTests`, `SignInTimingTests` and the migration grant tests; frontend `SignInScreen`, `MfaScreen` and `authMachine` tests; e2e `mfa.spec.ts`, `remember-user.spec.ts` and the updated `first-sign-in.spec.ts`. Tasks will order every test before its implementation. | ✅ |
| **II. Correct Nutrition Math** | Not touched. | ✅ N/A |
| **III. Local-First Data** | The server gains only sign-in bookkeeping (pending sessions, device rows, audit), all of which Principle VII allows. No food data. Per-user IndexedDB scoping is unchanged. Remembering never opens another account's database, because it applies only after that account's own password. | ✅ |
| **IV. Fast Logging, Desktop & Mobile** | The new screen follows the existing form styles: 360 px wide, touch targets of at least 44 px, a numeric keypad for the code. A remembered device removes the code step entirely ([ui-flow.md](./contracts/ui-flow.md)). | ✅ |
| **V. Simplicity** | No dependencies. It reuses the session table and `SessionRotation` for the pending state, and stamp comparison for device revocation, instead of new revocation hooks. A browser holds one device cookie, not a cookie map. | ✅ |
| **VI. AI Lookup** | Not touched. The notice step still precedes first AI use. | ✅ N/A |
| **VII. Security** | The sections below cover each sub-rule. The one deliberate weakening, the password oracle, is a deviation from the ASVS baseline that the constitution names for threat models. It is not a breach of any Principle VII MUST, and it is risk-accepted under "Recorded ASVS deviations" in the threat model. | ✅ |
| ‣ Access | No sign-up is added. `/auth/mfa` is `x-access: mfa`, the fallback policy (`FullSession`) still refuses `mfa` and `setup` sessions everywhere else, and the inventory and `NoSignUpRoute` tests stay. | ✅ |
| ‣ Credentials | Every sign-in stays **multi-factor**: the password (something you know) plus one possession factor (something you have). That factor is either the authenticator app or, on a browser the person explicitly chose to trust, the remembered-device token. The token is a 256-bit random secret in an HttpOnly `__Host-` cookie, stored only as a SHA-256 hash, bound to one account, with a fixed 7-day expiry and immediate revocation. It replaces the code; it never replaces the password ([R3](./research.md#r3-remember-user--trusted-device-that-skips-only-the-authenticator-fr-015--fr-019)). This is the standard "remember this device" pattern, and it uses vetted framework primitives (Data Protection, `RandomNumberGenerator`, SHA-256) rather than custom crypto. Passwords and codes are never logged. | ✅ |
| ‣ Sessions | The pending session is server-side, hashed, `__Host-`, has a 5-minute lifetime and is rotated on success (no fixation). The device cookie has the same attributes. CSRF tokens work as before (`/auth/mfa` requires `X-CSRF-Token`). Sign-out and sign-out everywhere both work. | ✅ |
| ‣ Abuse resistance | Code failures count toward the same 10-per-15-minute lockout and username throttle. Each pending session is capped at 5 codes. `/auth/mfa` sits behind the per-IP sign-in limiter ([R2](./research.md#r2-lockout-and-throttling-across-both-steps-fr-009-fr-020-sc-007)). | ✅ |
| ‣ Logging | New audit codes are added: `password_accepted`, `device_remembered`, `device_forgotten`, and the reasons `remembered_device` and `invite_code`. `SecretScanTests` are extended to the new events. | ✅ |
| ‣ Threat model | Below. | ✅ |
| ‣ Accountability | The owner can still end everything immediately. `revoke_sessions` and `disable_user` now also delete device rows. | ✅ |

**Post-design re-check (after Phase 1)**: still passes. The design added no dependency, no server
food data and no unauthenticated endpoint other than the existing public sign-in.

### Threat model (Principle VII, OWASP ASVS L2 baseline)

**Assets**:
- Account access (and with it AI quota spend).
- Remembered-device tokens.
- Pending sign-in sessions.

**Trust boundaries**: browser ↔ API (cookies, CSRF), and API ↔ PostgreSQL (`macro_app`
least-privilege role).

| # | Threat | Mitigation | Residual risk |
|---|--------|------------|---------------|
| T1 | **Password oracle.** Step 1 now confirms a correct password, which helps credential stuffing (ASVS 2.2.1, accepted deviation from 003 R4). | Identical failure body and timing across all failure kinds, so usernames are not enumerated (SC-004). Per-IP, per-username and per-account limits are unchanged. Breached-password check at set time. The second factor is still required. `password_accepted` is audited so the owner can spot it. | An attacker learns that a guessed password is right, within 10 tries per 15 minutes per account. **Accepted by the owner (spec Assumptions).** |
| T2 | Unlimited code guessing using one correct password. | The shared lockout counts code failures. Each pending session is capped at 5 codes. TOTP replay protection is unchanged. | About 10 codes per 15 minutes, a guessing chance of about 10⁻⁵ per window. |
| T3 | Theft of the device cookie through XSS. | HttpOnly, `__Host-`, strict CSP (unchanged). | None from XSS. |
| T4 | Theft of the device cookie with the device, or a cookie-jar export. The trusted browser is a weaker possession factor than a separate authenticator app, because it is the same device being signed in. | The cookie is useless without the password, has a fixed 7-day expiry and is bound to one account. It is created only on an explicit tick (FR-003, FR-015). Revocation through sign-out everywhere is immediate (stamp check). | Someone holding both the unlocked browser and the password gets in for up to 7 days unless the owner or the user revokes it. Accepted (spec Assumptions). |
| T5 | A remembered device used to skip the factor on another account. | `user_id` must equal the account whose password was just verified. | None. |
| T6 | A pending session used to call protected APIs. | The fallback `FullSession` policy refuses it. The inventory and access-matrix tests cover the `mfa` level. | None. |
| T7 | Fixation or replay of a pending session. | It rotates to a new key on success and is deleted on Back, at 5 failures, or after 5 minutes. The key is hashed at rest. | None. |
| T8 | Device row lifetime extended by a compromised app process. | `macro_app` has no `update` grant on `trusted_devices`. | The row can only be deleted or re-created through a full sign-in. |
| T9 | Old clients sending `code` to `/auth/sign-in`. | `StrictJson` rejects unknown fields with 400, so a stale PWA shows a generic error until it updates (the service worker updates on next load). | Brief confusion right after deploy. Acceptable for fewer than 20 users. |
| T10 | Resetting the failure counters by alternating a correct password with wrong codes. | Only a completed authenticator step resets `AccessFailedCount` or calls `SignInThrottle.RecordSuccess`. A correct password alone (`PasswordAccepted`) resets nothing, including for accounts whose notice step is still pending. | None. |

**Recorded ASVS deviations** (risk-accepted by the owner, spec Assumptions):

| ASVS item | Deviation | Bound |
|-----------|-----------|-------|
| 2.2.1 (anti-automation and no credential oracle) | Step 1 reveals whether a password is correct (reverses 003 R4). | T1, T2, T10. Failure kinds are indistinguishable (SC-004). Code failures share the lockout. |

## Project Structure

### Documentation (this feature)

```text
specs/004-security-qol/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── auth-api.yaml    # Full auth contract v3.0.0; replaces 003's as the one EndpointInventoryTests reads
│   └── ui-flow.md       # Screen text and behaviour contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── MacroCounter.Api/
│   ├── Auth/
│   │   ├── SignInService.cs          # split: VerifyPasswordAsync (step 1) + VerifyMfaAsync (step 2); new outcomes
│   │   ├── AuthEndpoints.cs          # sign-in without code + rememberDevice; POST /auth/mfa; deviceRemembered in session state
│   │   ├── TrustedDeviceStore.cs     # NEW: create/validate/forget device tokens, __Host-mc_device cookie
│   │   ├── AccessPolicies.cs         # NEW MfaSession policy; AnySession includes mfa
│   │   ├── AuthClaims.cs             # NEW remember claim
│   │   ├── PostgresTicketStore.cs    # accept kind 'mfa' with MfaLifetime idle/absolute
│   │   ├── SetupService.cs           # ConfirmTotp creates device row when ticket has remember=true
│   │   └── AuthServices.cs           # register TrustedDeviceStore, device cookie name
│   ├── Audit/AuditLog.cs             # new AuditEvent/AuditReason values
│   ├── Data/
│   │   ├── Records.cs                # SessionRecord.MfaKind; TrustedDevice record
│   │   ├── IdentityDbContext.cs      # map trusted_devices, updated check constraints
│   │   └── Migrations/<ts>_TwoStepSignIn.cs   # table, constraints, grant_app_role + owner procs redefined
│   └── Security/SecurityOptions.cs   # Session:MfaLifetime, Session:RememberDeviceLifetime
└── MacroCounter.Api.Tests/
    ├── Auth/SignInServiceTests.cs    # reworked for step 1
    ├── Auth/MfaStepTests.cs          # NEW
    ├── Auth/TrustedDeviceTests.cs    # NEW
    ├── Auth/SignInTimingTests.cs     # NEW (SC-004)
    ├── Infrastructure/AuthClient.cs  # two-step helper
    └── Security/EndpointInventoryTests.cs  # read 004 contract; mfa access level

frontend/
├── src/
│   ├── api/auth.ts                   # signIn(username, password, rememberDevice); verifyMfa(code); schema: mfa, deviceRemembered
│   └── auth/
│       ├── SignInScreen.tsx          # relabel, remove code field, Remember User checkbox
│       ├── MfaScreen.tsx             # NEW
│       ├── authMachine.ts            # mfa state, mfa_expired notice
│       ├── AuthGate.tsx              # route mfa state to MfaScreen
│       └── SetupFlow.tsx             # copy: "invite code", "Set your password"
└── tests/
    ├── components/{SignInScreen,MfaScreen,AuthGate,SetupFlow}.test.tsx
    ├── unit/auth/authMachine.test.ts, unit/api/auth.test.ts
    └── e2e/auth/{mfa,remember-user}.spec.ts (NEW), first-sign-in.spec.ts, flows.ts (two-step helper)
```

**Structure Decision**: The existing web-application layout is kept. All changes sit inside the
current `Auth/` folders on both sides, and the only new production files are `TrustedDeviceStore.cs`
and `MfaScreen.tsx`.

## Complexity Tracking

No constitution violations. The password oracle is an ASVS deviation, recorded in the threat
model. Remember User keeps sign-in multi-factor (Constitution Check, Credentials row), so it needs
no entry here.
