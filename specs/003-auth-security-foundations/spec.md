# Feature Specification: Auth & Security Foundations

**Feature Branch**: `003-auth-security-foundations`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "auth and security foundations. The application should implement the best security practices. Auth will employ a username and sign-on and users can only join based on invite only (there will be no sign up function). New users must be added via the database. I understand this may conflict with the constitution in terms of backend databases, but the need for it arises. The backend database will be a supabase-cloud based DB."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in to use the app (Priority: P1)

An invited person opens the app, enters their username and password, completes a second verification step, and lands on their own Today screen. Until they do this, they cannot use any part of the app that talks to the server (including AI food lookup).

**Why this priority**: Everything else in this feature, and every future shared-hosting feature, depends on knowing who is using the app. Without sign-in, anyone who finds the address could spend the owner's AI budget.

**Independent Test**: With one pre-provisioned account, sign in with correct credentials and a valid second step and reach the app; try wrong credentials and confirm access is refused with a message that does not reveal which part was wrong.

**Acceptance Scenarios**:

1. **Given** a provisioned, active account and a signed-out browser, **When** the person enters the correct username, password and second-step code, **Then** they are signed in and see their Today screen.
2. **Given** a signed-out browser, **When** the person enters a wrong password or an unknown username, **Then** they get the same generic "could not sign in" message in both cases and no access.
3. **Given** a person who is signed in, **When** they choose "Sign out", **Then** the session ends and the app returns to the sign-in screen, and going "Back" does not expose any server-backed screen.
4. **Given** a person who is signed in, **When** their session reaches its maximum age or has been idle past the allowed time, **Then** they are asked to sign in again and nothing is lost from their locally stored food log.
5. **Given** an account's first sign-in with a temporary credential, **When** the person signs in, **Then** they are required to set their own strong password and enrol a second verification step before reaching the app.

---

### User Story 2 - Invite-only access with no sign-up (Priority: P1)

Only people the owner has deliberately added can ever sign in. The app has no sign-up, "create account", or self-service invitation screen, and no server endpoint that creates accounts. The owner adds a new person by creating their account directly in the database, with a temporary credential that the person must replace on first sign-in.

**Why this priority**: This is the core access-control decision. It makes the audience a closed list controlled by the owner and removes the whole class of public sign-up abuse.

**Independent Test**: Confirm that no sign-up screen or sign-up request exists, that a person with no provisioned account cannot get in by any route, and that an account the owner adds in the database can sign in.

**Acceptance Scenarios**:

1. **Given** the app is open and signed out, **When** a visitor looks at the sign-in screen, **Then** there is no sign-up, "register", or "request an invite" option.
2. **Given** a person with no provisioned account, **When** they attempt to sign in or to call any server feature directly, **Then** they are refused.
3. **Given** the owner adds a new account in the database, **When** that person signs in for the first time, **Then** they are guided through setting their own password and second step (User Story 1, scenario 5).
4. **Given** the owner marks an account as disabled in the database, **When** that person next makes any server request, **Then** the request is refused and any active session for that account stops working within the revocation window defined in Success Criteria.
5. **Given** a person has lost their password or second-step device, **When** they ask the owner, **Then** the owner can reset that account in the database, which forces the person to set a new password and second step at next sign-in.

---

### User Story 3 - Every server feature is protected by default (Priority: P1)

Every server-side feature requires an authenticated, active user unless it has been explicitly marked public. The only public endpoints are the sign-in flow and a basic availability check that reveals nothing about users or configuration. A signed-in user can only act as themselves and can never see or change another user's data.

**Why this priority**: A single unprotected endpoint defeats sign-in. Deny-by-default makes forgetting a check impossible rather than merely unlikely.

**Independent Test**: Enumerate every server endpoint and call each without credentials, with an expired session, and with a disabled user's session; confirm each is refused except the explicitly public ones.

**Acceptance Scenarios**:

1. **Given** no credentials, **When** a request is made to the AI estimate features, **Then** it is refused and no AI usage is incurred.
2. **Given** a newly added server endpoint with no explicit access setting, **When** it is called without credentials, **Then** it is refused (default deny).
3. **Given** two signed-in users, **When** one tries to read or affect anything belonging to the other, **Then** it is refused.
4. **Given** a session that has been signed out or revoked, **When** its token is reused, **Then** it is refused.

---

### User Story 4 - Private data per person on a shared browser (Priority: P2)

Two invited people can use the same browser (for example a family computer) without ever seeing each other's food logs, saved foods or goals. Each person's locally stored data is tied to their account. Signing out keeps their data on the device but makes it unreachable to the next person who signs in.

