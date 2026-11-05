import { daysBefore } from './days';
import type { DayKey } from './types';

export const QUICK_PICK_WINDOW_DAYS = 30;

interface FoodUse {
  savedFoodId: string | null;
  dayKey: DayKey;
  loggedAt: string;
}

/**
 * The first day of the quick-pick window ending on `today`.
 * Counting from linked entries means a delete or restore changes the order by itself (FR-030).
 */
export function quickPickWindowStart(today: DayKey): DayKey {
  return daysBefore(today, QUICK_PICK_WINDOW_DAYS - 1);
}

/**
 * Most used in the last 30 days first, the latest use breaking ties. Foods unused in that time follow, by last use.
 * The id settles anything left, so every device shows the same order (FR-029, FR-031).
 */
export function rankQuickPicks<T extends { id: string; lastUsedAt: string }>(
  foods: readonly T[],
  entries: readonly FoodUse[],
  today: DayKey,
): T[] {
  const from = quickPickWindowStart(today);
  const uses = new Map<string, { count: number; latest: string }>();
  for (const { savedFoodId, dayKey, loggedAt } of entries) {
    if (savedFoodId === null || dayKey < from || dayKey > today) continue;
    const seen = uses.get(savedFoodId);
    uses.set(savedFoodId, {
      count: (seen?.count ?? 0) + 1,
      latest: seen === undefined || loggedAt > seen.latest ? loggedAt : seen.latest,
    });
  }

  const rank = (food: T) => {
    const use = uses.get(food.id);
    return { count: use?.count ?? 0, latest: use?.latest ?? food.lastUsedAt };
  };

  return [...foods].sort((a, b) => {
    const [first, second] = [rank(a), rank(b)];
    return (
      second.count - first.count || second.latest.localeCompare(first.latest) || a.id.localeCompare(b.id)
    );
  });
}
