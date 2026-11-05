import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulledChange } from '../../../src/api/sync';
import { createChanges } from '../../../src/data/changes';
import { openDb, type Db } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { peek } from '../../../src/data/outbox';
import { IdbProteinGoalRepository } from '../../../src/data/proteinGoalRepository';
import type { EntryVersion, LogEntry, ProteinGoal, SavedFood } from '../../../src/data/records';
import { applyMerges, applyPulled } from '../../../src/data/remoteApply';

const NOW = '2026-11-04T09:00:00.000Z';
const macros = { kcal: 107, proteinG: 1.3, carbsG: 27.5, fatG: 0.4 };

const entry = (id: string, overrides: Partial<LogEntry> = {}): LogEntry => ({
  id,
  versionId: `state-${id}`,
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
  dayKey: '2026-11-04',
  loggedAt: NOW,
  name: 'Banana',
  quantity: { amount: 120, unit: 'g' },
  macros,
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
  ...overrides,
});

const version = (id: string, replacedAt: string, overrides: Partial<EntryVersion> = {}): EntryVersion => {
  const fields: Partial<LogEntry> = entry('e1');
  delete fields.versionId;
  return { ...(fields as LogEntry), id, entryId: 'e1', changeType: 'edit', replacedAt, ...overrides };
};

const food = (id: string): SavedFood => ({
  id,
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
  name: 'Oats',
  referenceQuantity: { amount: 100, unit: 'g' },
  macros,
  source: 'ai',
  lastUsedAt: NOW,
});

const goal = (id: string, effectiveFrom = '2026-11-04'): ProteinGoal => ({
  id,
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
  effectiveFrom,
  grams: 150,
});

let db: Db;
let changes: ReturnType<typeof createChanges>;
let n = 0;

beforeEach(async () => {
  db = await openDb(`remote-apply-test-${++n}-${Date.now()}`);
  changes = createChanges();
});

const apply = (pulled: PulledChange[], cursor = 9, serverNow = NOW) => applyPulled(db, pulled, cursor, serverNow, changes);

