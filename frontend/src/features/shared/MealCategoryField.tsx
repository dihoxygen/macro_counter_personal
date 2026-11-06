import { MEAL_CATEGORIES, MEAL_LABELS, UNCATEGORIZED_LABEL } from '../../domain/meals';
import type { MealCategory } from '../../domain/types';

interface Props {
  /** Null on entries from before categories existed. */
  value: MealCategory | null;
  onChange: (value: MealCategory) => void;
}

/** Pre-filled wherever a food is logged, so accepting it takes no extra step (FR-021). */
export function MealCategoryField({ value, onChange }: Props) {
  return (
    <label>
      Meal
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value as MealCategory)}>
        {/* Shown for an older entry, and never offered: an entry cannot go back to it (FR-022). */}
        {value === null && (
          <option value="" disabled>
            {UNCATEGORIZED_LABEL}
          </option>
        )}
        {MEAL_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {MEAL_LABELS[category]}
          </option>
        ))}
      </select>
    </label>
  );
}
