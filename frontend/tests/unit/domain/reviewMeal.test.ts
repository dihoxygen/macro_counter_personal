import { describe, expect, it } from 'vitest';
import { acceptWarning, editItem, setItemMeal, startReview, toEntries } from '../../../src/domain/review';

const estimate = {
  items: [
    {
      name: 'Egg',
      portion: { amount: 50, unit: 'g' as const },
      portionDescription: '',
      macros: { kcal: 70, proteinG: 6, carbsG: 0, fatG: 5 },
      flags: [],
    },
    {
      name: 'Toast',
      portion: { amount: 30, unit: 'g' as const },
      portionDescription: '',
      macros: { kcal: 80, proteinG: 3, carbsG: 15, fatG: 1 },
      flags: [],
    },
  ],
};

const lunchTime = new Date(2026, 10, 4, 12, 0);

describe('meals in a review', () => {
  it('pre-fills every item from the time', () => {
    expect(toEntries(startReview(estimate as never), lunchTime).map((e) => e.mealCategory)).toEqual(['lunch', 'lunch']);
  });

  it('lets each item have its own meal', () => {
    const state = setItemMeal(startReview(estimate as never), 1, 'snacks');

    expect(toEntries(state, lunchTime).map((e) => e.mealCategory)).toEqual(['lunch', 'snacks']);
  });

  it('is not a value edit: the item stays unedited and accepted', () => {
    const accepted = acceptWarning(startReview(estimate as never), 0);

    const state = setItemMeal(accepted, 0, 'dinner');

    expect(state.items[0]).toMatchObject({ edited: false, accepted: true, mealCategory: 'dinner' });
  });

  it('survives a later edit', () => {
    const state = editItem(setItemMeal(startReview(estimate as never), 0, 'dinner'), 0, { name: 'Boiled egg' });

    expect(state.items[0]!.mealCategory).toBe('dinner');
  });

  it('refuses an item that is not there', () => {
    expect(() => setItemMeal(startReview(estimate as never), 5, 'dinner')).toThrow();
  });
});
