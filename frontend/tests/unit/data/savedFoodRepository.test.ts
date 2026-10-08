import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/data/db';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';
import type { NewEntry, SavedFoodRepository } from '../../../src/data/repositories';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const yogurt: NewEntry = {
  dayKey: '2026-10-08',
  loggedAt: '2026-10-08T08:00:00.000Z',
  name: 'Greek yogurt',
  quantity: { amount: 170, unit: 'g' },
  macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
  source: 'ai',
  savedFoodId: null,
};

let repo: SavedFoodRepository;
let n = 0;

beforeEach(async () => {
  repo = new IdbSavedFoodRepository(await openDb(`saved-foods-test-${++n}-${Date.now()}`));
});

describe('IdbSavedFoodRepository.upsertFromEntry', () => {
  it('creates a saved food with sync-ready metadata when there is no match', async () => {
    const food = await repo.upsertFromEntry(yogurt);
    expect(food).toMatchObject({
      name: 'Greek yogurt',
      referenceQuantity: { amount: 170, unit: 'g' },
      macros: yogurt.macros,
      source: 'ai',
      lastUsedAt: yogurt.loggedAt,
      schemaVersion: 1,
    });
    expect(food.id).toMatch(UUID_V4);
    expect(food.createdAt).toBe(food.updatedAt);
    expect(await repo.get(food.id)).toEqual(food);
  });

  it('matches the same normalized name (trimmed, lowercase) and unit, and updates it', async () => {
    const first = await repo.upsertFromEntry(yogurt);
    const second = await repo.upsertFromEntry({
      ...yogurt,
      name: '  greek YOGURT ',
      loggedAt: '2026-10-09T08:00:00.000Z',
      quantity: { amount: 200, unit: 'g' },
      macros: { kcal: 118, proteinG: 20, carbsG: 7, fatG: 0.8 },
      source: 'ai-edited',
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(second).toMatchObject({
      referenceQuantity: { amount: 200, unit: 'g' },
      macros: { kcal: 118, proteinG: 20, carbsG: 7, fatG: 0.8 },
      source: 'ai-edited',
      lastUsedAt: '2026-10-09T08:00:00.000Z',
    });
    expect(await repo.listRecent()).toHaveLength(1);
  });

  it('treats a different unit as a different food', async () => {
    const grams = await repo.upsertFromEntry(yogurt);
    const serving = await repo.upsertFromEntry({ ...yogurt, quantity: { amount: 1, unit: 'serving' } });
    expect(serving.id).not.toBe(grams.id);
    expect(await repo.listRecent()).toHaveLength(2);
  });

  it('rejects invalid values', async () => {
    await expect(repo.upsertFromEntry({ ...yogurt, name: '' })).rejects.toThrow();
    await expect(
      repo.upsertFromEntry({ ...yogurt, macros: { ...yogurt.macros, kcal: -1 } }),
    ).rejects.toThrow();
  });
});

describe('IdbSavedFoodRepository.listRecent', () => {
  it('sorts by lastUsedAt, most recent first', async () => {
    await repo.upsertFromEntry({ ...yogurt, name: 'Old', loggedAt: '2026-10-01T08:00:00.000Z' });
    await repo.upsertFromEntry({ ...yogurt, name: 'New', loggedAt: '2026-10-08T08:00:00.000Z' });
    await repo.upsertFromEntry({ ...yogurt, name: 'Middle', loggedAt: '2026-10-05T08:00:00.000Z' });
    expect((await repo.listRecent()).map((f) => f.name)).toEqual(['New', 'Middle', 'Old']);
  });

  it('returns at most 20 by default, and honours a limit', async () => {
    for (let i = 0; i < 25; i++) {
      await repo.upsertFromEntry({
        ...yogurt,
        name: `Food ${i}`,
        loggedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      });
    }
    const recent = await repo.listRecent();
    expect(recent).toHaveLength(20);
    expect(recent[0]!.name).toBe('Food 24');
    expect(await repo.listRecent(3)).toHaveLength(3);
  });

  it('is empty when nothing has been saved', async () => {
    expect(await repo.listRecent()).toEqual([]);
  });
});
