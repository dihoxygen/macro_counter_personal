# Contract: Owner account procedures (database)

These procedures are the **only** way accounts are created or managed (FR-002, FR-003). There is
no API endpoint or UI for any of them. The owner runs them in the **Supabase SQL editor**
(connected as `postgres`), or with `psql` against the local test database. They live in the
`macro_admin` schema. The application role `macro_app` cannot call them and cannot read that
schema ([data-model.md § grants](../data-model.md#database-roles-and-grants)).

Every procedure:

- Takes a username, trims it and lowercases it. An unknown username raises an error such as
  `no such user: alice`. This is safe because only the owner sees it.
- Runs in one transaction.
- Writes an `audit_events` row with `actor = 'owner'`.
- Never returns or stores a password. Temporary codes are returned **once** and only their
  SHA-256 hash is stored.

## Procedures

| Call | Effect | Returns |
|---|---|---|
| `select macro_admin.invite_user('alice');` <br> `select macro_admin.invite_user('sam', 'owner');` | Creates a user in the INVITED state, with a new id, security stamp and temporary code, and `setup_expires_at = now() + 72 hours`. The role defaults to `user`. Only one `owner` is allowed. It rejects names that don't match `^[a-z0-9._-]{3,32}$` and names that already exist. Audit: `account_invited`. | `text`: the temporary code, for example `7KQM-X2PD-HV9T-R4CW-NB3J` |
| `select macro_admin.reset_user('alice');` | Used for a lost password or a lost authenticator. Clears `password_hash`, the authenticator key, `two_factor_enabled` and the replay guard. Issues a new temporary code and setup deadline, rotates the security stamp, **deletes all sessions** and clears the lockout. Keeps `ai_notice_ack_at` and the role. The person repeats setup at their next sign-in (US2.5). Audit: `account_reset`. | `text`: the new temporary code |
| `select macro_admin.disable_user('alice');` | Sets `disabled_at = now()`, rotates the security stamp and **deletes all sessions**. Access ends at the person's next request, which is immediate (SC-005). Audit: `account_disabled`. | `void` |
| `select macro_admin.enable_user('alice');` | Clears `disabled_at`. The account returns to its previous state. If setup had expired in the meantime, the owner runs `reset_user` as well. Audit: `account_enabled`. | `void` |
| `select macro_admin.unlock_user('alice');` | Clears `lockout_end` and `access_failed_count`. The in-memory per-username window (R7) still runs out on its own within 15 minutes. Audit: `account_unlocked`. | `void` |
| `select macro_admin.revoke_sessions('alice');` | Deletes every session and rotates the security stamp, without disabling the account. Audit: `session_revoked`. | `int`: the number of sessions removed |
| `select macro_admin.purge_expired();` | Deletes expired sessions, audit rows older than 180 days and usage rows older than 400 days. On Supabase it is scheduled daily with `pg_cron` (03:15 UTC); locally it is run by hand. | `int`: the number of rows removed |

## Read-only views (owner visibility, US5.3, US6)

| View | Columns |
|---|---|
| `macro_admin.users_overview` | `username, role, state (invited/setup/active/expired/disabled/incomplete), created_at, last_sign_in_at, locked_until, active_sessions` |
| `macro_admin.recent_audit` | The last 30 days of `audit_events` joined to `username`, newest first |
| `macro_admin.ai_usage_today` | Per-user count today, the global count today, the count for the month so far, the limits, and `ceiling_hit_at` |

## Why the owner role lives here

The constitution (VII, Authorization) requires a distinct owner/admin role that manages invites,
disables users and views usage. In this app, that role is exercised **through these procedures
and views**, not through app endpoints: the spec rules out an admin screen and any account
creation endpoint. The `role = 'owner'` flag on the account marks whose browser may adopt
pre-feature local data (data-model.md). See plan.md, Constitution Check, Authorization.

## Owner runbook (SC-011: each task takes under 5 minutes)

1. **Add a friend**: run `select macro_admin.invite_user('<name>');`. Copy the code and give it to
   them in person or over a trusted channel, together with the app URL. Tell them it expires in
   72 hours.
2. **Friend locked out or lost their phone**: run `select macro_admin.reset_user('<name>');` and
   give them the new code.
3. **Remove a friend**: run `select macro_admin.disable_user('<name>');`. It takes effect at once.
   Rows are never deleted, so the audit trail stays intact.
4. **Check usage or a suspected compromise**: look at `ai_usage_today` and `recent_audit`.

## Tests (written first, run against local PostgreSQL)

- Each procedure changes the state as described and writes exactly one audit row.
- Running as `macro_app`: `insert into macro.users` fails, `update macro.users set disabled_at` and
  `update macro.users set role` fail, `select` on `macro_admin.*` fails, and
  `update`/`delete`/`select` on `audit_events` fail.
- A temporary code is accepted once by sign-in, is refused after the password is set, and is
  refused after `setup_expires_at`.
- A disabled user's existing session is refused on the next request.
