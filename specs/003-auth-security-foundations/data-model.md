# Data Model: Auth & Security Foundations

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

The data lives in two places:

1. **Server (Supabase PostgreSQL, schema `macro`)**: identity, credentials, sessions, usage and
   audit data only. There are **no food logs, photos or goals** (FR-019).
2. **Browser (IndexedDB)**: food data, now kept in **one database per account**, plus a small
   device database.

All server timestamps are `timestamptz` (UTC). IDs are UUIDs unless noted.

---

## Server entities (schema `macro`)

### `users`: User account and credential state

The table is mapped to Identity's `IdentityUser<Guid>`. Unused Identity columns (email, phone) are
ignored in the EF model and are not created.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | Set by `macro_admin.invite_user`. Never shown to other users. Also used as the local IndexedDB key. |
| `username` | text, unique, not null | Canonical lowercase, `^[a-z0-9._-]{3,32}$` (CHECK). The app cannot change it. |
| `normalized_username` | text, unique, not null | `upper(username)`, as Identity uses it for lookup. |
| `role` | text not null default `'user'` | CHECK in (`owner`, `user`). At most one `owner` (partial unique index). The app cannot change it. |
| `password_hash` | text null | Identity PBKDF2-SHA512, 210k iterations (R2). Null until the person sets a password. |
| `temp_code_hash` | bytea null | SHA-256 of the normalized temporary code (R6). Cleared when the password is set (single use, FR-008). |
| `setup_expires_at` | timestamptz null | Invite or reset time + 72 h. After this, setup sign-ins fail until the owner runs `reset_user`. Cleared when setup completes. |
| `two_factor_enabled` | boolean not null default false | True only after TOTP is confirmed. |
| `totp_last_code` / `totp_last_used_at` | text null / timestamptz null | Replay guard (R3). |
| `ai_notice_ack_at` | timestamptz null | When the person acknowledged "What is sent to Claude" (Constitution VII Accountability). |
| `security_stamp` | text not null | Rotated by reset, password set, sign out everywhere and disable. Sessions carry the stamp they were issued with. |
| `concurrency_stamp` | text not null | Identity optimistic concurrency. |
| `access_failed_count` | int not null default 0 | Identity lockout counter (R7 layer 3). |
| `lockout_enabled` | boolean not null default true | Always true. |
| `lockout_end` | timestamptz null | Set after 10 consecutive failures, for 15 minutes. |
| `disabled_at` | timestamptz null | Non-null means disabled (FR-015). The app cannot change it. |
| `created_at` / `last_sign_in_at` | timestamptz | `created_at` defaults to `now()`. |

**Derived account state** (computed in code, used by sign-in and by the `users_overview` view):

```text
                 invite_user / reset_user
                          │
                          ▼
   ┌──────────────── INVITED ─────────────────┐  temp_code_hash set, password_hash null
   │ sign in with temp code (before deadline) │
   │                          ▼               │
   │                   SETUP: password ───────┤  (setup session)
   │                          │ set password  │  temp_code_hash cleared
   │                          ▼               │
   │                   SETUP: totp ───────────┤
   │                          │ confirm code  │  two_factor_enabled = true
   │                          ▼               │
   │                   SETUP: notice ─────────┤
   │                          │ acknowledge   │  ai_notice_ack_at set, setup_expires_at cleared
   │                          ▼               │
   │                       ACTIVE ◄───────────┘  (full session issued)
   │                          │
   │   setup_expires_at < now and setup not complete → EXPIRED (sign-in fails; owner must reset)
   │
   └── any state ── disable_user ──► DISABLED ── enable_user ──► previous state
       any state ── reset_user   ──► INVITED (password, TOTP, sessions wiped; stamp rotated)
```

If a row is missing what its state needs (for example, no password and no temporary code, or
`two_factor_enabled` without a key), it is **INCOMPLETE**. Every sign-in to an INCOMPLETE account
fails with the generic error and is audited with reason `account_incomplete` (spec edge case).

### `user_tokens`: Second-factor secret (Identity's token table)

