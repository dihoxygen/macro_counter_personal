# Research: Security Quality-of-Life Improvements

This feature changes the sign-in flow that feature 003 built. Each section below records a design
decision. References like "003 R4" point to
[003 research](../003-auth-security-foundations/research.md). All durations are configurable in
`SecurityOptions`; the values given are the defaults that the implementation and tests use.

No `NEEDS CLARIFICATION` items were left in the Technical Context. The spec's one open question
(what "Remember User" keeps) was settled on 2026-10-29: it skips only the authenticator code.

## R1. Two-step sign-in replaces the single request (FR-004 – FR-010; supersedes 003 R4)

- **Decision**:
  - `POST /api/auth/sign-in` takes `username`, `password` and an optional `rememberDevice` (see R3). The `code` field
    is removed. Because `StrictJson` rejects unknown fields, an old client that still sends `code`
    gets `400`, not a silent change in behaviour.
  - The sign-in endpoint has one of these results:

    | Result | When |
    |--------|------|
    | `401 sign_in_failed` | Unknown name, wrong password, bad/used/expired invite code, disabled or incomplete account, setup deadline passed |
    | `429 rate_limited` | Throttle or lockout (unchanged) |
    | `200 state=mfa` | Correct password, authenticator set up, device not remembered for this account |
    | `200 state=signed_in` | Correct password on a remembered device for this account (R3) |
    | `200 state=setup, step=password` | Valid invite code |
    | `200 state=setup, step=totp` | Correct password, no authenticator yet, before the setup deadline (FR-013) |

  - A correct password with an authenticator set up creates a **pending sign-in**. This is a
    server-side session row of a new kind, `mfa`, with a 5-minute idle and absolute lifetime
    (FR-006). It is the same mechanism as the `setup` session, so it gets the same `__Host-`
    cookie, hashed key, and stamp and disabled checks for free.
  - `POST /api/auth/mfa` (`code`) requires the `MfaSession` policy:
    - A correct, unused code rotates the `mfa` session into a **new** `full` session
      (`SessionRotation`, so there is no fixation; FR-008).
    - If the account still has the notice step left, the code instead rotates the session into a
      `setup` session at `step=notice`. This happens when someone abandoned setup after enrolling
      the authenticator.
  - The **Back** action is the existing `POST /api/auth/sign-out`. Its `AnySession` policy is
    widened to include `mfa`. It deletes the pending row (FR-010).
- **Rationale**:
  - This is what the owner asked for (spec Assumptions: accepted trade-off). Reusing the session
    table means there is no second token format and no new cookie for the pending state. The deny
    by default fallback (`FullSession`) already refuses `mfa` sessions everywhere else (FR-006,
    US1 scenario 8).
  - The pending state is server-side, so a two-tab race resolves naturally. Whichever tab sends a
    correct code first rotates the row away, and the other tab's next call gets `401`.
- **Alternatives considered**:
  - *Keep one request and have the UI fake two screens*, holding the password in browser memory
    until the code is typed. This keeps 003's "no password oracle", but a wrong password would
    still only fail after the code was typed. That defeats the user's main ask ("incorrect
    password should fail now before getting to MFA screen").
  - *A signed, short-lived token in the response body instead of a session row*. That would be a
    new token format to protect from page scripts, and it could not be revoked. Rejected under
    Principles V and VII.

## R2. Lockout and throttling across both steps (FR-009, FR-020, SC-007)

- **Decision**:
  - Only a completed authenticator step resets `AccessFailedCount`, clears `LockoutEnd` or calls
    `SignInThrottle.RecordSuccess`. A correct password alone resets nothing (threat T10).
  - A wrong code on `/auth/mfa` goes through the same `RecordFailure` path as a wrong password:
    `AccessFailedCount++`, lockout at 10, and `SignInThrottle.RecordFailure(username)`. It is
    audited as `sign_in` / failure with the new reason `invalid_code`.
  - The `mfa` session also counts its own failures in the existing `setup_failed_codes` column.
    After `Totp:SetupMaxFailures` (5), the pending session is deleted, and the person must re-enter
    the password. That 5th failure answers `400 invalid_code` with `attemptsLeft: 0` rather than
    401, so the UI can say "too many codes" instead of "timed out".
  - `/auth/mfa` uses the `RateLimits.SignIn` per-IP limiter.
  - Account lockout is checked again on `/auth/mfa`. If a lockout started from another source
    while this pending session was open, the request is refused with `429`.
- **Rationale**:
  - Without this, a correct password would buy unlimited code guesses, one pending session after
    another.
  - Counting both steps together keeps feature 003's SC-006 bound: 10 failures per account per
    15 minutes.
  - The per-session cap of 5 makes a stolen pending cookie worth very little.
- **Alternatives considered**: *A separate code-failure counter*. This would double the number of
  guesses an attacker gets before lockout. Rejected.

## R3. Remember User = trusted device that skips only the authenticator (FR-015 – FR-019)

