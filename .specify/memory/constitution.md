<!--
Sync Impact Report
- Version change: 2.0.0 → 3.0.0 (MAJOR: Principle III redefined incompatibly; the server may
  now store users' activity data)
- Modified principles:
  - III. Local-First, Sync-Ready Data → III. Synced, Offline-Capable Data
  - VII. Security & Authentication: Accountability now also requires disclosing that activity
    data is stored on the server
- Modified sections:
  - Technical Constraints → Storage: activity data lives in the application database inside the
    existing PostgreSQL database
- Added sections:
  - Technical Constraints → Cross-device
- Removed sections: none
- Deferred TODOs: none
- Affected in-flight work: specs/007-cross-device-sync ("Constitution Impact" section now
  resolved by this amendment)
-->
# Macro Counter Constitution

## Core Principles

### I. Test-First (NON-NEGOTIABLE)

All production code MUST be written test-first using the Red-Green-Refactor cycle:

- A failing test MUST exist and be observed failing before the implementing code is written.
- Code MUST be written only to make a failing test pass, then refactored with tests green.
- Bug fixes MUST start with a test that reproduces the bug.
- No change may be merged to `master` with failing or skipped tests.
- UI behavior MUST be covered by component or end-to-end tests at the level of user-visible
  outcomes (e.g. "logging a food updates the daily totals").

Rationale: TDD keeps a solo project's design honest and makes refactoring safe without a
second reviewer.

### II. Correct Nutrition Math

Macro and calorie calculations are the core of the product and MUST be trustworthy:

- All nutrition calculations (per-serving scaling, daily totals, goal progress, unit
  conversions) MUST live in pure functions with no UI, storage, or I/O dependencies.
- Quantities MUST carry explicit units (g, ml, serving); implicit unit assumptions are forbidden.
- Rounding MUST happen only at display time; stored and computed values keep full precision.
- Edge cases (zero quantities, missing nutrient values, very large servings) MUST have tests.
- Every nutrition function MUST have unit tests covering typical inputs, boundary values, and
  invalid inputs (negative, non-numeric, missing units).
- Calculations MUST be checked against known reference values (e.g. hand-verified totals for
  sample meals) in addition to property checks such as "totals equal the sum of entries".
- The nutrition-math module MUST maintain 100% line and branch coverage; a drop below this
  blocks merging.

Rationale: A macro counter that gives wrong totals is worse than no tool at all.

### III. Synced, Offline-Capable Data

A user's activity data (food log entries, saved foods, goals and their history) MUST be available
on every device where that user signs in. The server keeps the account's copy in the application
database, and each device keeps a local copy so the app stays usable offline for logging, viewing
history and manual entry once the user has signed in on that device.

- The server MAY store users' activity data in the application database (see Technical
  Constraints → Storage). It MUST NOT store photos. Device-only preferences (e.g. a camera ID)
  MUST stay on the device and MUST NOT be synced.
- Every server-side activity record MUST be owned by exactly one user ID. Every read and write
  MUST be scoped to the authenticated caller's ID on the server (Principle VII). A user MUST never
  be able to read or change another user's activity data.
- Local data MUST be scoped to the signed-in user's ID (separate database or key prefix), so two
  people using one browser never see each other's data. Signing out MUST NOT silently delete
  local data, including changes that have not synced yet, but MUST make it inaccessible to other
  users on that browser.
- All persistence MUST go through a single storage abstraction (repository interface) on each
  side. UI and domain code MUST NOT call browser storage APIs, the sync transport, or the
  database directly.
- Every record MUST have a stable unique ID (e.g. UUID) and `createdAt`/`updatedAt` timestamps.
  Deletions MUST be recorded so they reach every device, and a deleted record MUST NOT come back
  from a stale copy.
- Conflict resolution rules MUST be deterministic, documented in the feature plan, and covered by
  tests (concurrent edits, edit versus delete, long offline periods). They MUST NOT rely on device
  clocks being accurate.
- Changes made offline MUST be kept and synced automatically when the device reconnects. The UI
  MUST show when changes have not synced or when sync is failing.
