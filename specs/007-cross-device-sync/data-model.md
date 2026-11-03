# Data Model: Cross-Device Sync

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Two copies of the same records exist: the server copy in PostgreSQL (`macro_data` schema) and each
device's local copy in IndexedDB. Field names on the wire match the existing device records
(`frontend/src/data/records.ts`). Server columns use snake_case.

## Shared record fields

Every activity record, on both sides, has these fields:

| Field (wire) | Server column | Rules |
|---|---|---|
| `id` | `id uuid` | Device-generated UUID, stable forever. Server PK is `(user_id, id)` (R10) |
| — | `user_id uuid` | From the session only, never from the request. FK `macro.users(id) on delete cascade` |
| `createdAt` | `created_at timestamptz` | Set once, never changed by sync |
| `updatedAt` | `effective_at timestamptz` | Skew-corrected edit time, used for last-writer-wins (R3). Pull returns it as `updatedAt` |
| `schemaVersion` | `schema_version int` | Record schema version. The server accepts versions it knows (currently `1`) |
| — | `revision bigint not null` | The user's revision at the last change. Index `(user_id, revision)` |
| `deleted` (pull only) | `deleted_at timestamptz null` | Tombstone. Data columns are kept until user deletion. A tombstone is never undone |

## Server entities (`macro_data` schema)

### `log_entries`

| Column | Type | Constraint |
|---|---|---|
| `day_key` | `date` | Required. Fixed at creation: an upsert that changes it is rejected as `day_key_changed` (it mirrors `EntryPatch`) |
| `logged_at` | `timestamptz` | Required |
| `name` | `text` | 1–120 chars after trim |
| `quantity_amount` | `double precision` | ≥ 0, ≤ 100 000, finite |
| `quantity_unit` | `text` | `g` \| `ml` \| `serving` |
| `kcal`, `protein_g`, `carbs_g`, `fat_g` | `double precision` | ≥ 0, finite. `kcal` ≤ 100 000, others ≤ 10 000 |
| `source` | `text` | `ai` \| `ai-edited` \| `manual` |
| `saved_food_id` | `uuid null` | Soft link, with no FK. Aliases are rewritten to the canonical ID on push (R4) |

Index: `(user_id, day_key)` (support and future use; pull uses the revision index).

### `saved_foods`

| Column | Type | Constraint |
|---|---|---|
| `name` | `text` | 1–120 chars after trim |
| `normalized_name` | `text` | Computed by the server: `lower(btrim(name))`, mirroring the device's `trim().toLowerCase()` |
| `ref_amount`, `ref_unit` | as quantity | as quantity |
| macros, `source` | as entries | as entries |
| `last_used_at` | `timestamptz` | Required. On merge, the later of the two is kept |

Unique: `(user_id, normalized_name, ref_unit) where deleted_at is null` (natural key, R4).

### `protein_goals`

| Column | Type | Constraint |
|---|---|---|
| `effective_from` | `date` | Required |
| `grams` | `double precision null` | `> 0` and ≤ 10 000, or null (goal cleared from that day on) |

Unique: `(user_id, effective_from)` (natural key, R4). Goals are never deleted, only set to `null`, so
no tombstones occur in practice. The column exists for uniformity.

### `saved_food_aliases`, `protein_goal_aliases`

| Column | Type |
|---|---|
| `user_id` | `uuid`, FK cascade |
| `alias_id` | `uuid` |
| `canonical_id` | `uuid` |

PK `(user_id, alias_id)`. An upsert addressed to an alias ID is applied to the canonical row and
reported as `merged`.

