import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../../src/data/db';
import { IdbDevicePreferences } from '../../../src/data/devicePreferences';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { IdbEntryVersionRepository } from '../../../src/data/entryVersionRepository';
import { buildExport, exportFileName, readExport } from '../../../src/data/exportData';
import { IdbProteinGoalRepository } from '../../../src/data/proteinGoalRepository';
import type { NewEntry } from '../../../src/data/repositories';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';

const banana: NewEntry = {
  dayKey: '2026-11-04',
  loggedAt: '2026-11-04T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 33.333333333333336, unit: 'g' },
  macros: { kcal: 123.456789, proteinG: 1.3, carbsG: 27.5, fatG: 0.4 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
};

let db: Db;
let n = 0;

const sourcesFor = (database: Db) => ({
  entries: new IdbEntryRepository(database),
  savedFoods: new IdbSavedFoodRepository(database),
  goals: new IdbProteinGoalRepository(database),
  entryVersions: new IdbEntryVersionRepository(database),
});

let sources: ReturnType<typeof sourcesFor>;

beforeEach(async () => {
  db = await openDb(`export-test-${++n}-${Date.now()}`);
  sources = sourcesFor(db);
});

describe('buildExport', () => {
  it('holds every record type under a versioned header', () => {
    const file = buildExport({ entries: [], savedFoods: [], proteinGoals: [], entryVersions: [] }, new Date('2026-11-04T09:00:00.000Z'));

    expect(file).toEqual({
      format: 'macro-counter-export',
      formatVersion: 1,
      exportedAt: '2026-11-04T09:00:00.000Z',
      entries: [],
      savedFoods: [],
      proteinGoals: [],
      entryVersions: [],
    });
  });
});

describe('readExport', () => {
  it('collects everything on the device, at full precision', async () => {
    const entry = await sources.entries.create(banana);
    await sources.entries.update(entry.id, { name: 'Plantain' });
    await sources.savedFoods.upsertFromEntry(banana);
    await sources.goals.setGoal('2026-11-04', 150);

    const file = await readExport(sources, new Date());

    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]!.macros.kcal).toBe(123.456789);
    expect(file.entries[0]!.quantity.amount).toBe(33.333333333333336);
    expect(file.entryVersions.map((v) => v.name)).toEqual(['Banana']);
    expect(file.savedFoods).toHaveLength(1);
    expect(file.proteinGoals).toHaveLength(1);
  });

  it('leaves out what only makes sense on this device', async () => {
    await sources.entries.create(banana);
    await new IdbDevicePreferences(db).setCameraId('camera-secret');

    const text = JSON.stringify(await readExport(sources, new Date()));

    expect(text).not.toContain('camera-secret');
    expect(text).not.toContain('outbox');
    expect(text).not.toContain('quarantine');
    expect(text).not.toContain('sync.cursor');
  });

  it('reads only the database it was given', async () => {
    await sources.entries.create(banana);
    const other = await openDb(`export-other-${++n}-${Date.now()}`);

    expect((await readExport(sourcesFor(other), new Date())).entries).toEqual([]);
  });
});

describe('exportFileName', () => {
  it('names the local day', () => {
    expect(exportFileName(new Date(2026, 10, 4, 23, 30))).toBe('macro-counter-export-2026-11-04.json');
  });
});
