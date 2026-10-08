import { describe, expect, it } from 'vitest';
import { sumMacros } from '../../../../src/domain/nutrition/totals';
import type { Macros } from '../../../../src/domain/types';

const zero: Macros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

function expectMacrosClose(actual: Macros, expected: Macros) {
  expect(actual.kcal).toBeCloseTo(expected.kcal, 10);
  expect(actual.proteinG).toBeCloseTo(expected.proteinG, 10);
  expect(actual.carbsG).toBeCloseTo(expected.carbsG, 10);
  expect(actual.fatG).toBeCloseTo(expected.fatG, 10);
}

describe('sumMacros', () => {
  it('returns all zeros for an empty list', () => {
    expect(sumMacros([])).toEqual(zero);
  });

  it('sums the hand-verified reference meal (egg + toast + butter)', () => {
    const egg = { kcal: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 };
    const toast = { kcal: 69, proteinG: 3.6, carbsG: 12, fatG: 0.9 };
    const butter = { kcal: 36, proteinG: 0.04, carbsG: 0, fatG: 4.1 };
    expectMacrosClose(sumMacros([egg, toast, butter]), {
      kcal: 183,
      proteinG: 9.94,
      carbsG: 12.6,
      fatG: 10.3,
    });
  });

  it('equals the field-wise sum for random lists (property)', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      const list: Macros[] = Array.from({ length: Math.floor(rand() * 20) }, () => ({
        kcal: rand() * 900,
        proteinG: rand() * 80,
        carbsG: rand() * 120,
        fatG: rand() * 60,
      }));
      const expected = list.reduce(
        (acc, m) => ({
          kcal: acc.kcal + m.kcal,
          proteinG: acc.proteinG + m.proteinG,
          carbsG: acc.carbsG + m.carbsG,
          fatG: acc.fatG + m.fatG,
        }),
        zero,
      );
      expectMacrosClose(sumMacros(list), expected);
    }
  });

  it('does not round', () => {
    const result = sumMacros([{ kcal: 0.123456789, proteinG: 1.05, carbsG: 0.01, fatG: 0.001 }]);
    expect(result).toEqual({ kcal: 0.123456789, proteinG: 1.05, carbsG: 0.01, fatG: 0.001 });
  });

  it.each(['kcal', 'proteinG', 'carbsG', 'fatG'] as const)(
    'throws RangeError for a negative, NaN or Infinity %s',
    (field) => {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => sumMacros([zero, { ...zero, [field]: bad }])).toThrow(RangeError);
      }
    },
  );

  it('sums very large values exactly', () => {
    const big = { kcal: 5000, proteinG: 1000, carbsG: 1000, fatG: 1000 };
    expect(sumMacros(Array.from({ length: 30 }, () => big))).toEqual({
      kcal: 150000,
      proteinG: 30000,
      carbsG: 30000,
      fatG: 30000,
    });
  });
});
