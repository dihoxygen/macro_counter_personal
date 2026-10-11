# Data Model: AI Macro Logging

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-10-07

All persisted data lives in the browser's IndexedDB (database `macro-counter`). The backend
stores nothing. Every persisted record has `id` (UUID v4), `createdAt`, `updatedAt` (ISO 8601 UTC)
and `schemaVersion`, so sync can be added later (constitution Principle III).

## Shared value types

| Type | Shape | Rules |
|------|-------|-------|
| `Unit` | `'g' \| 'ml' \| 'serving'` | No implicit units. |
| `Quantity` | `{ amount: number, unit: Unit }` | `amount` must be finite and ≥ 0. |
| `Macros` | `{ kcal: number, proteinG: number, carbsG: number, fatG: number }` | All finite and ≥ 0. Full precision; rounding happens only when values are displayed. |
| `DayKey` | `string` `YYYY-MM-DD` | The local calendar date when the record was created. |
| `Source` | `'ai' \| 'ai-edited' \| 'manual'` | FR-007. |

## Persisted entities (IndexedDB stores)

### `entries`: Log Entry

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `dayKey` | DayKey | Indexed. Set once at creation and never recomputed (travel edge case) |
| `loggedAt` | ISO UTC | FR-013. Entries are ordered by this field within a day |
| `name` | string | 1–120 characters |
| `quantity` | Quantity | |
| `macros` | Macros | Values the user confirmed |
| `source` | Source | `ai-edited` if any AI value was changed before confirming |
| `savedFoodId` | UUID \| null | Set when the entry was re-logged from a saved food |
| `createdAt` / `updatedAt` / `schemaVersion` | | |

**Validation**: name is non-empty and all `Macros` rules hold. Values are rejected, not clamped.
**Operations**: create (confirm), update (FR-010), delete (FR-010). Editing never changes `dayKey`.

### `savedFoods`: Saved Food (recent foods, Story 4)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `name` | string | |
| `referenceQuantity` | Quantity | The quantity the macros apply to |
| `macros` | Macros | For `referenceQuantity` |
| `source` | Source | |
| `lastUsedAt` | ISO UTC | Indexed. The recent list is sorted by this, descending |
| `createdAt` / `updatedAt` / `schemaVersion` | | |

**Upsert rule**: when an entry is confirmed, the app looks for an existing saved food with the same
normalized name (trimmed, lowercase) and unit. If one exists, it updates that food's macros, quantity
and `lastUsedAt`; otherwise it creates a new saved food.
**Scaling**: `macros × (newAmount / referenceQuantity.amount)`. Units must match, and a reference
amount of 0 cannot be scaled.

### `proteinGoals`: Protein Goal history (Story 5)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `effectiveFrom` | DayKey | Indexed. Unique; setting a goal twice on the same day replaces that day's record |
| `grams` | number \| null | `null` means the goal was cleared. When set, it must be finite and > 0 (spec edge case) |
| `createdAt` / `updatedAt` / `schemaVersion` | | |

**Goal on day D**: the record with the largest `effectiveFrom ≤ D`. If there is none, or its
`grams` is null, there is no goal for that day.

### `meta`

The single key `schemaVersion: 1` is used by the migration runner. A schema change bumps the
version and must ship with a tested migration (Principle III).

## Derived (not persisted)

### Day Log / Day Totals

`dayTotals(entries for D)` is the field-by-field sum of `macros`. It is a pure function and must
satisfy `totals == Σ entries` (SC-003).

### Protein Progress

`{ loggedG, goalG, remainingG = max(goalG − loggedG, 0), exceededG = max(loggedG − goalG, 0),
met = loggedG ≥ goalG }`. This is a pure function, and it returns null when there is no goal.

## Transient (in memory only): Food Estimate

This is returned by the backend, shown for review, and either confirmed or discarded. It is never
persisted. Its shape is defined in [contracts/estimates-api.yaml](./contracts/estimates-api.yaml)
(`Estimate`).

```text
Estimate
├── recognized: boolean
├── items[]: { name, portion: Quantity, portionDescription, macros: Macros, flags[] }
├── total: Macros          (recomputed server-side from items)
└── flags[]: ('calorie_macro_mismatch' | 'large_portion')
```

### Lifecycle

```text
[input text/photo] → requesting ──cancel──▶ discarded
                         │
            error / AI unavailable ──▶ error shown → retry | manual entry
                         ▼
                     reviewing ──discard──▶ discarded
                         │ (edit items: change values, remove, add)
                      confirm
                         ▼
   1 Log Entry per item (source = ai | ai-edited) + Saved Food upsert per item
```

Confirming a multi-item estimate creates one entry per item, so each food can be edited or deleted
on its own and re-logged later.
