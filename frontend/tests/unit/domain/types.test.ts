import { describe, expect, it } from 'vitest';
import { DayKeySchema, MacrosSchema, QuantitySchema, SourceSchema, UnitSchema } from '../../../src/domain/types';

describe('UnitSchema', () => {
  it.each(['g', 'ml', 'serving'])('accepts %s', (unit) => {
    expect(UnitSchema.safeParse(unit).success).toBe(true);
  });

  it.each(['kg', 'oz', '', 'G', undefined, 1])('rejects %s', (unit) => {
    expect(UnitSchema.safeParse(unit).success).toBe(false);
  });
});

describe('QuantitySchema', () => {
  it('accepts a finite amount ≥ 0 with a unit', () => {
    expect(QuantitySchema.safeParse({ amount: 0, unit: 'g' }).success).toBe(true);
    expect(QuantitySchema.safeParse({ amount: 170.5, unit: 'ml' }).success).toBe(true);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects amount %s',
    (amount) => {
      expect(QuantitySchema.safeParse({ amount, unit: 'g' }).success).toBe(false);
    },
  );

  it('rejects a missing unit or amount', () => {
    expect(QuantitySchema.safeParse({ amount: 1 }).success).toBe(false);
    expect(QuantitySchema.safeParse({ unit: 'g' }).success).toBe(false);
  });
});

describe('MacrosSchema', () => {
  const valid = { kcal: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 };

  it('accepts all-finite non-negative values, including zeros', () => {
    expect(MacrosSchema.safeParse(valid).success).toBe(true);
    expect(MacrosSchema.safeParse({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }).success).toBe(true);
  });

  it.each(['kcal', 'proteinG', 'carbsG', 'fatG'] as const)('rejects a missing %s', (field) => {
    const rest: Record<string, number> = { ...valid };
    delete rest[field];
    expect(MacrosSchema.safeParse(rest).success).toBe(false);
  });

  it.each(['kcal', 'proteinG', 'carbsG', 'fatG'] as const)(
    'rejects negative, NaN and Infinity in %s',
    (field) => {
      for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(MacrosSchema.safeParse({ ...valid, [field]: bad }).success).toBe(false);
      }
    },
  );

  it('rejects non-numeric values', () => {
    expect(MacrosSchema.safeParse({ ...valid, kcal: '78' }).success).toBe(false);
  });
});

describe('SourceSchema', () => {
  it.each(['ai', 'ai-edited', 'manual'])('accepts %s', (source) => {
    expect(SourceSchema.safeParse(source).success).toBe(true);
  });

  it('rejects anything else', () => {
    expect(SourceSchema.safeParse('AI').success).toBe(false);
  });
});

describe('DayKeySchema', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(DayKeySchema.safeParse('2026-10-08').success).toBe(true);
  });

  it.each(['2026-1-08', '2026-10-8', '20261008', '2026/10/08', '2026-10-08T00:00', ''])(
    'rejects %s',
    (key) => {
      expect(DayKeySchema.safeParse(key).success).toBe(false);
    },
  );
});
