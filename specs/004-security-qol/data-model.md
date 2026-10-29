# Data Model: Security Quality-of-Life Improvements

These are changes to the [003 data model](../003-auth-security-foundations/data-model.md). Nothing
here adds food data to the server (Principle III).

**Terms**: the spec's *pending sign-in* is an `mfa`-kind session here. The spec's *Remember User
tick-box* is the UI "Remember User" checkbox, and a *remembered device* is a `trusted_devices`
row plus its `__Host-mc_device` cookie.

## Server (PostgreSQL, schema `macro`)

### `sessions`: a new kind, `mfa`

| Change | Detail |
|--------|--------|
| `ck_sessions_kind` | `kind in ('setup', 'full', 'mfa')` |
| Lifetime | `mfa`: idle and absolute both `Session:MfaLifetime`, default **5 minutes** |
| `setup_failed_codes` | Reused to count wrong codes on an `mfa` session. The row is deleted at `Totp:SetupMaxFailures` (5). |

The ticket of an `mfa` or `setup` session can carry the claim `remember=true`. This records that
the person ticked "Remember User" on the password step (research R3).

### `trusted_devices` (new)

| Column | Type | Rules |
|--------|------|-------|
| `token_hash` | `bytea` PK | SHA-256 of the 256-bit random token held in `__Host-mc_device` |
| `user_id` | `uuid` FK → `users.id`, `on delete cascade` | Indexed |
| `security_stamp` | `text` | Copied from `users.security_stamp` at creation |
| `created_at` | `timestamptz` | Server time |
| `expires_at` | `timestamptz` | `created_at + Session:RememberDeviceLifetime` (default **7 days**). Never updated. |

- **Valid** when `now() < expires_at`, `security_stamp = users.security_stamp`, and
  `users.disabled_at is null`. It is honoured only for the account whose password was just
  verified.
- **Created** after a successful `/auth/mfa`, or at setup completion (`/auth/setup/notice`), on a
  ticket with `remember=true`. The claim is set only when the request explicitly sent
  `rememberDevice: true` (research R3 table). Before inserting, the row of the browser's previous
  device cookie, if any, is deleted.
- **Expiry** is decided by server time only. The cookie's `Expires` attribute is a convenience,
  not a check.
- **Deleted** in these cases:
  - Sign-in on this browser with an explicit `rememberDevice: false` for the same account
    (FR-016a).
  - Sign-out everywhere: all rows for the user.
  - Owner `reset_user`, `disable_user` and `revoke_sessions`: all rows for the user.
  - `purge_expired`: rows past `expires_at`.
  - The account itself being deleted (cascade).
- **Grants**: `macro_app` gets `select, insert, delete` (no `update`, so expiry can never be
  extended). RLS is enabled with the same `app_access_*` policy as `sessions`. The grant is added
  by redefining `macro_admin.grant_app_role` in the migration and re-running it.

### `audit_events`: new codes

| Constraint | Added values |
|------------|--------------|
| `ck_audit_events_event_type` | `password_accepted`, `device_remembered`, `device_forgotten` |
| `ck_audit_events_reason` | `remembered_device`, `invite_code` |

When each event is written (FR-021):

| Event | `event_type` | `outcome` | `reason` |
|-------|--------------|-----------|----------|
| Wrong password, unknown name, or bad invite code | `sign_in` | failure | `bad_credentials` (unchanged) |
| Correct password, waiting for code | `password_accepted` | info | — |
| Wrong authenticator code | `sign_in` | failure | `invalid_code` |
| Valid invite code (setup starts) | `setup_started` | success | `invite_code` |
| Authenticator set up | `totp_enrolled` | success | — (unchanged) |
| Signed in after code | `sign_in` | success | — |
| Signed in on a remembered device | `sign_in` | success | `remembered_device` |
| Device remembered | `device_remembered` | success | — |
| Device forgotten (FR-016a or sign-out everywhere) | `device_forgotten` | success | — |

No row carries tokens, codes or passwords (unchanged rule, FR-025 of 003).

### `users`: no schema change

The setup state machine stays as it is: `password` → `totp` → `notice` → complete. What changes
is how sign-in routes into it:

```text
                         POST /auth/sign-in (username, password|invite code, rememberDevice)
                                          │
        ┌───────────────┬─────────────────┼──────────────────────┬───────────────────────┐
   invite code ok   password ok,      password ok,          password ok,             any failure
   (no password)    no TOTP yet       TOTP on, device        TOTP on, remembered      → 401
        │           (before deadline) not remembered        device for this user      (one body)
        ▼                 ▼                 ▼                      ▼
 setup:password     setup:totp         mfa session            full session
        │                 │                 │  POST /auth/mfa
        └──► setup:totp ──┘                 ├── code ok, notice pending ──► setup:notice
               │ confirm                    ├── code ok ─────────────────► full session
               ▼                            ├── code wrong (<5) ─────────► stay (400 invalid_code)  [no counter is reset by a correct password]
          setup:notice ──► full session     └── code wrong (5th: 400 attemptsLeft 0) / 5 min ► signed out
```

Any session rotation in the diagram deletes the old row and issues a new key (`SessionRotation`).

## Configuration (`SecurityOptions`)

| Setting | Default | New? |
|---------|---------|------|
| `Session:MfaLifetime` | 5 minutes | new |
| `Session:RememberDeviceLifetime` | 7 days | new |
| `Session:IdleTimeout`, `AbsoluteLifetime`, `SetupLifetime` | 24 h, 7 d, 15 min | unchanged |
| `Totp:SetupMaxFailures` | 5 (now also caps codes per `mfa` session) | unchanged |
| `SignIn:*` throttles and lockout | 10 per 15 min | unchanged (now counts code failures too) |

## Client (frontend)

### `SessionState` (API response, zod)

- `state` gains `'mfa'`.
- `deviceRemembered: boolean` is added (always present).

### `AuthState` (`authMachine.ts`)

- New `{ kind: 'mfa' }`. It is reached from `signed_out` on a `session` event with `state=mfa`.
- `session-expired` while in `mfa` → `{ kind: 'signed_out', notice: 'mfa_expired' }`.
- `mfa-attempts-exceeded` while in `mfa` → `{ kind: 'signed_out', notice: 'mfa_attempts' }`.
- An `mfa` session arriving while someone's data is shown → `reload` (the same rule as `setup`).

No IndexedDB changes. Nothing about Remember User is stored on the client except the HttpOnly
cookie the client cannot read.
