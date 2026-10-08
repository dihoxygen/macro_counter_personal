import { describe, expect, it } from 'vitest';
import type { Estimate } from '../../../src/api/estimates';
import {
  acceptWarning,
  canConfirm,
  addItem,
  editItem,
  removeItem,
  needsAcceptance,
  reviewTotal,
  startReview,
  toEntries,
} from '../../../src/domain/review';

const egg = {
  name: 'Egg',
  portion: { amount: 50, unit: 'g' as const },
  portionDescription: '1 large egg (~50 g)',
  macros: { kcal: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 },
  flags: [] as Estimate['flags'],
};
const toast = {
  name: 'Toast',
  portion: { amount: 30, unit: 'g' as const },
  portionDescription: '1 slice (~30 g)',
  macros: { kcal: 69, proteinG: 3.6, carbsG: 12, fatG: 0.9 },
  flags: [] as Estimate['flags'],
};
const estimate: Estimate = {
  recognized: true,
  items: [egg, toast],
  total: { kcal: 147, proteinG: 9.9, carbsG: 12.6, fatG: 6.2 },
  flags: [],
};

describe('startReview', () => {
  it('starts from the estimate items, none edited', () => {
    const state = startReview(estimate);
    expect(state.items.map((i) => i.name)).toEqual(['Egg', 'Toast']);
    expect(state.items.every((i) => !i.edited && i.origin === 'ai')).toBe(true);
  });
});

describe('editItem', () => {
  it('applies the patch and marks the item edited', () => {
    const state = editItem(startReview(estimate), 0, {
      macros: { ...egg.macros, proteinG: 7 },
    });
    expect(state.items[0]!.macros.proteinG).toBe(7);
    expect(state.items[0]!.edited).toBe(true);
    expect(state.items[1]!.edited).toBe(false);
  });

  it('does not mutate the previous state', () => {
    const before = startReview(estimate);
    editItem(before, 0, { name: 'Duck egg' });
    expect(before.items[0]!.name).toBe('Egg');
  });

  it('can rename and change the portion', () => {
    const state = editItem(startReview(estimate), 1, {
      name: 'Rye toast',
      portion: { amount: 40, unit: 'g' },
    });
    expect(state.items[1]).toMatchObject({ name: 'Rye toast', portion: { amount: 40, unit: 'g' } });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a macro value of %s', (bad) => {
    expect(() => editItem(startReview(estimate), 0, { macros: { ...egg.macros, fatG: bad } })).toThrow(
      RangeError,
    );
  });

  it('rejects an invalid portion amount', () => {
    expect(() =>
      editItem(startReview(estimate), 0, { portion: { amount: -5, unit: 'g' } }),
    ).toThrow(RangeError);
  });

  it('rejects an out-of-range index', () => {
    expect(() => editItem(startReview(estimate), 5, { name: 'x' })).toThrow(RangeError);
  });
});

describe('reviewTotal', () => {
  it('is sumMacros of the current items', () => {
    const state = editItem(startReview(estimate), 0, { macros: { ...egg.macros, proteinG: 10 } });
    const total = reviewTotal(state);
    expect(total.proteinG).toBeCloseTo(13.6, 10);
    expect(total.kcal).toBe(147);
  });
});

describe('toEntries', () => {
  const now = new Date(2026, 9, 8, 12, 30, 0);

  it("creates one entry per item: 'ai' if unedited, 'ai-edited' if edited", () => {
    const state = editItem(startReview(estimate), 1, { macros: { ...toast.macros, kcal: 80 } });
    const entries = toEntries(state, now);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: 'Egg',
      quantity: { amount: 50, unit: 'g' },
      macros: egg.macros,
      source: 'ai',
      dayKey: '2026-10-08',
      loggedAt: now.toISOString(),
      savedFoodId: null,
    });
    expect(entries[1]!.source).toBe('ai-edited');
    expect(entries[1]!.macros.kcal).toBe(80);
  });

  it('gives each item a later loggedAt so the list keeps the estimate order', () => {
    const entries = toEntries(startReview(estimate), now);
    expect(entries.map((e) => e.loggedAt)).toEqual([
      now.toISOString(),
      new Date(now.getTime() + 1).toISOString(),
    ]);
  });
});