- Stored data schemas, both local and server-side, MUST be versioned, and schema changes MUST
  include a tested migration.
- The server MUST validate every incoming record (shape, explicit units, value ranges, size) and
  MUST reject an invalid request as a whole, never applying partial data.
- Removing a user MUST delete their activity data from the application database. Backup
  retention for that data MUST be stated in the feature plan.
- Users MUST be able to export their data in a portable format (JSON or CSV).

Rationale: People log from more than one device, and a log that exists only on one phone keeps
them from switching devices. Keeping a local copy keeps logging fast and offline-capable
(Principle IV). Server-side ownership checks and validation take the place of the protection that
device-only storage used to give.

### IV. Fast Logging on Desktop & Mobile

The app MUST be fully usable in both desktop and mobile browsers, and logging food (the most
frequent action) MUST stay quick on both:

- Logging a previously used food MUST take no more than 3 interactions from the main screen.
- The UI MUST be usable at mobile viewport widths (≥ 360px) as well as on desktop.
- Every feature MUST work on both desktop and mobile; no feature may be desktop-only or
  mobile-only.
- The UI MUST support both mouse/keyboard and touch input, with touch targets of at least
  44×44 CSS px.
- Today's totals versus goals MUST be visible without navigating away from the main screen.

Rationale: Food gets logged wherever you are, at a desk or on a phone. If logging is slow on
either one, it stops happening and the tool is no longer useful.

### V. Simplicity (YAGNI)

- Build only what a current spec requires; speculative features and abstractions are forbidden.
- New runtime dependencies MUST be justified in the feature plan (what it replaces, why it is
  needed).
- Prefer the platform (standard Web APIs) over frameworks or libraries when the result is
  comparably simple.
- Any complexity that violates this principle MUST be recorded in the plan's Complexity Tracking
  section.

Rationale: This is a personal tool maintained by one developer; every extra moving part costs
maintenance time.

### VI. AI-Assisted Food Lookup (Claude API)

The app uses the Claude API to look up foods and return their nutritional information. Lookups
accept a text description, a photo, or both. Any photo the user chooses to provide (a meal, a
packaged food, a nutrition label, a menu, a screenshot) MAY be sent to Claude for a macro
estimate. Because AI output can be wrong, it is treated as a suggestion, never as trusted data:

- Photo input MUST be supported by the same single AI client module, structured-output schema,
  validation, and confirmation rules as text input; there is no separate, weaker path for photos.
- A photo MUST be sent to the Claude API only as a result of an explicit user action for that
  lookup, and MUST NOT be persisted by the app or sent anywhere else unless the user opts in.
- Photos MAY be downscaled or re-encoded on the device before upload to meet API limits, and
  EXIF/location metadata MUST be stripped before sending.
- Estimates derived from a photo (portion sizes, unseen ingredients) are inherently less certain;
  the UI MUST label them as estimates, and the response schema SHOULD include a confidence
  indicator that is shown to the user.
- If a photo does not contain recognizable food, Claude's response MUST be able to say so, and
  the app MUST surface that as an error rather than inventing nutrition data.

- All Claude API calls MUST go through a single AI client module; UI and domain code MUST NOT
  call the API directly.
- Claude MUST be asked for structured output (JSON) with explicit units, and every response
  MUST be validated against a schema before use. Invalid responses MUST surface an error, never
  partial data.
- AI-provided values MUST pass two kinds of sanity checks, with limits and tolerances stated in
  the feature plan:
  - **Hard checks**: a response with negative values, non-finite numbers, or values outside the
    plan's allowed ranges MUST be rejected and never shown.
  - **Consistency checks**: values that fail a consistency check (e.g. calories not matching
    4/4/9 kcal per gram of protein/carbs/fat within the stated tolerance, or an implausibly
    large portion) MAY be shown, but only with a clear warning. The user MUST explicitly accept
    the warning or edit the values before the data can be confirmed.
- The user MUST review and confirm (or edit) AI-provided nutrition data before it is saved.
  Saved foods MUST record that the data came from AI.