| Column | Type | Rules |
|---|---|---|
| `user_id` | uuid FK → users ON DELETE CASCADE | |
| `login_provider` / `name` | text | `[AspNetUserStore]` / `AuthenticatorKey` |
| `value` | text | The TOTP secret, **encrypted with Data Protection** (purpose `MacroCounter.Totp.v1`) by the custom store (R3). |

PK (`user_id`, `login_provider`, `name`). Identity also requires `user_claims` and `user_logins`.
They are created empty and never written; the app can only read them.

### `sessions`: Session

| Column | Type | Rules |
|---|---|---|
| `key_hash` | bytea PK | SHA-256 of the 256-bit random key held in the cookie (R5). |
| `user_id` | uuid FK → users ON DELETE CASCADE, indexed | |
| `kind` | text not null | CHECK in (`setup`, `full`). |
| `security_stamp` | text not null | Must equal `users.security_stamp` on every request. |
| `ticket` | bytea not null | The serialized authentication ticket, protected with Data Protection. It holds claims only, never secrets. |
| `created_at` / `last_seen_at` | timestamptz not null | `last_seen_at` is written at most once per minute. |
| `absolute_expires_at` | timestamptz not null | `created_at` + 7 d (full) or + 15 min (setup). |
| `setup_failed_codes` | smallint not null default 0 | Setup sessions only; at 5, the session is deleted (R3). |