describe('flag acceptance (constitution VI consistency checks)', () => {
  const mismatched = { ...egg, macros: { ...egg.macros, kcal: 400 }, flags: ['calorie_macro_mismatch' as const] };
  const flagged: Estimate = { ...estimate, items: [mismatched, toast], flags: ['calorie_macro_mismatch'] };

  it('can confirm an unflagged estimate right away', () => {
    expect(canConfirm(startReview(estimate))).toBe(true);
    expect(needsAcceptance(startReview(estimate).items[0]!)).toBe(false);
  });

  it('cannot confirm while a flagged item is not accepted', () => {
    const state = startReview(flagged);
    expect(needsAcceptance(state.items[0]!)).toBe(true);
    expect(canConfirm(state)).toBe(false);
  });

  it('can confirm after the user accepts the warning', () => {
    const state = acceptWarning(startReview(flagged), 0);
    expect(needsAcceptance(state.items[0]!)).toBe(false);
    expect(canConfirm(state)).toBe(true);
  });

  it('editing the values to clear the problem also allows confirming', () => {
    const state = editItem(startReview(flagged), 0, { macros: egg.macros });
    expect(state.items[0]!.flags).toEqual([]);
    expect(canConfirm(state)).toBe(true);
  });

  it('an edit that keeps the problem keeps the flag', () => {
    const state = editItem(startReview(flagged), 0, { macros: { ...egg.macros, kcal: 500 } });
    expect(state.items[0]!.flags).toEqual(['calorie_macro_mismatch']);
    expect(canConfirm(state)).toBe(false);
  });

  it('an edit that introduces a large portion adds the flag', () => {
    const state = editItem(startReview(estimate), 0, { portion: { amount: 2500, unit: 'g' } });
    expect(state.items[0]!.flags).toEqual(['large_portion']);
    expect(canConfirm(state)).toBe(false);
  });

  it('an edit after accepting re-checks and requires acceptance again if still flagged', () => {
    const accepted = acceptWarning(startReview(flagged), 0);
    const state = editItem(accepted, 0, { macros: { ...egg.macros, kcal: 450 } });
    expect(canConfirm(state)).toBe(false);
  });

  it('cannot confirm with zero items', () => {
    expect(canConfirm({ items: [] })).toBe(false);
  });

  it('rejects accepting an out-of-range index', () => {
    expect(() => acceptWarning(startReview(flagged), 9)).toThrow(RangeError);
  });
});

describe('removeItem / addItem (photo review, US3)', () => {
  const salad = {
    name: 'Side salad',
    portion: { amount: 80, unit: 'g' as const },
    macros: { kcal: 20, proteinG: 1, carbsG: 3.5, fatG: 0.2 },
  };

  it('removeItem removes an item and the total follows', () => {
    const state = removeItem(startReview(estimate), 0);
    expect(state.items.map((i) => i.name)).toEqual(['Toast']);
    expect(reviewTotal(state)).toEqual(toast.macros);
  });

  it('removeItem rejects an out-of-range index', () => {
    expect(() => removeItem(startReview(estimate), 2)).toThrow(RangeError);
  });

  it("addItem adds a manually entered item that becomes source 'manual'", () => {
    const state = addItem(startReview(estimate), salad);
    expect(state.items).toHaveLength(3);
    expect(state.items[2]).toMatchObject({ ...salad, origin: 'manual', edited: false, flags: [] });
    expect(reviewTotal(state).kcal).toBe(167);

    const entries = toEntries(state, new Date(2026, 9, 8, 12, 0));
    expect(entries.map((e) => e.source)).toEqual(['ai', 'ai', 'manual']);
  });

  it('an edited manual item stays manual', () => {
    const state = editItem(addItem(startReview(estimate), salad), 2, { name: 'Green salad' });
    expect(toEntries(state, new Date())[2]!.source).toBe('manual');
  });

  it('addItem validates values and flags implausible ones', () => {
    expect(() => addItem(startReview(estimate), { ...salad, macros: { ...salad.macros, kcal: -1 } })).toThrow(
      RangeError,
    );
    const flagged = addItem(startReview(estimate), { ...salad, portion: { amount: 3000, unit: 'g' } });
    expect(flagged.items[2]!.flags).toEqual(['large_portion']);
    expect(canConfirm(flagged)).toBe(false);
  });

  it('addItem rejects an empty name', () => {
    expect(() => addItem(startReview(estimate), { ...salad, name: '  ' })).toThrow(RangeError);
  });

  it('confirming with zero items is not allowed', () => {
    const state = removeItem(removeItem(startReview(estimate), 0), 0);
    expect(state.items).toEqual([]);
    expect(canConfirm(state)).toBe(false);
  });
});
