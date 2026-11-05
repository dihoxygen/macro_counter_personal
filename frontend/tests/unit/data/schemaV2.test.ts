import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { openDb, type OutboxItem } from '../../../src/data/db';

let n = 0;
const uniqueName = () => `schema-v2-${++n}-${Date.now()}`;

const meta = (id: string) => ({
  id,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-02-03T04:05:06.000Z',
  schemaVersion: 1,
});
const macros = { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 };

const v1Entry = (id: string, name: string, unit = 'g', savedFoodId: string | null = null) => ({
  ...meta(id),
  dayKey: '2026-01-02',
  loggedAt: '2026-01-02T08:00:00.000Z',
  name,
  quantity: { amount: 100, unit },
  macros,
  source: 'manual',
  savedFoodId,
});
const v1Food = (id: string, name: string, unit = 'g') => ({
  ...meta(id),
  name,
  referenceQuantity: { amount: 100, unit },
  macros,
  source: 'manual',
  lastUsedAt: '2026-01-02T00:00:00.000Z',
});
const v1Goal = { ...meta('goal-1'), effectiveFrom: '2026-01-01', grams: 140 };

/** A database as feature 003 left it, at schema version 1. */
async function v1Database(seed: { entries?: unknown[]; foods?: unknown[]; goals?: unknown[] }) {
  const name = uniqueName();
  const db = await openDB(name, 1, {
    upgrade(database) {
      database.createObjectStore('entries', { keyPath: 'id' }).createIndex('dayKey', 'dayKey');
      database.createObjectStore('savedFoods', { keyPath: 'id' }).createIndex('lastUsedAt', 'lastUsedAt');
      database.createObjectStore('proteinGoals', { keyPath: 'id' }).createIndex('effectiveFrom', 'effectiveFrom', { unique: true });
      database.createObjectStore('meta');
    },
  });
  for (const entry of seed.entries ?? []) await db.put('entries', entry);
  for (const food of seed.foods ?? []) await db.put('savedFoods', food);
  for (const goal of seed.goals ?? []) await db.put('proteinGoals', goal);
  await db.put('meta', 1, 'schemaVersion');
  db.close();
  return name;
}

const bySeq = (items: OutboxItem[]) => [...items].sort((a, b) => a.seq - b.seq);

describe('schema v2', () => {
  it('adds the sync stores and their indexes', async () => {
    const db = await openDb(uniqueName());
    expect([...db.objectStoreNames].sort()).toEqual([
      'entries',
      'entryVersions',
      'meta',
      'outbox',
      'proteinGoals',
      'quarantine',
      'savedFoods',
    ]);
    const tx = db.transaction(['entryVersions', 'outbox']);
    expect([...tx.objectStore('entryVersions').indexNames].sort()).toEqual(['dayKey', 'entryId', 'replacedAt']);
    expect([...tx.objectStore('outbox').indexNames]).toEqual(['seq']);
    await tx.done;
    db.close();
  });

  it('starts a new database at cursor 0 with an empty outbox', async () => {
    const db = await openDb(uniqueName());
    expect(await db.get('meta', 'schemaVersion')).toBe(2);
    expect(await db.get('meta', 'sync.cursor')).toBe(0);
    expect(await db.get('meta', 'outboxSeq')).toBe(0);
    expect(await db.count('outbox')).toBe(0);
    db.close();
  });
});

describe('the v1 to v2 migration', () => {
  it('keeps each entry as it was, adding only a version id and no category', async () => {
    const name = await v1Database({ entries: [v1Entry('e1', 'Egg')] });

    const db = await openDb(name);

    const entry = await db.get('entries', 'e1');
    expect(entry).toMatchObject({ ...v1Entry('e1', 'Egg'), mealCategory: null });
    expect(entry!.versionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.get('meta', 'schemaVersion')).toBe(2);
    db.close();
  });

  it('queues everything for the first sync, foods before the entries that link to them', async () => {
    const name = await v1Database({
      entries: [v1Entry('e1', 'Egg'), v1Entry('e2', 'Toast'), v1Entry('e3', 'Tea')],
      foods: [v1Food('f1', 'Egg'), v1Food('f2', 'Toast')],
      goals: [v1Goal],
    });

    const db = await openDb(name);

    const items = bySeq(await db.getAll('outbox'));
    expect(items.map((i) => i.key.split(':')[0])).toEqual(['food', 'food', 'goal', 'entry', 'entry', 'entry']);
    expect(items.every((i) => i.op === 'upsert')).toBe(true);
    expect(items.map((i) => i.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await db.get('meta', 'outboxSeq')).toBe(6);
    expect(await db.get('meta', 'sync.cursor')).toBe(0);
    db.close();
  });

  it('links an entry to the saved food with the same name and unit', async () => {
    const name = await v1Database({
      entries: [v1Entry('e1', '  GREEK yogurt '), v1Entry('e2', 'Greek yogurt', 'ml')],
      foods: [v1Food('f1', 'Greek yogurt')],
    });

    const db = await openDb(name);

    expect((await db.get('entries', 'e1'))!.savedFoodId).toBe('f1');
    expect((await db.get('entries', 'e2'))!.savedFoodId).toBeNull();
    db.close();
  });

  it('leaves an existing link and the update time alone', async () => {
    const name = await v1Database({
      entries: [v1Entry('e1', 'Egg', 'g', 'other-food')],
      foods: [v1Food('f1', 'Egg')],
    });

    const db = await openDb(name);

    const entry = await db.get('entries', 'e1');
    expect(entry!.savedFoodId).toBe('other-food');
    expect(entry!.updatedAt).toBe('2026-02-03T04:05:06.000Z');
    db.close();
  });
});