**Validity check (every authenticated request)**: the row exists, `now < absolute_expires_at`,
`now − last_seen_at < idle limit` (24 h for full, 15 min for setup), `security_stamp` matches, and
the user's `disabled_at` is null. If any check fails, the row is deleted and the response is `401
unauthenticated`. A session lives for at most its absolute lifetime, and the purge job deletes
expired rows.

### `ai_usage_daily` / `ai_usage_global_daily`: Usage record

| Table | Columns | Rules |
|---|---|---|
| `ai_usage_daily` | `user_id` uuid FK, `day` date (UTC), `count` int ≥ 0 | PK (`user_id`, `day`). The conditional upsert only increments while `count < Limits:Ai:PerUserDaily` (30). |
| `ai_usage_global_daily` | `day` date PK, `count` int ≥ 0, `ceiling_hit_at` timestamptz null | Row-locked during a reservation. The increment happens only while `count < GlobalDaily` (200) **and** the sum for the month is below `GlobalMonthly` (3000). `ceiling_hit_at` tells the owner the ceiling was reached (US5.3). |

Reservation happens in one transaction **before** Claude is called and is never refunded (R8).
`resetAt` is the next UTC midnight, or the first day of the next month for the monthly scope.

### `audit_events`: Audit entry

| Column | Type | Rules |
|---|---|---|
| `id` | bigint identity PK | |
| `occurred_at` | timestamptz not null default `now()` | |
| `event_type` | text not null | One of the types listed below (CHECK). |
| `outcome` | text not null | `success` / `failure` / `info` |
| `user_id` | uuid null | Set only when the account is known. Unknown typed usernames are **never** stored, because people sometimes type a password into the username field. |
| `actor` | text not null | `user`, `system` or `owner` (`owner` for `macro_admin` procedures). |
| `source_ip` | inet null | From forwarded headers. |
| `reason` | text null | A short machine code from a closed list (CHECK), for example `bad_credentials`, `locked`, `rate_limited`, `account_incomplete`, `setup_expired`, `breach_check_unavailable`, `quota_user_daily`. **Never free text.** |

**Event types (FR-024)**: `sign_in`, `sign_in_locked`, `rate_limited`, `sign_out`,
`sign_out_everywhere`, `session_revoked`, `setup_started`, `password_set`, `password_rejected`,
`totp_enrolled`, `totp_failed`, `ai_notice_acknowledged`, `account_invited`, `account_reset`,
`account_disabled`, `account_enabled`, `account_unlocked`, `quota_exceeded`, `ceiling_hit`.

**Privacy rule (FR-025, SC-009)**: the table has no columns that could hold a password, token,
code, photo or food text. `reason` is restricted by a CHECK constraint and `user_id` is a UUID.
A test also scans the rows written during the test run for any secret or food string used as
input. Entries are kept for 180 days, then removed by `macro_admin.purge_expired()`.

### `data_protection_keys`

This is the standard `DataProtectionKey` entity (`id`, `friendly_name`, `xml`). In production
the XML is encrypted with the Data Protection certificate (R13).

### Database roles and grants

| Role | Grants |
|---|---|
| `postgres` (owner, via the Supabase SQL editor) | Everything. It runs migrations and the `macro_admin.*` procedures. |
| `macro_app` (login; password in the host's secret settings) | `USAGE` on `macro`. **users**: `SELECT`, `UPDATE` (all columns **except** `id`, `username`, `normalized_username`, `role`, `disabled_at`, `created_at`). **No `INSERT` or `DELETE` on users.** **user_tokens, sessions, ai_usage_\***: `SELECT, INSERT, UPDATE, DELETE`. **user_claims, user_logins**: `SELECT`. **audit_events**: `INSERT` only. **data_protection_keys**: `SELECT, INSERT`. No access to `macro_admin`. No DDL. |
| `anon`, `authenticated`, `public` | Nothing. RLS is enabled on every table with policies **only** for the app role, and the Data API is off (R12). |

**RLS policies** (created by `macro_admin.grant_app_role(<app role>)`, R12):

| Table | Policy for the app role |
|---|---|
| `users`, `user_tokens`, `user_claims`, `user_logins`, `sessions`, `ai_usage_daily`, `ai_usage_global_daily`, `data_protection_keys` | `app_access`: `for all to <app role> using (true) with check (true)` |
| `audit_events` | `app_insert`: `for insert to <app role> with check (true)` (no select, update or delete policy) |

The policies let the app role through RLS. Its grants (table above) still decide what it may
actually do. No other role has a policy, so RLS returns zero rows to them.

---

## Browser storage changes

### Per-account food database: `macro-counter.u.<userId>`

This uses the **same schema and migrations** as the existing `macro-counter` database (stores
`entries`, `savedFoods`, `proteinGoals`, `meta`; schema version 1). Only the name changes:
`openDb(name)` already takes a name. No food record shape changes, so no food-data migration is
needed.

### Device database: `macro-counter-device` (new, schema version 1)

It has a single store, `device`, holding fixed keys. It is accessed only through
`DeviceRepository` (Principle III).

| Key | Value | Rules |
|---|---|---|
| `activeAccount` | `{ userId: string(uuid), username: string, role: 'owner' \| 'user', updatedAt: ISO string }` or absent | Written after a full sign-in. Deleted on sign-out. Read at launch for offline grace (R9). |
| `legacyAdopted` | `true` or absent | Set once the legacy database has been copied and deleted, or when it is confirmed that no legacy database exists. |

It is versioned (`schemaVersion` in the store) and uses the existing migration runner.

### Legacy adoption: `macro-counter` → `macro-counter.u.<ownerId>` (FR-018, US4.3)

The adoption runs once, after a full sign-in, only when **all** of these hold: `role === 'owner'`,
`legacyAdopted` is absent, and the legacy database exists.

1. Open the legacy database, migrating it if it is older than the current schema.
2. For each store, copy every record into the owner's database in one read-write transaction.
   Keep `id`, `createdAt` and `updatedAt` unchanged.
3. Check that each target store has at least as many records as the source.
4. Only then delete the legacy database and set `legacyAdopted`.

If any step fails, nothing is deleted and the adoption retries at the next sign-in. Accounts with
`role === 'user'` never trigger it.

### Client session state (in memory only, never persisted)

```ts
type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'setup'; step: 'password' | 'totp' | 'notice' }
  | { kind: 'signed_in'; user: { id: string; username: string; role: 'owner' | 'user' } }
  | { kind: 'offline'; account: ActiveAccount };   // offline grace: local data only
```

The CSRF request token is held in memory next to `AuthState`. It is never written to storage.
