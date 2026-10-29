# Feature Specification: Security Quality-of-Life Improvements

**Feature Branch**: `004-security-qol`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Security quality of life improvements. `Password or temporary code` is renamed to `Password (or Invite Code)`.  Move MFA to a separate screen (after login); Incorrect password should fail now before getting to MFA screen. If a new user doesn't have a MFA set up, user will be prompted after successfully inputting invite code, setting new password and confirming new password. Additionally, add `Remember User` tic-box on the sign-in screen: the remember user is good for a week."

## Context

Feature 003 (auth security foundations) shipped one sign-in form. It asks for the username,
"Password or temporary code" and an authenticator code together, and it gives one generic
failure for any wrong field. That choice meant the form never revealed whether the password
alone was right. In practice the single form is confusing: first-time users must know to leave
the code field blank, and returning users type a code before they find out they mistyped their
password.

This feature moves to the more familiar two-screen flow. It deliberately accepts that the first
screen shows whether the password was correct. Rate limiting, lockout and auditing from feature
003 limit the impact (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Password first, then a separate authenticator screen (Priority: P1)

A returning person enters their username and password on the sign-in screen. If the password is
wrong, they are told straight away and stay on the sign-in screen. If it is right, they move to a
separate screen that asks only for their authenticator code. When the code is correct, they land
on their Today screen.

**Why this priority**: This is the sign-in path every user takes on every sign-in. Failing fast on
a mistyped password and showing one question per screen removes the most common confusion.

**Independent Test**: With a fully set-up account, sign in with a wrong password (the error shows
on the first screen and no code is requested). Then sign in with the right password and the right
code, and confirm the person reaches Today.

**Acceptance Scenarios**:

1. **Given** a set-up account, **When** the person submits the right username and a wrong
   password, **Then** they stay on the sign-in screen with a generic "username or password is
   incorrect" message, and no authenticator screen is shown.
2. **Given** a username that does not exist, **When** any password is submitted, **Then** the
   message and timing are the same as for a wrong password, so the screen does not reveal which
   usernames exist.
3. **Given** a set-up account, **When** the person submits the right username and password,
   **Then** the authenticator screen appears and asks only for the 6-digit code.
4. **Given** the authenticator screen, **When** the person enters the right code, **Then** they
   are signed in and land on Today.
5. **Given** the authenticator screen, **When** the person enters a wrong code, **Then** they stay
   on the authenticator screen with an "incorrect code" message and can try again, within the
   failed-attempt limits. After 5 wrong codes on one attempt, they return to the sign-in screen
   and must enter their password again.
6. **Given** the authenticator screen, **When** the person chooses "Back" or "Use a different
   account", **Then** they return to the sign-in screen and the half-finished sign-in is
   discarded.
7. **Given** the person passed the password screen, **When** they do not finish the authenticator
   step within 5 minutes, **Then** the half-finished sign-in expires and they must start again
   from the password screen.
8. **Given** the person passed the password screen but has not entered a code, **When** they try
   to use any signed-in feature, **Then** it is refused exactly as if they were signed out.

---

### User Story 2 - First sign-in with an invite code, then authenticator setup (Priority: P1)

A newly invited person types their username and the invite code they were given into the
"Password (or Invite Code)" field. The app recognises the invite code and asks them to choose a
new password and type it again to confirm it. Only after the new password is saved are they asked
to set up an authenticator app. They then read the "What is sent to Claude" notice, as in feature
003, and land on Today.

**Why this priority**: Without it, new users cannot get in at all. The relabelled field and the
ordered steps make first sign-in understandable without help from the owner.

**Independent Test**: Issue an invite to a new account. Sign in with the invite code, set and
confirm a password, set up the authenticator, acknowledge the notice, and confirm the person
reaches Today. Sign out and sign in again with the new password and a code.

**Acceptance Scenarios**:

1. **Given** the sign-in screen, **When** it is displayed, **Then** the second field is labelled
   exactly "Password (or Invite Code)".
2. **Given** a newly invited account, **When** the person submits their username and a valid,
   unexpired invite code, **Then** they see a "Set your password" screen with "New password" and
   "Confirm new password" fields, and no authenticator screen is shown.
3. **Given** the "Set your password" screen, **When** the two entries do not match, **Then** the
   password is not saved and the person is told the passwords do not match.
4. **Given** the "Set your password" screen, **When** the new password fails the existing password
   rules (length, breached-password check), **Then** it is not saved and the reason is shown.
5. **Given** a valid, matching new password, **When** it is saved, **Then** the invite code stops
   working and the person is immediately shown the authenticator setup screen.
6. **Given** the authenticator setup screen, **When** the person scans the code (or types the
   setup key) and enters a correct 6-digit code, **Then** the authenticator is saved and the
   person continues to the "What is sent to Claude" notice, and then to Today.
7. **Given** a person who saved a new password but left before finishing authenticator setup,
   **When** they next sign in with that password (before the invite's setup deadline), **Then**
   they go straight to authenticator setup instead of the authenticator code screen.
8. **Given** a used, expired or wrong invite code, **When** it is submitted, **Then** the person
   sees the same generic "username or password is incorrect" message as for a wrong password.

---

### User Story 3 - Remember User for a week (Priority: P2)

The sign-in screen has a "Remember User" tick-box. When the person ticks it and completes sign-in,
this device and browser are trusted for 7 days. During that week, signing in on this device needs
only the username and password: the authenticator screen is skipped. When the tick-box is left
clear, every sign-in asks for the authenticator code, as in feature 003. Session lifetimes do not
change either way.

**Why this priority**: It cuts down how often people sign in on their own phone. Sign-in still
works without it, so it comes after the core flow.

**Independent Test**: Sign in with "Remember User" ticked, sign out, then sign in again on the
same browser within 7 days. Confirm only the password is asked for. Repeat on a different browser,
and after 7 days, and confirm the authenticator code is asked for both times.

**Acceptance Scenarios**:

1. **Given** the sign-in screen, **When** it is displayed, **Then** a "Remember User" tick-box is
   shown below the password field. It is clear by default, unless this browser is already
   remembered, in which case it shows as ticked so a returning person does not opt out by
   accident. Only a change the person makes to the box counts as a choice (FR-003).
2. **Given** the person ticked "Remember User" and completed sign-in, **When** they return on the
   same device and browser within 7 days, **Then** a correct password signs them straight in to Today, with no authenticator screen.
3. **Given** a remembered device, **When** 7 days have passed since the sign-in that set it,
   **Then** the device is no longer remembered and the authenticator code is asked for again.
   Using the app does not extend the 7 days.
4. **Given** a remembered device, **When** a different account signs in on it, **Then** that
   account is asked for its authenticator code. Remembering applies only to the account that
   ticked the box.
5. **Given** a remembered device, **When** the person uses "Sign out everywhere", has their
   password reset, or has their account disabled, **Then** every remembered device for that
   account stops being remembered immediately.
6. **Given** the person did not tick "Remember User", **When** they sign in, **Then** the
   authenticator code is asked for and nothing is remembered.
7. **Given** a remembered device, **When** a wrong password is entered, **Then** it fails on the
   sign-in screen exactly as on any other device. Remembering never skips the password.
8. **Given** a browser remembered for one account, so the box shows ticked, **When** a different
   account signs in without touching the box, **Then** that account is asked for its code and is
   not remembered, and the first account stays remembered.
9. **Given** a remembered device, **When** the person unticks the box and signs in, **Then** the
   authenticator code is asked for and the device is no longer remembered for them.

### Edge Cases

- A person ticks "Remember User", passes the password screen, then abandons the authenticator
  screen: nothing is remembered. Remembering takes effect only after a complete sign-in.
- Two people share one browser and only one ticks "Remember User": the other person still needs
  their own authenticator code. The box shows ticked for them too, but leaving it untouched does
  not remember them or replace the first person's device. Remembering never lets one person reach
  another's data (Principle III scoping still applies).
- The second person on a shared browser does want to be remembered while the box already shows
  ticked: they untick and re-tick it. That counts as a choice and replaces the first person's
  device, because a browser is remembered for one account at a time.
- A remembered person signs out normally: the device stays remembered. Their next sign-in on it
  within the 7 days still needs only the password. To end remembering, they use "Sign out
  everywhere" or untick the box on their next sign-in.
- A person enters an invite code for an account that already finished setup: the code has already
  been used, so it is refused with the generic message.
- A person enters their correct password but their account is locked by repeated failures: the
  lockout message or delay from feature 003 applies on the password screen, before any
  authenticator screen.
- A person reaches the authenticator screen and then fails the code repeatedly: these failures
  count toward the same account lockout as password failures, so the password screen cannot be
  used to get unlimited code guesses. After 5 wrong codes on one attempt they are sent back to the
  password step.
- A person opens the authenticator screen in two tabs: completing it in one tab finishes sign-in.
  The other tab's half-finished sign-in is no longer valid and returns to the sign-in screen.
- A person presses the browser's Back button from the "Set your password" or authenticator setup
  screen: they cannot reach a signed-in screen and must resume setup or start again.
- The person's clock or device time is wrong: remembered-device expiry is decided by the server's
  time, not the device's.

## Clarifications

### Session 2026-10-29

- Q: What does "Remember User" keep for a week? → A: It skips only the authenticator code on
  that device and browser for 7 days. The password is still required (option B).

## Requirements *(mandatory)*

### Functional Requirements

**Sign-in screen**

- **FR-001**: The sign-in screen MUST show a field labelled exactly "Password (or Invite Code)" in
  place of "Password or temporary code". All user-facing text MUST call the one-time code an
  "invite code".
- **FR-002**: The sign-in screen MUST NOT show an authenticator code field.
- **FR-003**: The sign-in screen MUST show a "Remember User" tick-box. It MUST be clear by default,
  and shown ticked only when this browser is currently remembered for some account. The system
  MUST treat the box as a choice only when the person changes it during this sign-in. Leaving it
  untouched MUST keep the current state: a remembered account stays remembered, and nobody else
  becomes remembered.

**Password step**

- **FR-004**: The system MUST check the username and password (or invite code) before any
  authenticator step, and MUST reject a wrong password on the sign-in screen without showing the
  authenticator screen.
- **FR-005**: Wrong password, unknown username, and used, expired or wrong invite codes MUST all
  give the same message, and MUST take about the same time to answer, so the response does not
  reveal which usernames exist or whether an invite was ever issued.
- **FR-006**: A correct password MUST create only a short-lived, partly signed-in state. It MUST
  expire after 5 minutes, MUST be good for one account only, and MUST NOT allow any signed-in
  feature.

**Authenticator step**

- **FR-007**: After a correct password, a person with an authenticator set up MUST be shown a
  separate screen that asks only for their 6-digit authenticator code.
- **FR-008**: A correct code MUST complete sign-in and give a new full session, distinct from the
  partly signed-in state (no reuse of its identifier).
- **FR-009**: A wrong code MUST keep the person on the authenticator screen with an "incorrect
  code" message, up to 5 wrong codes on one attempt. After the 5th, the partly signed-in state
  MUST end and the person MUST return to the sign-in screen. Wrong codes MUST count toward the
  same per-account and per-source lockout as wrong passwords.
- **FR-010**: The authenticator screen MUST offer a way back to the sign-in screen that discards
  the partly signed-in state.

**First sign-in with an invite code**

- **FR-011**: A valid invite code MUST lead to a "Set your password" screen with "New password"
  and "Confirm new password" fields. The password is saved only when both match and it meets the
  feature 003 password rules.
- **FR-012**: Saving the new password MUST use up the invite code, and MUST then take the person
  straight to authenticator setup.
- **FR-013**: A person who has a password but no authenticator yet MUST be taken to authenticator
  setup after a correct password, instead of the authenticator code screen. This is allowed only
  before the account's setup deadline; after it, sign-in is refused until the owner issues a new
  invite.
- **FR-014**: After authenticator setup, the person MUST see the existing "What is sent to Claude"
  notice before reaching Today, as in feature 003.

**Remember User**

- **FR-015**: "Remember User" MUST take effect only after a complete, successful sign-in
  (password and authenticator code) in which the person chose to tick the box.
- **FR-016**: On a remembered device, for 7 days from that sign-in, a correct password for the
  account that ticked the box MUST complete sign-in without the authenticator step. The password
  step MUST always be required. Remembering MUST NOT change session lifetimes or idle time-outs.
- **FR-016a**: Unticking "Remember User" and signing in with the correct password on a remembered
  device MUST end remembering for that account on that device.
- **FR-017**: The 7-day period MUST be counted from the sign-in that set it, by server time, and
  MUST NOT be extended by use.
- **FR-018**: A normal sign-out MUST NOT end remembering. "Sign out everywhere", a password
  change, an owner reset (which also replaces the authenticator), and an account disable MUST end
  it on every device for that account, immediately.
- **FR-019**: Anything the device keeps to remember the person MUST NOT be readable by page
  scripts, MUST NOT contain the password or authenticator secret, and MUST be useless on any other
  account.

**Security and auditing**

- **FR-020**: The sign-in rate limits and lockouts from feature 003 MUST apply to the password
  step, the authenticator step and the invite-code step.
- **FR-021**: The audit record MUST distinguish "password failed", "authenticator code failed",
  "invite code used", "authenticator set up", and "remembered device created / ended", and MUST
  record whether a sign-in used a remembered device. As in feature 003, entries MUST NOT contain
  passwords, codes or session identifiers.
- **FR-022**: All feature 003 guarantees that this spec does not change (no sign-up, deny by
  default, per-user data scoping, session revocation) MUST continue to hold and stay covered by
  tests.
- **FR-023**: All new screens MUST work at 360 px wide and on desktop, with touch targets of at
  least 44×44 px. The authenticator code field MUST bring up the numeric keyboard on phones.

### Key Entities

- **Pending sign-in**: The partly signed-in state after a correct password and before the
  authenticator step. It belongs to one account, expires after 5 minutes, and allows nothing but
  the next sign-in step.
- **Invite code**: The existing feature 003 one-time code (previously "temporary code"),
  single-use, expiring, issued by the owner. Only its label and the screens around it change.
- **Remembered device**: A record that one account ticked "Remember User" on one device and
  browser. It holds the account, the creation time and a fixed 7-day expiry, and can be ended per
  device or for every device of the account.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tests, a wrong password is reported on the sign-in screen without the
  authenticator screen appearing.
- **SC-002**: A returning person can go from the sign-in screen to Today in under 20 seconds,
  including the separate authenticator screen.
- **SC-002a**: On a remembered device, a returning person reaches Today from the sign-in screen
  in under 10 seconds.
- **SC-003**: A newly invited person can finish first sign-in (invite code, new password and
  confirmation, authenticator setup, notice) in under 3 minutes without help.
- **SC-004**: Messages and response times for unknown usernames, wrong passwords and bad invite
  codes are the same, so in tests an observer cannot tell them apart from the screen or the
  timing (difference under 100 ms on average).
- **SC-005**: A person who ticked "Remember User" is not asked for an authenticator code on that
  device for 7 days, and is asked for it in 100% of tests after 7 days, on another device, or for
  another account.
- **SC-006**: After sign-out everywhere, a password reset or an account disable, 0 remembered
  devices for that account are still honoured.
- **SC-007**: After 10 combined password and authenticator-code failures on one account within 15
  minutes, further attempts are refused or delayed, as in feature 003 SC-006.

## Assumptions

- **Accepted trade-off**: Feature 003 deliberately checked password and code together so that a
  correct password was never revealed (research R4). This feature reverses that at the owner's
  request. The risk is limited because the authenticator is still required, lockouts count both
  steps together (FR-009, FR-020), every failure is audited, and the user base is a small,
  invite-only group.
- "Login" in the description means the password step. "MFA" means the authenticator app (TOTP)
  from feature 003. No new second-factor types are added.
- "Invite code" is the same one-time code that feature 003 calls a "temporary code". Its 72-hour
  setup deadline and single use do not change. The owner's database tools for issuing codes may
  keep their current names.
- Password rules (length, breached-password check) are unchanged from feature 003.
- The "What is sent to Claude" notice stays as the last first-sign-in step.
- The feature 003 session lifetimes (24-hour idle, 7-day absolute) are unchanged, whether or not
  "Remember User" is ticked. "Remember User" only skips the authenticator step; it does not keep
  anyone signed in.
- On a remembered device, the browser's remembered-device token takes the place of the
  authenticator code as the "something you have" factor, so every sign-in still needs two factors
  (the password plus the authenticator or the trusted browser). The token is weaker than an
  authenticator app, because it lives in the browser that is being signed in. This is accepted
  because it applies only to the account that opted in, on one browser, with a fixed expiry and
  immediate revocation through "Sign out everywhere".
- "Good for a week" means 7 × 24 hours from the sign-in that set it.
- Passkeys, "forgot password" self-service and recovery codes are out of scope.