**Why this priority**: The app keeps food data on the device. Once more than one person can sign in on one browser, data separation is required to keep each person's health data private.

**Independent Test**: Sign in as person A, log food, sign out, sign in as person B on the same browser, and confirm B sees none of A's data; sign back in as A and confirm everything is still there.

**Acceptance Scenarios**:

1. **Given** person A has logged entries and signed out, **When** person B signs in on the same browser, **Then** B sees an empty log and none of A's entries, saved foods, or goals.
2. **Given** person A signs back in on that browser, **When** they open the app, **Then** all of A's previous data is present.
3. **Given** existing data from before this feature (single-user local data), **When** the owner first signs in on that browser, **Then** that data is adopted into the owner's account rather than lost, and no other account can adopt it.

---

### User Story 5 - Brute-force and cost abuse protection (Priority: P2)

Repeated failed sign-ins slow down or temporarily block further attempts, so passwords cannot be guessed at speed. Each person also has a fair daily limit on AI lookups, plus there is an overall ceiling, so a bug, a stolen session, or heavy use cannot run up unlimited cost. Hitting a limit never blocks manual food entry.

**Why this priority**: The shared AI key is billed to the owner. Limits turn a worst case of "unbounded bill" into a known maximum.

**Independent Test**: Make repeated failed sign-in attempts and confirm they are slowed or blocked; make AI lookups past the daily limit and confirm a clear message while manual entry still works.

**Acceptance Scenarios**:

1. **Given** several failed sign-in attempts for one username or from one source in a short time, **When** another attempt is made, **Then** it is delayed or refused with a "try again later" message, even if the credentials are correct.
2. **Given** a person who has used their daily AI lookups, **When** they request another, **Then** they see a clear message that the limit is reached and when it resets, and can still add food manually.
3. **Given** the overall AI usage ceiling has been reached, **When** anyone requests an AI lookup, **Then** the request is refused with a clear message and the owner can see that the ceiling was hit.

---

### User Story 6 - Security audit trail and owner visibility (Priority: P3)

Security-relevant events are recorded so the owner can see who signed in, who failed, which accounts were locked or disabled, and who hit usage limits, without the record containing passwords, session tokens, photos, or food descriptions.

**Why this priority**: Without a record, a compromise or abuse can't be detected or investigated. It matters less than preventing the problem, so it comes after the protections.

**Independent Test**: Perform a sign-in success, a failure, a lockout and a limit hit, and confirm each appears in the audit record with time and account, and that no secret or food content is present.

**Acceptance Scenarios**:

1. **Given** any sign-in success or failure, lockout, sign-out, session revocation, account disable, or limit hit, **When** it occurs, **Then** an audit entry with time, account (if known), and outcome is recorded.
2. **Given** the audit record, **When** the owner reviews it, **Then** it contains no passwords, tokens, photos, or food descriptions.

---

### User Story 7 - Hardened delivery to the browser (Priority: P3)

When the app is served over the internet, the browser is told to use secure connections only and to refuse risky behaviors (embedding the app in other sites, running injected scripts, guessing content types, leaking referrers). Only the app's own address may call its server features from a browser.

**Why this priority**: These protections reduce the damage from mistakes elsewhere, but they matter only once the app is reachable by others.

**Independent Test**: Request the app from a production-like environment and confirm secure-connection enforcement and the required protective headers are present, and that a request from an unlisted site origin is refused.

**Acceptance Scenarios**:

1. **Given** the app is requested over an insecure connection in production, **When** the request arrives, **Then** it is upgraded to or refused in favor of a secure connection.
2. **Given** any page served in production, **When** inspected, **Then** it carries the required protective headers (secure-transport enforcement, content security policy, no-sniffing, referrer restriction, frame protection).
3. **Given** a browser page from a site not on the allowlist, **When** it calls the server features, **Then** the browser-level cross-site access is refused.

---

### Edge Cases

- A username is entered with different capitalization or surrounding spaces: it is treated as the same account without revealing whether the account exists.
- A person tries sign-in while offline: sign-in fails with a clear message; if already signed in earlier, local logging and history still work offline, and server features (AI lookup) report that sign-in or connectivity is needed.
- A session expires while a person is mid-way through reviewing an AI estimate: the unsaved draft is preserved on the device and the person can sign in and continue.
- Two devices are signed in with the same account: both work, and "sign out everywhere" ends both.
- The owner disables an account while that person is signed in: the next server request fails and the app shows the sign-in screen, not a crash.
- The database provider is unreachable: sign-in and server features report a clear temporary error; local logging and history are unaffected.
- Someone submits extremely long or unusual input to the sign-in form: it is rejected safely without errors that reveal internals.
- The second-step device is lost: the person contacts the owner, who resets the account (User Story 2, scenario 5).
- A temporary credential is never used: it expires after a defined period and the owner must reissue it.
- A new user is added to the database incorrectly (missing required fields): they cannot sign in, and the failure is recorded in the audit trail rather than granting partial access.

