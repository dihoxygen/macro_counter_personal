import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/data/db';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';
import { refusalFor } from '../../../src/data/syncBounds';
import { boundsCases, normalizeCases, recordFor } from '../../../src/test/syncVectors';

describe('refusalFor', () => {
  it.each(boundsCases.map((c) => [c.name, c] as const))('%s', (_name, vector) => {
    expect(refusalFor(vector.type, recordFor(vector))).toBe(vector.valid ? undefined : vector.reason);
  });
});

describe('name matching', () => {
  it.each(normalizeCases.map((c) => [c.input, c.normalized] as const))('treats %j as %j', async (input, normalized) => {
    const foods = new IdbSavedFoodRepository(await openDb(`bounds-${input.length}-${Math.random()}`));
    const entry = {
      dayKey: '2026-11-04',
      loggedAt: '2026-11-04T08:00:00.000Z',
      quantity: { amount: 1, unit: 'g' as const },
      macros: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 },
      source: 'manual' as const,
      savedFoodId: null,
      mealCategory: 'lunch' as const,
    };

    const first = await foods.upsertFromEntry({ ...entry, name: normalized });
    const second = await foods.upsertFromEntry({ ...entry, name: input });

    expect(second.id).toBe(first.id);
  });
});
