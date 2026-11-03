# Feature Specification: Cross-Device Sync

**Feature Branch**: `007-cross-device-sync`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "I want my logs to be synced across devices, which likely means backend-database support for account activity (i.e., tables for foods, meals, calories, history, etc...) This likely will violate some constitutional clauses and that's fine. We can revist them. But the need to access across devices has arisen."

## Constitution Impact *(feature-specific)*

This feature knowingly conflicts with the current constitution (v2.0.0) and needs an amendment via
`/speckit-constitution` before `/speckit-plan` can pass its Constitution Check:

- **Principle III (Local-First, Sync-Ready Data)**: "The server MUST NOT store users' food logs,
  photos, or goals." This feature stores food logs, saved foods and goals on the server.
- **Technical Constraints → Storage**: "User food data is client-side only… It MUST NOT store food
  logs, photos, or goals." Same conflict.
- **Principle VII (Security)**: still applies in full. Server-held food data becomes a new asset
  that the plan's threat model must cover (cross-user access, breach exposure, backups).

Photos are **not** affected: they remain unpersisted and are never synced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the same log on every device (Priority: P1)

I log breakfast on my phone. Later I open the app on my laptop, signed in to the same account, and
breakfast is already there with the same totals. If I edit or delete an entry on one device, the
change shows up on the other.

**Why this priority**: This is the whole reason for the feature. Without it nothing else here
matters.

**Independent Test**: Sign in as one user on two browsers. Add, edit and delete entries on browser A
and confirm browser B shows the same entries and daily totals after it refreshes or regains focus.

**Acceptance Scenarios**:

1. **Given** I am signed in on devices A and B, **When** I log a food on A, **Then** B shows that
   entry and updated daily totals within 10 seconds of B being open and online.
2. **Given** an entry exists on both devices, **When** I edit its quantity on B, **Then** A shows the
   edited quantity and recalculated totals.
3. **Given** an entry exists on both devices, **When** I delete it on A, **Then** it disappears on B
   and does not come back.
4. **Given** I sign in on a brand-new device, **When** the app finishes loading, **Then** my full
   history, saved foods and goals are available there.

---

### User Story 2 - Keep the data I already have (Priority: P1)

I have weeks of entries stored only on my phone, and some on my laptop. When sync is turned on for
my account, everything from both devices is kept and merged into one history. Nothing is lost or
duplicated.

**Why this priority**: Losing existing history would make people distrust the feature on day one.
It has to work the first time sync is turned on.

**Independent Test**: Seed different local-only data on two browsers for one user. Enable sync on
both and confirm the merged history contains every original entry exactly once.

**Acceptance Scenarios**:

1. **Given** I have local-only entries on a device, **When** that device syncs for the first time,
   **Then** all of those entries are uploaded and appear on my other devices.
2. **Given** two devices each hold different local-only entries, **When** both have synced, **Then**
   both show the union of the entries, with no duplicates.
3. **Given** the same saved food exists on both devices (same normalized name and unit), **When** both
   have synced, **Then** I see a single saved food, not two.

---

### User Story 3 - Log while offline (Priority: P2)

I log lunch in a basement with no signal. The entry saves right away and counts toward today's
totals. When the phone reconnects, the entry syncs without me doing anything.

**Why this priority**: Logging happens wherever you are (Principle IV), and connectivity is not
guaranteed. It comes after P1 because sync between online devices already delivers most of the value.

**Independent Test**: Take a signed-in browser offline, log and edit entries, go back online, and
confirm a second browser receives the changes.

**Acceptance Scenarios**:

1. **Given** I am signed in and offline, **When** I log a food, **Then** it is saved and today's totals
   update immediately.
2. **Given** I made changes while offline, **When** the device reconnects, **Then** those changes reach
   my other devices without any manual action.
3. **Given** I have unsynced changes, **When** I look at the main screen, **Then** I can see that some
   changes have not synced yet.

---

### User Story 4 - Trust that my data is mine (Priority: P2)

My friends and I share the app. My log, saved foods and goals are visible only to me, on my devices.
If I remove my account, or the owner removes me, my server-side data is deleted.

**Why this priority**: Storing health data on a shared server is new. Users have to know who can see
it before they rely on it.

**Independent Test**: As user X, attempt to read or change user Y's records through every sync path
and confirm each attempt is refused. Delete user Y and confirm none of Y's food data remains on the
server.

**Acceptance Scenarios**:

1. **Given** two users exist, **When** user X syncs, **Then** X receives only X's own records.
2. **Given** user X sends a change that targets one of user Y's records, **When** the server processes
   it, **Then** the change is refused and Y's data is unchanged.
3. **Given** a user is removed, **When** the removal completes, **Then** their synced food data is
   deleted from the server.
4. **Given** I am about to use sync for the first time, **When** sync starts, **Then** I have been told
   what is stored on the server and who operates it.

---

### Edge Cases

- **Same record edited on two devices before either syncs**: the edit made most recently wins for
  that record. The other edit is discarded, and nothing gets corrupted or duplicated.
- **Edited on one device, deleted on another**: the deletion wins. A deleted entry does not come back
  because of an older edit.
- **Device offline for a long time** (for example, weeks): its changes still sync when it reconnects,
  and it receives everything it missed.
- **Device clock is wrong**: an entry's day (dayKey) is still the day the user picked on that device.
  A wrong clock must not move entries to another day, or let an old edit overwrite a newer one.
- **Signing out, then a different user signs in on the same browser**: the second user never sees
  the first user's data, whether synced or not (Principle III scoping still applies).