## Requirements *(mandatory)*

### Functional Requirements

**Access and sign-in**

- **FR-001**: The system MUST identify every user by a unique username and authenticate them with a password plus a second verification step before granting access to any server-backed feature.
- **FR-002**: The system MUST NOT provide any sign-up, self-registration, "request an invite", or account-creation feature, in the user interface or as a server capability.
- **FR-003**: Accounts MUST be created only by the owner directly in the database; the system MUST support provisioning a new account with a temporary credential.
- **FR-004**: On first sign-in with a temporary credential, the system MUST require the person to set their own password and enrol the second verification step before granting access.
- **FR-005**: The system MUST enforce a minimum password strength and MUST reject passwords found in known-breached password lists.
- **FR-006**: Failed sign-in responses MUST NOT reveal whether the username exists or which factor was wrong.
- **FR-007**: Passwords MUST be stored only as salted, slow, one-way hashes, and MUST NEVER be stored or logged in readable form.
- **FR-008**: Temporary credentials MUST expire after a defined period and MUST be single-use.

**Sessions**

- **FR-009**: Sign-in MUST create a session with a limited lifetime and an idle timeout; expired sessions MUST be refused.
- **FR-010**: Session tokens MUST NOT be readable by page scripts and MUST be protected against cross-site request forgery.
- **FR-011**: Users MUST be able to sign out, and to sign out of all their devices; signed-out and revoked sessions MUST be refused immediately.
- **FR-012**: When an account is disabled or its credentials are reset, all of its existing sessions MUST stop working within the revocation window defined in the Success Criteria.

**Authorization**

- **FR-013**: Every server-side feature MUST require an authenticated, active user by default; any public feature MUST be explicitly declared public, and the set of public features MUST be limited to the sign-in flow and a minimal availability check.
- **FR-014**: The system MUST authorize each request against the signed-in user's identity and MUST NOT allow one user to read or affect another user's data, usage, or sessions.
- **FR-015**: The system MUST distinguish a disabled account from an active one and MUST refuse all requests from disabled accounts.

**Local data separation**

- **FR-016**: Data stored on a device MUST be separated per account so that people sharing a browser never see each other's data.
- **FR-017**: Signing out MUST NOT delete local data and MUST make it inaccessible until the owning account signs in again.
- **FR-018**: Pre-existing single-user local data MUST be adopted by the first account that signs in on that browser, only once, without loss.
- **FR-019**: The server MUST NOT store users' food logs, photos, or goals. It stores only identity, credential, session, usage, and audit information.

**Abuse and cost protection**

- **FR-020**: The system MUST rate limit sign-in attempts and apply an increasing delay or temporary lockout after repeated failures, per account and per source.
- **FR-021**: The system MUST enforce a per-user daily limit on AI lookups and an overall AI usage ceiling, with a clear user-facing message and reset time when a limit is reached.
- **FR-022**: Reaching any limit MUST NOT prevent manual food entry or access to locally stored data.
- **FR-023**: The system MUST validate the size, type and content of all incoming data on the server and MUST NOT rely on client-side checks.

**Audit and monitoring**

- **FR-024**: The system MUST record an audit entry for sign-in success and failure, lockouts, sign-out, session revocation, account disable/reset, password/second-step changes, and limit hits.
- **FR-025**: Audit entries MUST NOT contain passwords, session tokens, second-step codes, photos, or food descriptions.
- **FR-026**: Audit entries MUST be retained for a defined period and MUST NOT be editable by regular users.

**Delivery hardening**

- **FR-027**: In production, the system MUST serve only over secure connections and enforce secure transport in browsers.
- **FR-028**: In production, every page and response MUST carry protective browser headers: content security policy, frame protection, no content-type guessing, and a restrictive referrer policy.
- **FR-029**: Cross-site browser access to server features MUST be limited to an explicit allowlist of the app's own origins.
- **FR-030**: Secrets (database credentials, AI key, signing keys) MUST come from the environment's secret configuration and MUST NOT appear in the repository, client code, logs, or error responses.
- **FR-031**: Production error responses MUST NOT reveal stack traces, internal paths, query text, or configuration.
- **FR-032**: The change MUST be developed test-first, with automated tests covering: unauthenticated access, expired/revoked sessions, disabled accounts, cross-user access, sign-in rate limiting, usage limits, and the absence of any sign-up route.

