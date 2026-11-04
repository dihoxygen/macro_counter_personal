# Feature Specification: Cross-Device Sync

**Feature Branch**: `007-cross-device-sync`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "I want my logs to be synced across devices, which likely means backend-database support for account activity (i.e., tables for foods, meals, calories, history, etc...) This likely will violate some constitutional clauses and that's fine. We can revist them. But the need to access across devices has arisen."

## Constitution Impact *(feature-specific)*

This feature conflicted with constitution v2.0.0. Amendment v3.0.0 resolves the conflicts below, and
the plan's Constitution Check is made against v3.0.0:

- **Principle III (Local-First, Sync-Ready Data)**: "The server MUST NOT store users' food logs,
  photos, or goals." This feature stores food logs, saved foods and goals on the server.
- **Technical Constraints → Storage**: "User food data is client-side only… It MUST NOT store food
  logs, photos, or goals." Same conflict.
- **Principle VII (Security)**: still applies in full. Server-held food data becomes a new asset
  that the plan's threat model must cover (cross-user access, breach exposure, backups).

Photos are **not** affected: they remain unpersisted and are never synced.

## Clarifications

### Session 2026-11-03

- Q: How should meal categories (breakfast, lunch, dinner, snacks) work for log entries? → A: Fixed set of four (Breakfast, Lunch, Dinner, Snacks); every new entry gets one, pre-filled from time of day and changeable; existing entries become "Uncategorized".
- Q: When you ask for history of "changes", what should be kept when an entry is edited or deleted? → A: Keep every previous version of each log entry for 90 days; the user can view an entry's history and restore a deleted or earlier version.
- Q: What should make a food count as "frequently used" in the quick-pick list? → A: Number of uses in the last 30 days, with last use breaking ties; the usage is synced so every device shows the same order.
- Q: How should daily calorie and macro totals from past days be kept and shown? → A: Always calculated from the entries (no stored daily totals), plus a trends view of daily calories and macros over 7, 30 and 90 days against the protein goal.
- Q: Should meal categories, entry history, frequently used foods and trends ship in 007 or a separate feature? → A: All in 007 with one data design, staged: sync stories (P1/P2) ship first, then the new capabilities as P3 stories.

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

### User Story 5 - Sort my day into meals (Priority: P3)

When I log a food it lands in Breakfast, Lunch, Dinner or Snacks based on the time, and I can switch
it. My day is grouped by meal with a subtotal for each.

**Why this priority**: Makes a day easier to read, but sync is useful without it. Staged after the
sync stories; its data is designed in from the start (FR-001).

**Independent Test**: Log foods at different times of day, change one entry's category, and confirm
grouping, subtotals and the change appear the same on a second device.

**Acceptance Scenarios**:

1. **Given** it is 08:30 on my device, **When** I log a food, **Then** it is pre-filled as Breakfast and I
   can change it without an extra step in the logging flow.
2. **Given** a day with entries in several categories, **When** I view it, **Then** entries are grouped by
   category with subtotals, and the daily total equals the sum of all entries.
3. **Given** entries logged before this feature, **When** I view their day, **Then** they appear under
   "Uncategorized" until I choose a category.

---

### User Story 6 - Undo a mistake (Priority: P3)