- **Signing out with unsynced changes**: the user is warned that some changes have not synced yet.
  The changes stay on the device and sync the next time that user signs in there.
- **Server unavailable**: the app keeps working on local data and retries later. The user is never
  blocked from logging.
- **Goal history**: goals changed on two devices are merged by their effective-from day, so the
  correct goal applies to each day on every device.
- **Device-only preferences** (such as the remembered camera) are never synced.
- **Data export**: export still works and includes the full synced history.

## Requirements *(mandatory)*

### Functional Requirements

**Sync scope**

- **FR-001**: System MUST sync a user's log entries, saved foods and protein-goal history across every
  device where that user is signed in.
- **FR-002**: System MUST NOT sync or store photos, and MUST NOT sync device-only preferences.
- **FR-003**: System MUST sync creates, edits and deletions. Deleted records MUST stay deleted on
  every device.
- **FR-004**: Each synced record MUST keep its stable ID and created/updated timestamps on every
  device.

**Behaviour**

- **FR-005**: A device that is open and online MUST receive changes made on another device within 10
  seconds of them being synced, without the user doing anything.
- **FR-006**: A new device MUST receive the user's complete history, saved foods and goals after
  sign-in.
- **FR-007**: When two devices change the same record before syncing, System MUST keep the most recent
  change, decided in a way that does not depend on device clocks being accurate. A deletion MUST win
  over a concurrent edit.
- **FR-008**: The first time a device syncs, System MUST upload its existing local-only data and merge
  it with the server's copy, without duplicates. Saved foods with the same normalized name and unit
  MUST be merged into one.
- **FR-009**: Logging, editing and viewing MUST keep working offline once the user has signed in on
  that device. Offline changes MUST sync automatically when the device reconnects.
- **FR-010**: The main screen MUST show when there are changes that have not synced, and when sync
  is failing.
- **FR-011**: Signing out with unsynced changes MUST warn the user. Those changes MUST stay on the
  device, unavailable to other users, until the same user signs in again.
- **FR-012**: Nutrition totals MUST be identical on every device for the same data. Sync MUST store
  and send values at full precision (Principle II); rounding happens only at display time.

**Privacy & security**

- **FR-013**: Every sync request MUST be authenticated and authorized against the caller's identity.
  A user MUST never be able to read, create, change or delete another user's records.
- **FR-014**: The server MUST validate every incoming record (shape, units, value ranges, size
  limits) and reject invalid records without applying any of that request's partial data.
- **FR-015**: Food data stored on the server MUST be encrypted at rest and in transit, and MUST NOT
  be written to logs.
- **FR-016**: Removing a user (by the owner or by the user) MUST delete all of that user's synced food
  data from the server. Backups follow the stated retention period.
- **FR-017**: Before a user's data is first synced, System MUST tell them what is stored on the
  server and that the owner operates it.
- **FR-018**: Sync endpoints MUST be rate limited and size limited per user, consistent with
  Principle VII abuse-resistance rules.
- **FR-019**: Security-relevant sync events (refused cross-user attempts, rejected payloads, rate-limit
  hits, user data deletion) MUST be recorded in the audit log, without food contents.

### Key Entities

- **Log Entry**: one logged food on a given day. Has a name, quantity with unit, macros, source
  (manual or AI), an optional link to a saved food, the day it belongs to, and when it was logged.
  Owned by exactly one user.
- **Saved Food**: a reusable food with reference quantity and macros, used for quick picks. Ordered
  by last use. Owned by exactly one user.
- **Protein Goal**: a goal value (or cleared goal) effective from a given day onward. The history of
  these decides the goal for any day. Owned by exactly one user.
- **Deletion Marker**: a record that something was deleted, so that deletions reach every device and
  stale copies are not brought back.
- **Device Sync State**: per device and user, what has been sent and received, and which local changes
  are still pending.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A change made on one online device appears on another open, online device within 10
  seconds in at least 95% of attempts.
- **SC-002**: After first-time sync on two devices with different existing data, 100% of the original
  entries are present exactly once on both devices.
- **SC-003**: A new device shows a user's full history (at least one year of daily logging) and is
  ready to use within 15 seconds of signing in, on a typical home connection.
- **SC-004**: Logging a food offline takes the same number of interactions, and feels as fast, as
  logging online (Principle IV limit of 3 interactions for a previously used food still holds).
- **SC-005**: Automated tests show 0 successful cross-user reads or writes across all sync paths.
- **SC-006**: Daily totals for any given day are identical on every device after sync, checked
  against hand-verified reference days.
- **SC-007**: No synced change is lost in conflict tests covering concurrent edits, edit-versus-delete,
  and long offline periods, apart from the losing side of a same-record conflict as defined in FR-007.

## Assumptions

- Sync is on for every user. Data that already exists on a device is merged in automatically on its
  first sync (User Story 2).
- Food data stored on the server is readable by the server, and so technically by the owner as its
  operator. Users are told this (FR-017). End-to-end encryption is out of scope for this feature.
- The resolution unit for conflicts is the whole record (last change wins per record), not individual
  fields. This is simpler and enough for a small personal tool.
- "Meals" in the request refers to how entries are grouped today (entries logged on a day). No new
  meal entity (breakfast/lunch/dinner) is added by this feature.
- Calories are derived from macros and are not stored separately.
- Existing authentication, sessions, invites and the owner role (feature 003) are reused unchanged.
- Server backups of food data are kept for no more than 30 days, after which data deleted under
  FR-016 is gone from backups too.
- Users are on the small invite-only scale described in the constitution. Large-scale performance
  is out of scope.
- The constitution will be amended (Principle III and the Storage constraint) before planning.
