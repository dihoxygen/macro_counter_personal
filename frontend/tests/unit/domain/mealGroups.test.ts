import { describe, expect, it } from 'vitest';
import { groupByCategory } from '../../../src/domain/meals';
import { sumMacros } from '../../../src/domain/nutrition/totals';
import type { Macros, MealCategory } from '../../../src/domain/types';

const macros = (kcal: number, proteinG = 0): Macros => ({ kcal, proteinG, carbsG: 0, fatG: 0 });
const entry = (mealCategory: MealCategory | null, kcal: number, proteinG = 0) => ({ mealCategory, macros: macros(kcal, proteinG) });

describe('groupByCategory', () => {
  it('orders meals through the day, then Uncategorized', () => {
    const groups = groupByCategory([entry(null, 1), entry('snacks', 1), entry('dinner', 1), entry('breakfast', 1), entry('lunch', 1)]);

    expect(groups.map((g) => g.label)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Uncategorized']);
  });

  it('leaves out empty meals', () => {
    expect(groupByCategory([entry('lunch', 1)]).map((g) => g.category)).toEqual(['lunch']);
    expect(groupByCategory([])).toEqual([]);
  });

  it('keeps entries in their order within a meal', () => {
    const [first, second] = [entry('lunch', 1), entry('lunch', 2)];

    expect(groupByCategory([first, second])[0]!.entries).toEqual([first, second]);
  });

  it('adds up each meal', () => {
    const groups = groupByCategory([entry('lunch', 100, 10), entry('lunch', 50, 5), entry('dinner', 200, 20)]);

    expect(groups[0]!.subtotal).toEqual(macros(150, 15));
    expect(groups[1]!.subtotal).toEqual(macros(200, 20));
  });

  it('has subtotals that add up to the day, at full precision', () => {
    const entries = [entry('lunch', 0.1), entry('lunch', 0.2), entry('dinner', 33.333333), entry(null, 66.666667)];

    const subtotals = groupByCategory(entries).map((g) => g.subtotal);

    expect(sumMacros(subtotals).kcal).toBeCloseTo(sumMacros(entries.map((e) => e.macros)).kcal, 10);
  });
});
