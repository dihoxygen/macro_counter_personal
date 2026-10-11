import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { LogService } from '../../../src/data/logService';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';
import type { NewEntry } from '../../../src/data/repositories';

const entry = (overrides: Partial<NewEntry> = {}): NewEntry => ({
  dayKey: '2026-10-08',
  loggedAt: '2026-10-08T08:00:00.000Z',
  name: 'Greek yogurt',
  quantity: { amount: 170, unit: 'g' },
  macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
  source: 'ai',
  savedFoodId: null,
  ...overrides,
});

let entries: IdbEntryRepository;
let savedFoods: IdbSavedFoodRepository;
let log: LogService;
let n = 0;

beforeEach(async () => {
  const db = await openDb(`log-service-test-${++n}-${Date.now()}`);
  entries = new IdbEntryRepository(db);
  savedFoods = new IdbSavedFoodRepository(db);
  log = new LogService(entries, savedFoods);
});

describe('LogService.confirmEntries', () => {
  it('writes every entry and upserts one saved food per entry', async () => {
    const created = await log.confirmEntries([
      entry({ name: 'Egg', loggedAt: '2026-10-08T08:00:00.000Z' }),
      entry({ name: 'Toast', loggedAt: '2026-10-08T08:00:00.001Z' }),
    ]);

    expect(created.map((e) => e.name)).toEqual(['Egg', 'Toast']);
    expect((await entries.listByDay('2026-10-08')).map((e) => e.name)).toEqual(['Egg', 'Toast']);
    expect((await savedFoods.listRecent()).map((f) => f.name).sort()).toEqual(['Egg', 'Toast']);
  });

  it('saves manual entries too, with their source', async () => {
    await log.confirmEntries([entry({ name: 'Homemade soup', source: 'manual' })]);
    const [food] = await savedFoods.listRecent();
    expect(food).toMatchObject({ name: 'Homemade soup', source: 'manual' });
  });

  it('keeps savedFoodId on entries logged from Recent and refreshes that saved food', async () => {
    const [first] = await log.confirmEntries([entry()]);
    const [food] = await savedFoods.listRecent();
    expect(first!.savedFoodId).toBeNull();

    const [relogged] = await log.confirmEntries([
      entry({
        savedFoodId: food!.id,
        loggedAt: '2026-10-09T08:00:00.000Z',
        dayKey: '2026-10-09',
        quantity: { amount: 85, unit: 'g' },
        macros: { kcal: 50, proteinG: 8.5, carbsG: 3, fatG: 0.35 },
      }),
    ]);

    expect(relogged!.savedFoodId).toBe(food!.id);
    const recent = await savedFoods.listRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ id: food!.id, lastUsedAt: '2026-10-09T08:00:00.000Z' });
  });

  it('writes nothing for an empty list', async () => {
    expect(await log.confirmEntries([])).toEqual([]);
    expect(await savedFoods.listRecent()).toEqual([]);
  });
});