### Key Entities *(include if feature involves data)*

- **User account**: A person the owner has admitted. Has a unique username, an active/disabled state, a role (owner or regular user), a credential state (temporary or set), the status of their second verification step, and creation and last-sign-in times. Provisioned only by the owner in the database.
- **Credential**: What proves identity: a password (stored only as a one-way hash), a second verification step, and, for new or reset accounts, a temporary credential with an expiry.
- **Session**: A period of signed-in access for one account on one device: start time, expiry, idle timeout, and a revoked flag. An account may have several.
- **Usage record**: A per-account count of AI lookups per day, used to enforce daily limits, plus an overall counter for the ceiling.
- **Audit entry**: A time-stamped record of a security-relevant event with the account (when known) and outcome, never containing secrets or food content.
- **Local data space**: The on-device storage area belonging to one account, holding that person's entries, saved foods and goals; the server never receives it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An invited person with a provisioned account can go from the sign-in screen to their Today screen in under 30 seconds after first-time setup, and in under 20 seconds on later sign-ins.
- **SC-002**: A first-time user completes the one-time setup (own password plus second step) on the first attempt at least 90% of the time without help from the owner.
- **SC-003**: 100% of server features, other than the explicitly public sign-in flow and availability check, refuse requests that lack a valid signed-in session, verified by an automated test over every feature.
- **SC-004**: 0 sign-up, registration, or account-creation paths exist in the app or server, verified by an automated test and by review of the sign-in screen.
- **SC-005**: A disabled account or revoked session loses access within 1 minute of the change, with no access after that time.
- **SC-006**: After 10 failed sign-in attempts against one account within 15 minutes, further attempts are refused or delayed for at least the lockout period, even with the correct password.
- **SC-007**: No person can see another person's locally stored data on a shared browser, verified by an automated end-to-end test with two accounts, and the first account's data is fully intact after signing back in.
- **SC-008**: No person can exceed their daily AI lookup limit, and total AI usage never exceeds the overall ceiling, verified by automated tests; manual entry works 100% of the time when limits are reached.
- **SC-009**: Every security-relevant event type listed in FR-024 produces an audit entry, and a scan of the audit record finds 0 passwords, tokens, photos or food descriptions.
- **SC-010**: A production-like deployment passes all hardening checks (secure transport, protective headers, restricted cross-site access) and a dependency vulnerability scan reports 0 high or critical findings.
- **SC-011**: The owner can add a new person, and reset or disable an existing one, in under 5 minutes using the documented database procedure.

## Assumptions

- **Audience**: The owner plus a small, invite-only group of friends (roughly under 20 people). No public sign-up, billing, or large scale is in scope.
- **Credential reading of the request**: "Username and sign-on" is read as username plus password. A second verification step is added because the constitution (Principle VII) requires strong or multi-factor authentication. Passkeys are a possible later upgrade and are out of scope here.
- **Second step**: A time-based one-time code from an authenticator app. Recovery codes and self-service recovery are out of scope; the owner resets lost second steps in the database.
- **Account provisioning**: No admin screen is built. The owner adds, disables, and resets accounts directly in the database, following a documented procedure. A temporary credential is how a new person gets their first sign-in.
- **Password reset**: There is no self-service "forgot password" or email flow. The owner resets accounts in the database. Email is not collected or required.
- **Identity store**: Per the owner's decision, identity and security data live in a cloud-hosted Supabase database. The constitution (v2.0.0, Technical Constraints: Storage) already permits a server-side store for identity and security data only; it still forbids storing food logs, photos, or goals, which this feature honors (FR-019). No constitutional amendment is needed for this decision.
- **Limits**: Default values to be tuned in planning: per-user daily AI lookups, overall daily ceiling, lockout thresholds and durations, session lifetime and idle timeout, temporary-credential expiry, and audit retention. The Success Criteria use 10 failures per 15 minutes and a 1-minute revocation window as the measurable targets.
- **Environment**: Hosting on a public HTTPS address is part of making the app shared; the specific host is chosen in planning. Development and tests run locally against a test identity store and never call the live database or the live AI service.
- **Existing behavior**: Existing logging, history and AI lookup features keep working as they do today for a signed-in user. The photo feature on branch `002-add-photo-from-source` is independent but benefits from the same protection.
- **Dependencies**: The constitution's Principle VII (security) and Principle VI (AI limits) are the governing rules. Data export (Principle III) remains a separate feature.
