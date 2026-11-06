import { sumMacros } from './nutrition/totals';
import type { Macros, MealCategory } from './types';

export const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

export const UNCATEGORIZED_LABEL = 'Uncategorized';

/** The order of the day (FR-023). Null, for entries from before categories existed, comes last. */
const GROUP_ORDER: readonly (MealCategory | null)[] = ['breakfast', 'lunch', 'dinner', 'snacks', null];

export const MEAL_CATEGORIES = GROUP_ORDER.filter((category) => category !== null);

/** The meal a new entry is pre-filled with, from the device's local time (FR-021, spec Assumptions). */
export function categoryForTime(date: Date): MealCategory {
  const hour = date.getHours();
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snacks';
}

export interface MealGroup<T> {
  category: MealCategory | null;
  label: string;
  entries: T[];
  subtotal: Macros;
}

/** A day's entries by meal, with a subtotal each. Empty meals are left out (FR-023). */
export function groupByCategory<T extends { mealCategory: MealCategory | null; macros: Macros }>(
  entries: readonly T[],
): MealGroup<T>[] {
  return GROUP_ORDER.flatMap((category) => {
    const inMeal = entries.filter((entry) => entry.mealCategory === category);
    if (inMeal.length === 0) return [];
    const label = category === null ? UNCATEGORIZED_LABEL : MEAL_LABELS[category];
    return [{ category, label, entries: inMeal, subtotal: sumMacros(inMeal.map((entry) => entry.macros)) }];
  });
}