- The Claude API key MUST NOT be committed to the repository or bundled into client code that
  is publicly served. Because the key is shared and billed to the owner, AI endpoints MUST
  require an authenticated user (Principle VII), enforce per-user rate limits and a per-user
  daily/monthly usage cap, and have a global spend ceiling. Exceeding a limit MUST return a clear
  error and MUST NOT affect manual entry.
- AI lookup MUST NOT block core functionality: when it is offline, unconfigured, or failing, the
  user MUST still be able to enter nutrition data manually.
- Automated tests MUST mock the Claude API; the test suite MUST NOT make live API calls. Tests
  MUST cover malformed, incomplete, and implausible AI responses, and photo-input cases
  (oversized image, unsupported format, non-food image).
- The model ID MUST be configured in exactly one place.

Rationale: AI lookup removes most of the typing from logging new foods, but the numbers feed
directly into the totals that Principle II protects, so they must be validated and confirmed.
Consistency checks warn instead of reject because the 4/4/9 rule is inexact for high-fiber foods
and alcohol; rejecting would block legitimate entries.

### VII. Security & Authentication (NON-NEGOTIABLE)

The app is a personal project that the owner also shares with a small, invited group of friends.
It MUST be built as if it were exposed to the public internet, because it will be:

- **Access**: Registration MUST be invite-only (owner-issued, single-use, expiring invites). There
  MUST be no open sign-up. Every `/api` endpoint except health/status and the sign-in flow MUST
  require authentication, enforced server-side by default (deny by default; opting an endpoint
  out MUST be explicit and tested).
- **Credentials**: Authentication MUST use phishing-resistant or strong multi-factor methods
  (passkeys/WebAuthn preferred; otherwise a strong password hash such as Argon2id or bcrypt
  plus TOTP). Passwords, if used, MUST be checked against breached-password lists. Credentials
  MUST NEVER be stored or logged in plaintext. Hand-rolled cryptography is forbidden; use
  vetted platform/framework libraries.
- **Sessions**: Session tokens MUST be short-lived, revocable server-side, and stored in
  `HttpOnly`, `Secure`, `SameSite` cookies (or an equivalent that is not readable by page
  scripts). Sign-out and "revoke all sessions" MUST work. Cookie-based sessions MUST have CSRF
  protection.
- **Authorization**: Every request MUST be authorized against the caller's identity. There MUST
  be a distinct owner/admin role (manage invites, disable users, view usage) and a regular user
  role. A user MUST never be able to read or affect another user's data or quotas.
- **Transport & browser hardening**: Production MUST serve HTTPS only, with HSTS. The app MUST send
  a restrictive Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, and
  frame-ancestors protection. CORS MUST be an explicit allowlist, never `*`. `AllowedHosts` MUST
  NOT be `*` in production.
- **Abuse resistance**: Sign-in, invite redemption and AI endpoints MUST be rate limited, with
  lockout or backoff on repeated failures. Request sizes, upload types and content MUST be
  validated server-side (already required for photos) and never trusted from the client.
- **Secrets & configuration**: Secrets MUST come from environment/secret stores, never the
  repository, logs, or client bundle. Production config MUST differ from development config
  (no development exception pages, no permissive defaults).
- **Dependencies & supply chain**: Dependencies MUST be pinned via lockfiles, scanned for known
  vulnerabilities in CI (`dotnet list package --vulnerable`, `npm audit`), and kept patched.
  A high/critical finding blocks merging until fixed or explicitly risk-accepted in the plan.
- **Logging & privacy**: Security-relevant events (sign-in success/failure, invite use,
  session revocation, role changes, quota hits) MUST be recorded in an audit log. Logs MUST
  NOT contain credentials, tokens, photos, or food descriptions.
- **Testing**: Security behavior MUST be test-first (Principle I): unauthenticated and
  cross-user access attempts, expired/revoked sessions, rate-limit enforcement, and invite
  misuse MUST each have automated tests.
- **Threat model**: Each feature that changes authentication, authorization, data exposure,
  or external calls MUST include a short threat model in its plan (assets, trust boundaries,
  top threats, mitigations), using OWASP ASVS Level 2 and the OWASP Top 10 as the baseline.
