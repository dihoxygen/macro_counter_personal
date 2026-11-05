# ASVS Level 2 Checklist: Cross-Device Sync (T119)

**Purpose**: Check feature 007 against OWASP ASVS 4.0.3 Level 2 before release (Constitution: Governance)
**Date**: 2026-11-05
**Feature**: [spec.md](../spec.md) · threat model in [plan.md](../plan.md#threat-model-principle-vii-baseline-owasp-asvs-l2--top-10)
**Baseline**: [003's full pass](../../003-auth-security-foundations/checklists/asvs-l2.md), and its [accepted risks](../../003-auth-security-foundations/plan.md#accepted-risks-t126-asvs-level-2)

## Scope

This pass covers what 007 changed. It does not re-evaluate all 173 requirements.

- **Carried over from 003 unchanged:** V2 Authentication, and the rows of V3, V4, V5, V7, V8, V13 and V14 not listed below. This branch changes no backend code under `Auth/`, adds no packages, and leaves the CSP and security headers as they were.
- **Re-checked:** every row that sync touches, listed below.
- **New here:** V6, which 003 left out because the server held no health-related data.

Paths are relative to `backend/MacroCounter.Api/` unless they start with `frontend/` or `specs/`.

**Status terms** are as in 003. **Deploy** means met by a step in `docs/deploy.md`, still to be confirmed on the live host when 007 is deployed.

## Security review

`/security-review` ran on the branch on 2026-11-04 and found one issue, which is fixed:

- **A tab left open could take in another account's data** (Medium, cross-account exposure on a shared browser).
  - **Problem:** the session cookie belongs to the browser, but a tab's local database belongs to one account. After someone else signed in, a stale tab's next pull wrote their records into the wrong database.
  - **Fix:** every `/api/sync` request sends `X-Sync-Account`, and the server refuses a mismatch in the same request (`Sync/SyncEndpoints.cs`, research R22, plan threat S16).
  - **Tests:** written first and failing before the fix: `SyncIsolationTests`, and the two-tab test in `frontend/tests/e2e/auth/sync-two-devices.spec.ts`, which was confirmed to fail with the check turned off.

## Found by this pass

Checking V5 against the code found two ways to get a 500 from input the validator accepts. Neither exposed data or crossed accounts, because the whole push rolled back. Both are fixed, with tests written first.

- **Timestamps with a non-UTC offset:** the database driver refuses them. The JSON converter now reads every timestamp as UTC (`Sync/SyncContracts.cs`, `SyncPushTests.A_timestamp_in_any_offset_is_stored_as_the_same_moment`).
- **Times at the ends of the calendar:** skew correction overflowed. It now works in wider numbers and clamps (`Sync/ClockSkew.cs`, `ClockSkewTests.Times_at_the_ends_of_the_calendar_do_not_overflow`).

## V3 Session Management

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 3.3.1 | Logout and expiry invalidate the token | Met | Unchanged on the server. Sign-out now also drains sync first, so no late request meets the ended session (`frontend/src/sync/syncService.ts`, `drain`) |
| 3.3.2 | Periodic re-authentication | Met | A visible tab's polling keeps the 24-hour idle timer alive (research R5). Hidden tabs do not poll, and the 7-day absolute limit still applies |
| 3.7.1 | Full session before sensitive changes | Met | `/api/sync/*` has no policy of its own, so the fallback policy requires a full session. Setup and pending sign-in sessions are refused |

## V4 Access Control

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 4.1.1 | Enforced on a trusted service layer | Met | Endpoint filter and session policy on the server (`Sync/SyncEndpoints.cs`) |
| 4.1.2 | Access attributes can't be changed by users | Met | The user comes only from the session's `sub` claim. `X-Sync-Account` is compared and never selects a user |
| 4.1.3 | Least privilege | Met | `ActivityData` migration: `select, insert, update` on activity tables, `select, insert` on `entry_versions`, no `delete`, no DDL. `AppRoleGrantTests` |
| 4.1.5 | Fail securely | Met | An unset or empty `macro.user_id` gives no rows and refuses writes (`nullif` in the RLS policy). `AppRoleGrantTests` |
| 4.2.1 | IDOR protection | Met | Sync requests do carry record IDs, but every primary key includes `user_id`, and RLS pins each statement to the session's user. `SyncIsolationTests` covers upsert, delete, restore and versions with another user's IDs |
| 4.2.2 | Strong anti-CSRF | Met | The `CsrfEndpointFilter` on the `/api` group covers both sync `POST`s; `SyncNoticeTests.Posts_need_a_csrf_token`. The token is bound to the user (`CrossUserTests`) |

## V5 Validation, Sanitization and Encoding

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | Met | Updated: `since` and `limit` are now query parameters. They are typed, and repeated or malformed values get 400 (`SyncPullTests.A_bad_query_is_refused_as_bad`) |
| 5.1.2 | Mass assignment | Met | `SyncJson` rejects unknown properties, so `restoredAt`, `userId` and photo fields are refused |
| 5.1.3 | Positive validation of all input | Met | `Sync/SyncValidator.cs` with the shared vectors (`vectors/bounds.json`), and database check constraints behind it |
| 5.1.4 | Structured data strongly typed | Met | Each record is parsed into a typed record, and failures are reported per change |
| 5.2.2 | Unstructured data length-limited | Met | Names ≤ 120, a push ≤ 256 KiB and 200 changes, a page ≤ 500 records (`SyncLimitsTests`) |
| 5.3.3 | XSS protection | Met | Pulled data is rendered by React. No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `frontend/src`. Charts are plain SVG |
| 5.3.4 | Parameterized queries | Met | All values in `SyncStore` are positional parameters. Interpolated table and column names are all compile-time constants |
| 5.4.3 | Integer overflow | Met (fixed) | See [Found by this pass](#found-by-this-pass). The largest `since` and `limit` are handled (`SyncPullTests.The_largest_values_are_handled`) |
| 5.5.3 | Untrusted deserialization avoided | Met | Typed System.Text.Json, with no polymorphic type handling |
| 5.5.4 | `JSON.parse` in browsers | Met | `response.json()` and Zod schemas for every pulled record (`frontend/src/api/sync.ts`) |

## V6 Stored Cryptography

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 6.1.1 | Regulated private data encrypted at rest | Met | Supabase encrypts storage and backups with AES-256 (research R9) |
| 6.1.2 | Regulated health data encrypted at rest | Met | As 6.1.1. Encryption is at the storage layer, so the operator can read the data. That is by design, disclosed to users, and accepted by constitution v3.0.0 (threats S6, S7) |
| 6.1.3 | Regulated financial data encrypted at rest | N/A | None held |
| 6.2.x | Approved algorithms | Met | No new cryptography in this feature |
| 6.4.x | Secret and key management | N/A | Application code holds no encryption key for this data |

## V7 Error Handling and Logging

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 7.1.1 | No credentials logged | Met | Unchanged; the audit scan covers sync (`SecretScanTests`) |
| 7.1.2 | No other sensitive data logged | Met | A sentinel food name in stored and refused pushes reaches neither logs nor audit (`SecretScanTests`, `AuditScenario`). Refused requests log no query or body (`Security/RefusedRequestLogging.cs`) |
| 7.1.3 | Security events logged | Met | `sync_rejected` with a reason code, `rate_limited` with reason `sync`, `user_deleted`. Other refusals through the refused-request log. `AuditCoverageTests` |
| 7.4.1 | Generic error with an ID | Met | Problem responses carry indexes and fixed codes, never a field value (`SyncValidatorTests`) |

## V8 Data Protection

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 8.1.1 | Not cached by intermediaries | Met | `no-store` on `/api` (`Security/SecurityHeadersMiddleware.cs`) |
| 8.1.2 | Server-side temporary copies purged | Met | Photos unchanged. Replaced entry states are purged after 90 days (8.3.8) |
| 8.2.2 | No sensitive data in browser storage | Risk-accepted | As 003: IndexedDB by design. Local data now also holds entry history |
| 8.2.3 | Authenticated data cleared after session end | Risk-accepted | As 003: kept on the device, locked to that account. This is what keeps unsynced changes safe (FR-011) |
| 8.3.1 | No sensitive data in query strings | Met | Updated: `since` and `limit` are revision numbers, not personal data. Food data travels only in bodies |
| 8.3.2 | Users can export or delete their data | Met (closes 003 G10) | Export my data (`frontend/src/auth/AccountMenu.tsx`, FR-036). Deletion by the owner on request (`macro_admin.delete_user`, FR-016), `DeleteUserTests`. Self-service deletion is out of scope |
| 8.3.3 | Clear notice and opt-in before use | Met | A server-enforced sync notice before any upload (`SyncNoticeTests`, FR-017), stating who can read the data and the 90-day retention |
| 8.3.4 | Sensitive data identified, with a policy | Met | plan.md threat model (S1–S16), data-model.md |
| 8.3.5 | Access to sensitive data audited | **Needs a decision** | Was N/A in 003 because the server held no health data. Now it does. See [G15](#g15-reads-of-activity-data-are-not-audited-835) |
| 8.3.7 | Encryption with approved algorithms | Met | Unchanged, plus V6 above |
| 8.3.8 | Retention and automatic deletion | Met, Deploy | `purge_expired` removes versions after 90 days, and tombstones hold no food data (research R16, `ActivityDataMigrationTests`). Needs `pg_cron` on the host (deploy.md step 1.3) |

## V13 API and Web Service

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 13.1.3 | No secrets in API URLs | Met | None |
| 13.1.4 | Authorization at route and resource level | Met | Fallback policy at route level; `user_id` keys and RLS at resource level |
| 13.1.5 | Unexpected content types rejected | Partial | As 003: 400 rather than 415 |
| 13.2.1 | Only valid HTTP methods | Met | Sync maps GET and POST only, and `EndpointInventoryTests` holds them to the contract |
| 13.2.2 | Schema validation before accepting input | Met | `contracts/sync-api.yaml`, strict typed reading plus field validation |
| 13.2.3 | CSRF protection for cookie APIs | Met | As 4.2.2 |
| 13.2.5 | Content-Type checked | Met | `HasJsonContentType` in `StrictJson` |

## V14 Configuration

| ID | Requirement (short) | Status | Evidence |
|---|---|---|---|
| 14.1.1 | Secure, repeatable build and deploy | Partial | As 003. CI now also keeps snapshots of failed e2e tests for 7 days. They hold test data only |
| 14.2.1 | Components up to date | Met | No new packages; the gate's scans pass in CI |
| 14.4.3 | CSP | Met | Unchanged; `connect-src 'self'` already covers `/api/sync` |

## Gaps and decisions

### G15. Reads of activity data are not audited (8.3.5)

`sync_rejected`, `rate_limited` and `user_deleted` are audited, but successful reads are not. The owner's direct reads through the Supabase SQL editor leave no record in the app either.

**Recommendation: accept.** Each person only ever reads their own data, and that happens every 5 seconds, so auditing it would add noise and no insight. Owner access is disclosed in the sync notice (constitution VII, threat S7). To be looked at again before the app opens beyond a small group of known people.

**Owner's decision:** pending.

## Not covered here

- Manual scenarios V1–V11 (T118).
- Deploy rows, which can only be confirmed on the live host.
