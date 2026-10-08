import { describe, expect, it } from 'vitest';
import { scaleMacros } from '../../../../src/domain/nutrition/scale';
import type { Macros, Quantity } from '../../../../src/domain/types';

const yogurt: Macros = { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 };
const g = (amount: number): Quantity => ({ amount, unit: 'g' });

describe('scaleMacros', () => {
  it('scales by to.amount / from.amount (170 g → 85 g halves every field)', () => {
    expect(scaleMacros(yogurt, g(170), g(85))).toEqual({
      kcal: 50,
      proteinG: 8.5,
      carbsG: 3,
      fatG: 0.35,
    });
  });

  it('returns the same values for the same amount', () => {
    expect(scaleMacros(yogurt, g(170), g(170))).toEqual(yogurt);
  });

  it('throws when the units differ', () => {
    expect(() => scaleMacros(yogurt, g(170), { amount: 170, unit: 'ml' })).toThrow(
      /unit/i,
    );
  });

  it('throws when the reference amount is 0', () => {
    expect(() => scaleMacros(yogurt, g(0), g(100))).toThrow(
      'a reference amount of 0 cannot be scaled',
    );
  });

  it('returns zeros when the target amount is 0', () => {
    expect(scaleMacros(yogurt, g(170), g(0))).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('keeps full precision', () => {
    const result = scaleMacros({ kcal: 100, proteinG: 10, carbsG: 10, fatG: 10 }, g(3), g(1));
    expect(result.kcal).toBeCloseTo(100 / 3, 12);
    expect(result.proteinG).toBeCloseTo(10 / 3, 12);
    expect(result.kcal).not.toBe(33.3);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a from amount of %s',
    (amount) => {
      expect(() => scaleMacros(yogurt, g(amount), g(100))).toThrow(RangeError);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for a to amount of %s',
    (amount) => {
      expect(() => scaleMacros(yogurt, g(100), g(amount))).toThrow(RangeError);
    },
  );

  it('throws RangeError for negative input macros', () => {
    expect(() => scaleMacros({ ...yogurt, fatG: -1 }, g(100), g(50))).toThrow(RangeError);
  });

  it('scales a very large target exactly (100 g → 20 000 g)', () => {
    expect(scaleMacros({ kcal: 50, proteinG: 2, carbsG: 10, fatG: 0.5 }, g(100), g(20000))).toEqual({
      kcal: 10000,
      proteinG: 400,
      carbsG: 2000,
      fatG: 100,
    });
  });
});
