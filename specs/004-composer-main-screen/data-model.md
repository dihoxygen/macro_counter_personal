# Data Model: Composer Main Screen

**No stored-data change.** The IndexedDB schema, the repositories and the records (`LogEntry`,
`SavedFood`, `ProteinGoal`) are unchanged, so no migration is needed. Confirming and re-logging still
go through `services.log.confirmEntries`. Everything below lives in memory only, for as long as the app
stays open, as the current review step does.

## Composer state

Owned by `Composer` (one per Today screen; Today stays mounted, see [research R1](./research.md#r1-keeping-a-pending-card-across-screens-fr-006)).

| Field | Type | Notes |
|-------|------|-------|
| `method` | `'describe' \| 'photo' \| 'manual'` | Starts as `describe`, or `manual` when AI is unavailable or offline (FR-010) |
| `aiAvailable` | `boolean` | From `services.getStatus()` and `services.aiBlockedReason`, as `AddFood` does today |
| `phase` | `Phase` (existing, from `useEstimateFlow`) | `input \| loading \| review(state) \| unrecognized \| error(message)` |
| `relog` | `SavedFood \| null` | A quick pick being re-logged; shown in the card area instead of a phase |
| `describeDraft` | `string` | Kept across method switches and Discard; cleared on Confirm (FR-011) |
| `photoDraft` | existing `usePhotoSelection` state + `note: string` | Same lifetime as `describeDraft` |
| `manualDraft` | existing `ManualEntryForm` state | Kept because the form stays mounted while hidden; cleared on save |

**Invariant (FR-005)**: at most one of `phase ∈ {loading, review, unrecognized, error}` or
`relog ≠ null` holds at a time. While either holds, the method switch, quick picks and send controls
are disabled.

## Card area transitions

```text
                 send (describe/photo)
   ┌──────────┐ ───────────────────────▶ ┌─────────┐   estimate ok, recognized  ┌──────────────┐
   │  empty   │                          │ loading │ ─────────────────────────▶ │ review(state)│
   │ (input)  │ ◀─────────── cancel ──── └─────────┘                            └──────────────┘
   └──────────┘                               │  not recognized / error            │      │
     ▲  ▲  ▲                                  ▼                                     │      │
     │  │  │                       ┌────────────────────────┐                      │      │
     │  │  └── Retry ──────────────│ unrecognized / error   │   confirm ───────────┘      │
     │  │      (re-sends draft)    │ (Retry · Describe ·    │   (log, clear drafts,        │
     │  │                          │  Enter manually)       │    refresh Today)            │
     │  │                          └────────────────────────┘                              │
     │  └────────────────────────────── discard (keep drafts) ─────────────────────────────┘
     │
     │  quick pick ─▶ relog(food) ─▶ Log (logs, refresh Today) │ Cancel
     └──────────────────────────────────────────────────────────┘
```

"Enter manually" from an error switches `method` to `manual` and closes the card. The description
draft is kept (FR-019).

## Pending projection (FR-004)

Derived, never stored:

| Value | Source |
|-------|--------|
| `pendingProteinG` | `reviewTotal(state).proteinG` while `phase = review`, else `0`. Updated on every edit through `ReviewEstimate`'s new `onChange` |
| `{ loggedPct, pendingPct }` | `proteinSegments(loggedG, pendingProteinG, goalG)`, a pure function in `src/domain/nutrition/proteinProgress.ts` |

`proteinSegments` rules (Principle II):
- `loggedG`, `pendingG` ≥ 0 and finite, otherwise `RangeError`.
- `goalG === null` → `{ loggedPct: 0, pendingPct: 0 }`.
- `loggedPct = min(loggedG / goalG, 1) × 100`.
- `pendingPct = min((loggedG + pendingG) / goalG, 1) × 100 − loggedPct`, so the two never add up to more
  than 100.
- Full precision; rounding happens only where values are formatted for display.

Reference values: (96, 54, 150) → (64, 36). (96, 0, 150) → (64, 0). (140, 30, 150) → (93.33…, 6.66…).
(160, 10, 150) → (100, 0). (0, 0, 150) → (0, 0).

## Today visibility

| Field | Owner | Notes |
|-------|-------|-------|
| `view` | `App` (existing) | `'today' \| 'recent' \| 'history' \| 'goal' \| 'account'`. `'add'` is removed |
| `active` | prop to `TodayScreen` | `view === 'today'`. On false → true, `refreshKey` increments. On true → false, the live camera closes |
| `refreshKey` | `TodayScreen` | Passed to `DayLog` and `QuickPicks` to reload after confirm, re-log or returning to Today |