I accidentally deleted yesterday's dinner, or overwrote a quantity. I open the entry's history (or the
day's recently deleted list) and restore the version I want, and every device shows it.

**Why this priority**: A safety net that matters more once data lives on several devices, but not
needed for sync to work.

**Independent Test**: Edit and then delete an entry, restore the earlier version on another device,
and confirm both devices show the restored entry with its full history.

**Acceptance Scenarios**:

1. **Given** an entry I have edited twice, **When** I open its history, **Then** I see the current
   version and both previous versions, newest first.
2. **Given** an entry I deleted within the last 90 days, **When** I restore it, **Then** it reappears with
   the same ID on every device and the restore is recorded in its history.
3. **Given** a version replaced more than 90 days ago, **When** I open the history, **Then** that version
   is no longer listed.

---

### User Story 7 - My usual foods are at the top (Priority: P3)

The foods I log most this month are first in my quick picks, on every device.

**Why this priority**: Speeds up repeat logging (Principle IV); the existing last-used order already
works in the meantime.

**Independent Test**: Log one food five times and another once over a few days, across two devices,
and confirm both devices list them in the same frequency order.

**Acceptance Scenarios**:

1. **Given** food X logged 5 times and food Y 2 times in the last 30 days, **When** I open quick picks,
   **Then** X is above Y on every device.
2. **Given** a food last logged 40 days ago, **When** I open quick picks, **Then** it appears after all
   foods used in the last 30 days.

---

### User Story 8 - See how I'm trending (Priority: P3)

I open trends and see my daily calories and macros for the last 7, 30 or 90 days, alongside my
protein goal, with the average for the period.

**Why this priority**: Turns synced history into insight, but depends on sync and history being in
place first.

**Independent Test**: Seed known entries across 30 days on one device, sync, and confirm the trends
view on another device shows matching per-day values and averages.

**Acceptance Scenarios**:

1. **Given** 30 days of entries, **When** I open trends for 30 days, **Then** each day's values match that
   day's totals in the day view, and the protein goal shown is the one that applied that day.
2. **Given** days with no entries in the range, **When** I view trends, **Then** those days show "no data"
   and are excluded from the average.
3. **Given** I edit an entry from last week, **When** I reopen trends, **Then** that day's values reflect
   the edit.

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
- **Entries logged before categories existed**: they show as "Uncategorized" on every device. The user
  can assign a category to them, but is never forced to.
- **Restoring after a deletion on another device**: an explicit restore is the newest change, so it
  wins over the earlier deletion and the entry reappears on every device. The deletion stays in the
  entry's history.
- **Two devices edit the same entry concurrently**: the losing edit (FR-007) is still kept as a
  version in history, so it can be restored.
- **Entry older than 90 days in history**: its earlier versions are gone; only its current version (or
  nothing, if it was deleted more than 90 days ago) remains.
- **Same food logged on two devices while offline**: both uses count once each after sync; the
  quick-pick order is the same on both devices once they have synced.
- **Editing a past day**: changing, deleting or restoring an entry on an earlier day updates that day's
  totals and the trends view on every device after sync.
- **Category changed on two devices**: the category is part of the entry, so the normal per-entry
  conflict rule (FR-007) applies.

## Requirements *(mandatory)*

### Functional Requirements

**Sync scope**

- **FR-001**: System MUST sync a user's log entries (including meal category and entry history), saved
  foods and protein-goal history across every device where that user is signed in. The stored data
  design MUST cover the P3 capabilities (User Stories 5–8) from the start, so delivering them later
  needs no breaking change to data already synced.
- **FR-002**: System MUST NOT sync or store photos, and MUST NOT sync device-only preferences.
- **FR-003**: System MUST sync creates, edits and deletions. Deleted records MUST stay deleted on
  every device unless the user explicitly restores them (FR-026).
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
**Meal categories**

- **FR-020**: Every new log entry MUST have exactly one meal category from the fixed set Breakfast,
  Lunch, Dinner, Snacks. Users cannot add, rename or remove categories.
- **FR-021**: When logging, the category MUST be pre-filled from the device's local time of day, and the
  user MUST be able to change it without adding an interaction to the Principle IV logging flow.
- **FR-022**: Entries that existed before this feature MUST be shown as "Uncategorized" and MUST NOT be
  given a category automatically. The user MAY change an existing entry's category at any time,
  including from "Uncategorized"; a categorized entry cannot be set back to "Uncategorized".
- **FR-023**: The day view MUST group entries by category (in the order Breakfast, Lunch, Dinner,
  Snacks, then Uncategorized) and show each category's subtotal; the daily total stays the sum of all
  entries. Category changes MUST sync like any other entry edit.

**Entry history**

- **FR-024**: Every time a log entry is edited or deleted, System MUST keep the version it replaced,
  including all entry fields, the change type (edit or delete) and when the
  change was made. Versions MUST sync so the same history is visible on every device.
- **FR-025**: The user MUST be able to view an entry's history (current version plus previous versions,
  newest first), and to see recently deleted entries for any day.
