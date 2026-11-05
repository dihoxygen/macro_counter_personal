import type { MealCategory } from './types';

/** The meal a new entry is pre-filled with, from the device's local time (FR-021, spec Assumptions). */
export function categoryForTime(date: Date): MealCategory {
  const hour = date.getHours();
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snacks';
}