### `sync_state`

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` PK, FK cascade | Created on the first sync request |
| `revision` | `bigint not null default 0` | Incremented in the push transaction (row lock serializes pushes, R2) |
| `notice_ack_at` | `timestamptz null` | Sync disclosure acknowledged (R7). Push and pull refuse while null |

### Access (R10)

- RLS is enabled on every table above. The app role's policy is
  `user_id = current_setting('macro.user_id', true)::uuid`, for all commands.
- Grants for the app role:

  | Table | Grant |
  |---|---|
  | Data tables and alias tables | `select, insert, update` (no `delete`: deletion is a tombstone update) |
  | `sync_state` | `select, insert, update` |

- Only the owner procedure `macro_admin.delete_user` physically deletes rows, through the cascade.

### Owner procedure

`macro_admin.delete_user(p_username text) returns void` deletes the user row. It cascades to every
`macro` and `macro_data` row of that user, keeps audit rows unlinked, and writes audit `user_deleted`
(actor `owner`).

### Audit additions

- Event codes: `sync_rejected`, `user_deleted`
- Reason codes: `invalid_record`, `day_key_changed`, `too_many_changes`, `unknown_schema_version`
- Sync rate-limit hits reuse the existing `rate_limited` event, with the limiter name as the reason
  (`sync`).

## Validation bounds

The server endpoint and the device's pre-push check share these bounds. The device uses them to
quarantine records instead of blocking the whole push (R6).

| Field | Rule |
|---|---|
| `name` | Non-empty after trim, ≤ 120 chars |
| quantity `amount` | Finite, 0 ≤ x ≤ 100 000 |
| `unit` | `g`, `ml`, `serving` |
| `kcal` | Finite, 0 ≤ x ≤ 100 000 |
| `proteinG`, `carbsG`, `fatG` | Finite, 0 ≤ x ≤ 10 000 |
| `grams` (goal) | null, or finite, 0 < x ≤ 10 000 |
| `dayKey`, `effectiveFrom` | `YYYY-MM-DD`, a real calendar date |
| timestamps | ISO 8601 with offset |
| `schemaVersion` | Known version (1) |

These are deliberately looser than the AI hard checks (`EstimateValidator`: kcal ≤ 5 000). Manual
entries were never held to the AI limits, and sync must not reject data a user already saved. Values
keep full precision end to end (Principle II). The server never rounds.

## Device entities (IndexedDB, per-user database `macro-counter.u.<userId>`)

The local schema goes from **v1 to v2**, with a tested migration in `frontend/src/data/db.ts`.

| Store | Change | Contents |
|---|---|---|
| `entries`, `savedFoods`, `proteinGoals` | unchanged shape | Deleted entries are removed locally. The tombstone exists only on the server and in the outbox |
| `outbox` **(new)** | keyPath `key` | `{ key: 'entry:<id>' \| 'food:<id>' \| 'goal:<id>', op: 'upsert' \| 'delete', seq: number }`. `seq` comes from a `meta.outboxSeq` counter |
| `quarantine` **(new)** | keyPath `key` | `{ key, reason: string, at: string }`. The record stays in its own store |
| `meta` | new keys | `sync.cursor` (number, default 0), `outboxSeq` (number) |

**v2 migration**: create `outbox` and `quarantine`, then add an `upsert` outbox item for every existing
entry, saved food and goal (first sync, R6). Set `sync.cursor = 0`.

**Write rules** (the repositories, in the same transaction as the record write):

- create or update → put `outbox[key] = { op: 'upsert', seq: next }`
- entry delete → delete the record, put `outbox[key] = { op: 'delete', seq: next }`
- applying pulled changes → write records **without** touching the outbox, and skip any key that has a
  pending outbox item (R2)
- `merged` result → rewrite the local record to `canonicalId`, repoint `entries.savedFoodId`, and drop
  the alias key from the outbox, in one transaction

## State transitions

**Server record**: `absent → live` (first upsert) → `live` (newer upserts, R3) → `deleted`
(tombstone, terminal until user deletion).

**Outbox item**: `pending → in flight` (push sent) → removed if `seq` is unchanged and the result is
`applied`, `superseded` or `merged`. It stays `pending` on a network or 5xx failure or a changed `seq`.
It moves to quarantine if the device check fails.

**Device sync status** (shown in the header):

```
off (notice not acked) ──ack──▶ syncing ──ok──▶ synced ◀──────┐
                                 │  ▲                          │
                   local change  ▼  │ retry/backoff            │
                               pending ──fail──▶ failing ──ok──┘
                                 │
                       offline ──▶ offline (pending kept)
quarantine > 0 is shown alongside any of these states
```