- **FR-026**: The user MUST be able to restore an earlier version of an entry, or a deleted entry. A
  restore is a new change: it becomes the current version, keeps the entry's ID, is itself recorded in
  history, and syncs to every device like any other edit.
- **FR-027**: Previous versions MUST be kept for 90 days after they were replaced, then permanently
  removed. Versions are owned by the entry's user, covered by FR-013 to FR-016, and deleted with that
  user's other food data.
- **FR-028**: Entry history covers log entries only. Saved foods keep only their latest version;
  protein goals keep their existing effective-from history.

**Frequently used foods**

- **FR-029**: The quick-pick list MUST order saved foods by how many times each was logged in the last
  30 days (most first), with the most recent use breaking ties. Foods not used in the last 30 days
  follow, ordered by last use.
- **FR-030**: A food's use count MUST come from the user's synced log entries that are linked to it
  (by entry day), so it combines uses from every device, drops when a linked entry is deleted and
  rises again if that entry is restored.
- **FR-031**: For the same synced data, every device MUST show the quick-pick list in the same order.

**History & trends**

- **FR-032**: Daily calorie and macro totals MUST always be calculated from that day's current log
  entries. System MUST NOT store separate daily total records, so an edit, deletion or restore on any
  past day is reflected immediately in that day's totals and in trends.
- **FR-033**: System MUST provide a trends view showing, per day, calories, protein, carbs and fat over
  a selectable range of the last 7, 30 or 90 days, with the protein goal that applied on each day and
  the average for the range.
- **FR-034**: Days with no entries MUST be shown as "no data" in trends, not as zero, and MUST be left
  out of range averages.
- **FR-035**: Trends MUST work offline from the data on the device, and MUST show identical values on
  every device for the same synced data.

**Audit**

- **FR-019**: Security-relevant sync events (refused cross-user attempts, rejected payloads, rate-limit
  hits, user data deletion) MUST be recorded in the audit log, without food contents.

### Key Entities

- **Log Entry**: one logged food on a given day. Has a name, quantity with unit, macros, source
  (manual or AI), an optional link to a saved food, the day it belongs to, its meal category
  (Breakfast, Lunch, Dinner, Snacks, or Uncategorized for pre-existing entries), and when it was
  logged. Owned by exactly one user.
- **Entry Version**: a previous state of a log entry, kept for 90 days. Holds a copy of the entry's
  fields, the change type (edit, delete or restore) and when it was replaced. Belongs to one log entry
  and one user.
- **Meal Category**: a fixed, app-defined set of four values (Breakfast, Lunch, Dinner, Snacks) plus
  "Uncategorized" for legacy entries. Not user-editable and not stored per user.
- **Saved Food**: a reusable food with reference quantity and macros, used for quick picks. Has a last
  use and a 30-day use count derived from the log entries linked to it; ordered by that count, then
  by last use (FR-029). Owned by exactly one user.
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
  and long offline periods, and the losing side of a same-record conflict (FR-007) is still recoverable from entry history.
- **SC-008**: The trends view for a 90-day range opens within 2 seconds on a device holding at least one
  year of history, and its daily values match the day view for every day in the range.

## Assumptions

- Sync is on for every user. Data that already exists on a device is merged in automatically on its
  first sync (User Story 2).
- Food data stored on the server is readable by the server, and so technically by the owner as its
  operator. Users are told this (FR-017). End-to-end encryption is out of scope for this feature.
- The resolution unit for conflicts is the whole record (last change wins per record), not individual
  fields. This is simpler and enough for a small personal tool.
- Meal categories are a fixed set (FR-020). The time-of-day pre-fill uses these default windows, in
  device local time: Breakfast 04:00–10:59, Lunch 11:00–14:59, Dinner 17:00–21:59, Snacks at all
  other times.
- Calories are derived from macros and are not stored separately.
- Existing authentication, sessions, invites and the owner role (feature 003) are reused unchanged.
- Server backups of food data are kept for no more than 30 days, after which data deleted under
  FR-016 is gone from backups too.
- Users are on the small invite-only scale described in the constitution. Large-scale performance
  is out of scope.
- The constitution will be amended (Principle III and the Storage constraint) before planning.
