import type { DayKey } from './types';

export interface GoalRecord {
  effectiveFrom: DayKey;
  grams: number | null;
}

/**
 * The protein goal on a day: the record with the largest effectiveFrom ≤ day.
 * Null when none applies yet or the goal was cleared (FR-020). Day keys compare as strings.
 */
export function goalForDay(history: readonly GoalRecord[], dayKey: DayKey): number | null {
  let best: GoalRecord | null = null;
  for (const record of history) {
    if (record.effectiveFrom <= dayKey && (best === null || record.effectiveFrom > best.effectiveFrom)) {
      best = record;
    }
  }
  return best?.grams ?? null;
}