- **Decision**:
  - **Cookie**: `__Host-mc_device` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). It holds a
    256-bit random token, protected by Data Protection like the session cookie. Its `Expires` is
    the row's expiry.
  - **Table**: a new `macro.trusted_devices` table stores:
    - `token_hash` (SHA-256)
    - `user_id`
    - `security_stamp` (copied at creation)
    - `created_at`
    - `expires_at = created_at + 7 days`
  - **Validity**: a device is honoured only if all of these hold:
    - the row exists
    - `now < expires_at`, by server time
    - the stamp equals the user's current stamp
    - the user is not disabled
    - `user_id` is the account whose password was just verified
  - **Fixed expiry**: nothing ever extends `expires_at` (FR-017).
  - **One per browser**: a browser holds at most one device cookie. When a second account ticks
    the box on the same browser, the earlier account's row is deleted and the cookie is replaced.
    The other account simply goes back to entering codes.
  - **The request field is a choice, not a state**: `rememberDevice` is **optional**. The client
    sends it only when the person changed the box during this sign-in, with the box's final value.
    If it is absent, the current state is kept (FR-003). After a correct password on an active
    account:

    | Cookie on this browser | `rememberDevice` | Result |
    |------------------------|------------------|--------|
    | Valid for **this** account | absent or `true` | Full session directly. Audited `sign_in` / success / `remembered_device`. |
    | Valid for **this** account | `false` | Forget: delete the row, clear the cookie, audit `device_forgotten`, then `state=mfa` (FR-016a). |
    | None, invalid, or another account's | `true` | `state=mfa` with a `remember=true` claim. After the code, replace any cookie and row with a new device for this account. |
    | None, invalid, or another account's | absent or `false` | `state=mfa`. Nothing is remembered, and another account's device is left alone. |

  - **Creation**: a device row is created only after the authenticator step succeeds on a ticket
    carrying `remember=true`. That is `/auth/mfa`, or, during first sign-in, **setup completion**
    (`/auth/setup/notice`), so an abandoned setup never leaves a device row behind. The flag
    travels in a `remember` claim on the `mfa` or `setup` ticket, so the client cannot add it
    later (FR-015).
  - **Revocation (FR-018)**:
    - Every path that already rotates the security stamp also invalidates remembered devices:
      password change or set, sign-out everywhere, and the owner's `reset_user`, `disable_user`
      and `revoke_sessions`.
    - Sign-out everywhere also deletes the rows outright, as do the owner procedures, which are
      redefined to do so.
    - `purge_expired` deletes expired rows.
    - A normal sign-out does not touch the device cookie.
- **Tick-box default**:
  - `GET /api/auth/session` adds `deviceRemembered: boolean`. This is true when the request
    carries a currently valid device cookie for *any* account. The cookie is unprotected first,
    and the database is queried only if that succeeds, so junk cookies cost nothing.
  - The sign-in screen pre-ticks "Remember User" only in that case. Otherwise it is clear, as
    spec US3 scenario 1 requires.
  - Because only a *change* to the box is sent, a remembered person who leaves it alone stays
    remembered. A second person on a shared browser who leaves the pre-ticked box alone is
    neither remembered nor able to displace the first person.
  - It reveals only that *someone* on this browser is remembered, which that browser already
    knows from the cookie.
- **Rationale**:
  - This is the standard "trust this device" pattern.
  - The stamp comparison gives immediate revocation with no new bookkeeping in each revocation
    path (SC-006).
  - Hashing and HttpOnly match the session cookie, so FR-019 is met by construction.
  - The cookie is useless for another account because of the `user_id` match, and useless without
    the password.
- **Alternatives considered**:
  - *A longer full session (no idle timeout)*. This was option A, which the user declined.
  - *Sending the box's value on every sign-in, with the pre-tick*. A second person on a shared
    browser would replace the first person's device just by not noticing the box. Rejected
    (analysis U1).
  - *No pre-tick, and a clear box forgets*. A remembered person would have to re-tick the box
    every time or silently lose remembering. Rejected.
  - *Storing the token in `localStorage`*. Page scripts could read it, which violates FR-019 and
    the constitution's Sessions rule.
  - *One device cookie per account (a cookie map)*. It is more complex, and it is unneeded for a
    family computer where at most one person would sensibly trust the browser.

## R4. Timing and message uniformity on the password step (FR-005, SC-004)

- **Decision**:
  - Keep 003's rule that every failure path runs exactly one password-hash verification
    (`BurnOneHash`), and that all failures return the same `401 sign_in_failed` body.
  - The new trusted-device lookup and the `mfa` session insert run only after a *successful*
    password check, so they do not affect failure timing.
  - SC-004 is tested by comparing mean response times of the three failure kinds over 30 runs
    each. They must be within 100 ms. This is an integration test against the real hasher, run
    with a relaxed threshold under CI load.
- **Rationale**: Success and failure now differ by design (the accepted trade-off). What must stay
  hidden is *why* a failure happened.

## R5. Wording and screens (FR-001 – FR-003, FR-011, FR-023)

- **Decision**:
  - **Sign-in screen**: Username, "Password (or Invite Code)", a "Remember User" checkbox and
    Sign in. There is no code field.
  - **Authenticator screen**: "Enter the 6-digit code from your authenticator app". It uses
    `inputMode=numeric` and `autocomplete=one-time-code`, with a Verify button and a "Use a
    different account" link (FR-010).
  - **Setup**: the existing `SetupFlow` password step already has "New password" and "Confirm new
    password", and blocks mismatches before sending. It is kept, and only the copy around it
    changes.
  - **Error messages**:
    - A wrong code shows "That code is incorrect. Try again."
    - An expired or deleted pending session (`401` from `/auth/mfa`) returns to the sign-in
      screen with "Your sign-in timed out. Enter your password again."
  - **Wording sweep**: user-facing copy uses "invite code" everywhere. Owner SQL function names
    (`invite_user`, `reset_user`) and the `temp_code_hash` column keep their names, as the spec
    Assumptions allow.
- **Rationale**: The smallest change to existing components. Principle IV's 360 px and 44 px rules
  are already met by the shared form styles.

## R6. No new dependencies (Principle V)

- **Decision**: None are added. Everything uses ASP.NET Core cookies, Data Protection, Identity's
  TOTP, Npgsql, and the existing React, zod and Playwright stack.