describe('applyPulled', () => {
  it('writes records without queueing them', async () => {
    await apply([
      { type: 'entry', revision: 1, record: entry('e1') },
      { type: 'food', revision: 2, record: food('f1') },
      { type: 'goal', revision: 3, record: goal('g1') },
      { type: 'version', revision: 4, record: version('v1', NOW) },
    ]);

    expect(await db.get('entries', 'e1')).toEqual(entry('e1'));
    expect(await db.get('savedFoods', 'f1')).toEqual(food('f1'));
    expect(await db.get('proteinGoals', 'g1')).toEqual(goal('g1'));
    expect(await db.get('entryVersions', 'v1')).toEqual(version('v1', NOW));
    expect(await peek(db, 10)).toEqual([]);
  });

  it('saves the cursor and server time', async () => {
    await apply([{ type: 'entry', revision: 7, record: entry('e1') }], 7, NOW);

    expect(await db.get('meta', 'sync.cursor')).toBe(7);
    expect(await db.get('meta', 'sync.serverNow')).toBe(NOW);
  });

  it('removes a deleted entry', async () => {
    await db.put('entries', entry('e1'));

    await apply([{ type: 'entry', revision: 1, id: 'e1', deleted: true }]);

    expect(await db.get('entries', 'e1')).toBeUndefined();
  });

  it('leaves a record with a pending change for the push to settle', async () => {
    const repository = new IdbEntryRepository(db);
    const mine = await repository.create({ ...entry('x'), mealCategory: 'lunch' });

    await apply([
      { type: 'entry', revision: 1, record: entry(mine.id, { name: 'Theirs' }) },
      { type: 'entry', revision: 2, id: 'other', deleted: true },
    ]);

    expect((await db.get('entries', mine.id))!.name).toBe('Banana');
  });

  it('also leaves a pending entry alone when the pulled change is a deletion', async () => {
    const repository = new IdbEntryRepository(db);
    const mine = await repository.create({ ...entry('x'), mealCategory: 'lunch' });

    await apply([{ type: 'entry', revision: 1, id: mine.id, deleted: true }]);

    expect(await db.get('entries', mine.id)).toBeDefined();
  });

  it('always writes versions, which never change', async () => {
    await db.put('entryVersions', version('v1', NOW, { changeType: 'delete' }));
    await db.put('outbox', { key: 'version:v1', op: 'insert', seq: 1 });

    await apply([{ type: 'version', revision: 1, record: version('v1', NOW, { changeType: 'edit' }) }]);

    expect((await db.get('entryVersions', 'v1'))!.changeType).toBe('edit');
  });

  it('removes versions past 90 days by server time, however wrong this device clock is', async () => {
    await db.put('entryVersions', version('old', '2026-08-05T08:59:59.000Z'));
    await db.put('entryVersions', version('kept', '2026-08-06T09:00:01.000Z'));

    await apply([], 0, NOW);

    expect((await db.getAll('entryVersions')).map((v) => v.id)).toEqual(['kept']);
  });

  it('replaces a local goal for the same day under another id', async () => {
    await db.put('proteinGoals', goal('mine'));

    await apply([{ type: 'goal', revision: 1, record: goal('canonical') }]);

    expect((await db.getAll('proteinGoals')).map((g) => g.id)).toEqual(['canonical']);
  });

  it('keeps a pending local goal for the same day, for the push to merge', async () => {
    const goals = new IdbProteinGoalRepository(db);
    const mine = await goals.setGoal('2026-11-04', 140);

    await apply([{ type: 'goal', revision: 1, record: goal('canonical') }]);

    expect((await db.getAll('proteinGoals')).map((g) => g.id)).toEqual([mine.id]);
  });

  it('tells subscribers once a page, with what changed', async () => {
    const listener = vi.fn();
    changes.subscribe(listener);

    await apply([
      { type: 'entry', revision: 1, record: entry('e1') },
      { type: 'entry', revision: 2, record: entry('e2') },
      { type: 'food', revision: 3, record: food('f1') },
    ]);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(new Set(['entry', 'food']));
  });

  it('says nothing about an empty page', async () => {
    const listener = vi.fn();
    changes.subscribe(listener);

    await apply([]);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('changes', () => {
  it('stops telling a listener that unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = changes.subscribe(listener);

    unsubscribe();
    changes.emit(new Set(['entry']));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('applyMerges', () => {
  it('moves a merged food to its canonical id and repoints what links to it', async () => {
    await db.put('savedFoods', food('alias'));
    await db.put('entries', entry('e1', { savedFoodId: 'alias' }));
    await db.put('entries', entry('e2', { savedFoodId: 'other' }));
    await db.put('entryVersions', version('v1', NOW, { savedFoodId: 'alias' }));

    await applyMerges(db, [{ type: 'food', id: 'alias', canonicalId: 'canonical' }], changes);

    expect(await db.get('savedFoods', 'alias')).toBeUndefined();
    expect(await db.get('savedFoods', 'canonical')).toMatchObject({ id: 'canonical', name: 'Oats' });
    expect((await db.get('entries', 'e1'))!.savedFoodId).toBe('canonical');
    expect((await db.get('entries', 'e2'))!.savedFoodId).toBe('other');
    expect((await db.get('entryVersions', 'v1'))!.savedFoodId).toBe('canonical');
  });

  it('moves a merged goal to its canonical id', async () => {
    await db.put('proteinGoals', goal('alias'));

    await applyMerges(db, [{ type: 'goal', id: 'alias', canonicalId: 'canonical' }], changes);

    expect((await db.getAll('proteinGoals')).map((g) => g.id)).toEqual(['canonical']);
  });

  it('drops a queued change for the old id', async () => {
    await db.put('savedFoods', food('alias'));
    await db.put('outbox', { key: 'food:alias', op: 'upsert', seq: 1 });

    await applyMerges(db, [{ type: 'food', id: 'alias', canonicalId: 'canonical' }], changes);

    expect(await peek(db, 10)).toEqual([]);
  });

  it('keeps the canonical record when it is already here', async () => {
    await db.put('savedFoods', food('alias'));
    await db.put('savedFoods', { ...food('canonical'), name: 'Rolled oats' });

    await applyMerges(db, [{ type: 'food', id: 'alias', canonicalId: 'canonical' }], changes);

    expect((await db.getAll('savedFoods')).map((f) => f.name)).toEqual(['Rolled oats']);
  });
});