- **Accountability**: Friends MUST be told what is sent to Claude (food text and photos) and
  that the owner operates the server, before they first use AI lookup. They MUST also be told,
  before their activity data is first synced, that it is stored on the owner's server and can be
  read by the owner as its operator. The owner MUST be able
  to remove a user and revoke all of their sessions immediately.

Rationale: One leaked session or an exposed endpoint would let strangers spend the owner's Claude
budget or impersonate a friend. The owner is the only operator, so the guardrails must be built
in and automatically tested rather than depending on vigilance.

## Technical Constraints

- **Platform**: Browser-based web application, installable as a PWA for phone use where practical.
  It is deployed to a host reachable by the owner and invited friends (not only localhost or a
  home LAN), over HTTPS.
- **Audience**: The owner first; a small invite-only group of friends second. This is not a public
  product. Features for open sign-up, billing, or large scale are out of scope (Principle V).
- **Storage**: The server stores identity and security data (users, credentials, invites,
  sessions, quotas, audit events) and users' activity data (food log entries, saved foods, goals)
  in the existing PostgreSQL database. Activity data lives in the application database, kept in
  tables separate from the identity and security tables, and is managed through versioned
  migrations. Each device keeps a per-user local copy (e.g. IndexedDB) behind the storage
  abstraction in Principle III. Photos MUST NOT be stored on the server (see Principle VI for photo handling). Activity
  data MUST be encrypted in transit and at rest, and MUST NOT appear in logs. A server-side proxy
  for Claude API calls is permitted (see AI Integration).
- **Cross-device**: Every feature that reads or writes activity data MUST work the same on every
  device a user signs in on. Its plan MUST describe how the change syncs, including offline
  behavior and conflicts (Principle III).
- **Authentication & Access**: Invite-only accounts with strong authentication, as required by
  Principle VII.
- **Privacy**: Food logs and personal data MUST NOT be sent to third-party services. External
  lookups, including Claude API requests, MUST send only the food query (e.g. "1 cup cooked
  rice") and/or a user-provided photo for that lookup, never log history, goals, or other
  personal data. The identity of the requesting user MUST NOT be sent to Anthropic.
- **AI Integration**: Nutrition lookup uses the Anthropic Claude API, with text and image input.
  The API key is held by the authenticated server-side proxy and is never sent to clients.
  Letting users enter their own key at runtime is permitted only as an additional option and
  does not replace the proxy's authentication and quota rules.
- **Language**: A typed language (e.g. TypeScript) SHOULD be used so units and data shapes are
  checked at compile time.

## Development Workflow

- Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`.
- Each plan MUST include a Constitution Check that confirms compliance with every principle above,
  including a threat model when Principle VII requires one.
- CI MUST run the full test suites, linters, and dependency vulnerability scans; a failing scan
  blocks merging (Principle VII).
- Tasks MUST order test tasks before their implementation tasks (Principle I).
- Work happens on feature branches. A branch is merged to `master` only when the full test suite
  passes and lint/type checks are clean.
- Commits SHOULD be small and focused, and their messages SHOULD describe the change.

## Governance

- This constitution supersedes other development practices for this project. When a practice
  conflicts with it, the constitution wins.
- Amendments are made with `/speckit-constitution`, must be recorded in the Sync Impact Report,
  and are committed alongside any template or plan updates they require.
- Versioning follows semantic versioning:
  - MAJOR: a principle is removed or redefined incompatibly.
  - MINOR: a principle or section is added or materially expanded.
  - PATCH: clarifications and wording fixes.
- Compliance is checked during `/speckit-plan` (Constitution Check) and `/speckit-analyze`.
  Unjustified violations block implementation.
- Before the app is made reachable by anyone other than the owner, a security review against
  Principle VII (for example `/security-review` plus a manual ASVS L2 checklist pass) MUST be
  completed and its findings resolved or risk-accepted in writing.

**Version**: 3.0.0 | **Ratified**: 2026-10-07 | **Last Amended**: 2026-10-30
