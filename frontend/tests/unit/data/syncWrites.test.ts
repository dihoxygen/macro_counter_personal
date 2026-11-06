import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { IdbEntryVersionRepository } from '../../../src/data/entryVersionRepository';
import { peek } from '../../../src/data/outbox';
import { IdbProteinGoalRepository } from '../../../src/data/proteinGoalRepository';
import type { NewEntry } from '../../../src/data/repositories';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';

const banana: NewEntry = {
  dayKey: '2026-10-08',
  loggedAt: '2026-10-08T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 118, unit: 'g' },
  macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
  source: 'ai',
  savedFoodId: null,
  mealCategory: 'breakfast',
};

let db: Db;
let entries: IdbEntryRepository;
let onWrite: ReturnType<typeof vi.fn<() => void>>;
let n = 0;

beforeEach(async () => {
  db = await openDb(`sync-writes-test-${++n}-${Date.now()}`);
  onWrite = vi.fn<() => void>();
  entries = new IdbEntryRepository(db, onWrite);
});

describe('creating an entry', () => {
  it('saves the record, gives it a version id, and queues it in one transaction', async () => {
    const entry = await entries.create(banana);

    expect(entry.versionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await peek(db, 10)).toEqual([{ key: `entry:${entry.id}`, op: 'upsert', seq: 1 }]);
    expect(onWrite).toHaveBeenCalledOnce();
  });

  it('stamps the record schema, not the database schema', async () => {
    expect((await entries.create(banana)).schemaVersion).toBe(1);
  });

  it('refuses an entry with no category', async () => {
    await expect(entries.create({ ...banana, mealCategory: undefined as never })).rejects.toThrow();
  });
});

describe('editing an entry', () => {
  it('keeps the old state as a version and gives the new state its own id', async () => {
    const before = await entries.create(banana);

    const after = await entries.update(before.id, { quantity: { amount: 200, unit: 'g' } });

    expect(after.versionId).not.toBe(before.versionId);
    const version = await db.get('entryVersions', before.versionId);
    expect(version).toMatchObject({
      id: before.versionId,
      entryId: before.id,
      changeType: 'edit',
      quantity: { amount: 118, unit: 'g' },
      updatedAt: before.updatedAt,
      createdAt: before.createdAt,
    });
    expect(version!.replacedAt).toBe(after.updatedAt);
  });

  it('queues the version before the entry', async () => {
    const before = await entries.create(banana);

    const after = await entries.update(before.id, { name: 'Plantain' });

    expect(await peek(db, 10)).toEqual([
      { key: `version:${before.versionId}`, op: 'insert', seq: 2 },
      { key: `entry:${after.id}`, op: 'upsert', seq: 3 },
    ]);
  });

  it('writes nothing when nothing changed', async () => {
    const before = await entries.create(banana);
    onWrite.mockClear();

    const after = await entries.update(before.id, { name: 'Banana', quantity: { amount: 118, unit: 'g' } });

    expect(after).toEqual(before);
    expect(await db.count('entryVersions')).toBe(0);
    expect((await peek(db, 10)).length).toBe(1);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('can change the category, and leaves the day alone', async () => {
    const before = await entries.create(banana);

    const after = await entries.update(before.id, { mealCategory: 'dinner' });

    expect(after.mealCategory).toBe('dinner');
    expect(after.dayKey).toBe(before.dayKey);
  });

  it('keeps a pending restore when a restored entry is edited', async () => {
    const before = await entries.create(banana);
    await db.put('outbox', { key: `entry:${before.id}`, op: 'restore', seq: 1 });

    await entries.update(before.id, { name: 'Plantain' });

    expect((await peek(db, 10)).find((i) => i.key === `entry:${before.id}`)!.op).toBe('restore');
  });
});

describe('deleting an entry', () => {
  it('keeps the state as a version, removes the record and queues the delete', async () => {
    const entry = await entries.create(banana);

    await entries.delete(entry.id);

    expect(await entries.get(entry.id)).toBeUndefined();
    const version = await db.get('entryVersions', entry.versionId);
    expect(version).toMatchObject({ entryId: entry.id, changeType: 'delete', name: 'Banana' });
    expect(await peek(db, 10)).toEqual([
      { key: `version:${entry.versionId}`, op: 'insert', seq: 2 },
      { key: `entry:${entry.id}`, op: 'delete', seq: 3, deletedAt: version!.replacedAt },
    ]);
  });

  it('does nothing for an entry that is already gone', async () => {
    await entries.delete('missing');

    expect(await peek(db, 10)).toEqual([]);
  });
});

describe('saved foods and goals', () => {
  it('queue their record', async () => {
    const foods = new IdbSavedFoodRepository(db, onWrite);
    const goals = new IdbProteinGoalRepository(db, onWrite);

    const food = await foods.upsertFromEntry(banana);
    const goal = await goals.setGoal('2026-10-08', 150);

    expect((await peek(db, 10)).map((i) => [i.key, i.op])).toEqual([
      [`food:${food.id}`, 'upsert'],
      [`goal:${goal.id}`, 'upsert'],
    ]);
    expect(onWrite).toHaveBeenCalledTimes(2);
  });

  it('never save a food change without queueing it', async () => {
    const foods = new IdbSavedFoodRepository(db);

    await expect(foods.upsertFromEntry({ ...banana, name: '' })).rejects.toThrow();

    expect(await peek(db, 10)).toEqual([]);
    expect(await db.count('savedFoods')).toBe(0);
  });
});

describe('IdbEntryVersionRepository.listAll', () => {
  it('returns every stored version', async () => {
    const entry = await entries.create(banana);
    await entries.update(entry.id, { name: 'Plantain' });

    const versions = await new IdbEntryVersionRepository(db).listAll();

    expect(versions.map((v) => v.name)).toEqual(['Banana']);
  });
});
