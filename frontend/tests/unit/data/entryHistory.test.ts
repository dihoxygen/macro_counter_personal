import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { IdbEntryVersionRepository } from '../../../src/data/entryVersionRepository';
import { peek } from '../../../src/data/outbox';
import type { NewEntry } from '../../../src/data/repositories';

const banana: NewEntry = {
  dayKey: '2026-11-04',
  loggedAt: '2026-11-04T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 1, carbsG: 20, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
};

const NOW = new Date('2026-11-05T12:00:00.000Z');

let db: Db;
let entries: IdbEntryRepository;
let versions: IdbEntryVersionRepository;
let onWrite: ReturnType<typeof vi.fn<() => void>>;
let n = 0;

beforeEach(async () => {
  db = await openDb(`entry-history-test-${++n}-${Date.now()}`);
  onWrite = vi.fn<() => void>();
  entries = new IdbEntryRepository(db);
  versions = new IdbEntryVersionRepository(db, onWrite, () => NOW);
});

const amount = (grams: number) => ({ quantity: { amount: grams, unit: 'g' as const } });

describe('listForEntry', () => {
  it('lists earlier states newest first', async () => {
    const entry = await entries.create(banana);
    await entries.update(entry.id, amount(200));
    const current = await entries.update(entry.id, amount(300));

    const list = await versions.listForEntry(current);

    expect(list.map((v) => v.quantity.amount)).toEqual([200, 100]);
  });

  it('leaves out a state that is the current one', async () => {
    const entry = await entries.create(banana);
    const current = await entries.update(entry.id, amount(200));
    await db.put('entryVersions', {
      ...current,
      id: current.versionId,
      entryId: entry.id,
      changeType: 'edit',
      replacedAt: current.updatedAt,
    });

    expect((await versions.listForEntry(current)).map((v) => v.quantity.amount)).toEqual([100]);
  });

  it('hides states past 90 days by the last server time', async () => {
    const entry = await entries.create(banana);
    const current = await entries.update(entry.id, amount(200));
    await db.put('meta', '2027-03-01T00:00:00.000Z', 'sync.serverNow');

    expect(await versions.listForEntry(current)).toEqual([]);
  });

  it('uses the device clock until the first sync', async () => {
    const entry = await entries.create(banana);
    const current = await entries.update(entry.id, amount(200));
    const stale = new IdbEntryVersionRepository(db, onWrite, () => new Date('2027-06-01T00:00:00.000Z'));

    expect(await stale.listForEntry(current)).toEqual([]);
  });
});

describe('listDeletedForDay', () => {
  it('lists deleted entries for that day only', async () => {
    const today = await entries.create(banana);
    const other = await entries.create({ ...banana, dayKey: '2026-11-03' });
    await entries.delete(today.id);
    await entries.delete(other.id);

    expect((await versions.listDeletedForDay('2026-11-04')).map((v) => v.entryId)).toEqual([today.id]);
  });

  it('leaves out an entry that was restored', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    const [deleted] = await versions.listDeletedForDay('2026-11-04');

    await versions.restore(deleted!.id);

    expect(await versions.listDeletedForDay('2026-11-04')).toEqual([]);
  });

  it('shows an entry once, however many times it was deleted', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    const [first] = await versions.listDeletedForDay('2026-11-04');
    await versions.restore(first!.id);
    await entries.delete(entry.id);

    expect(await versions.listDeletedForDay('2026-11-04')).toHaveLength(1);
  });

  it('hides a delete past 90 days', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    await db.put('meta', '2027-03-01T00:00:00.000Z', 'sync.serverNow');

    expect(await versions.listDeletedForDay('2026-11-04')).toEqual([]);
  });
});

describe('restore', () => {
  it('brings a deleted entry back with the same id and a new state', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    const [deleted] = await versions.listDeletedForDay('2026-11-04');

    const restored = await versions.restore(deleted!.id);

    expect(restored.id).toBe(entry.id);
    expect(restored.versionId).not.toBe(entry.versionId);
    expect(restored.createdAt).toBe(entry.createdAt);
    expect(restored.restoredAt).toBe(restored.updatedAt);
    expect(await entries.get(entry.id)).toEqual(restored);
    expect(restored).toMatchObject({ name: 'Banana', dayKey: '2026-11-04', quantity: { amount: 100, unit: 'g' } });
    expect(restored).not.toHaveProperty('entryId');
    expect(onWrite).toHaveBeenCalled();
  });

  it('queues a restore, which is how the server tells it from a stale copy', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    const [deleted] = await versions.listDeletedForDay('2026-11-04');

    await versions.restore(deleted!.id);

    expect((await peek(db, 20)).find((i) => i.key === `entry:${entry.id}`)!.op).toBe('restore');
  });

  it('keeps the live state it replaces, marked as a restore', async () => {
    const entry = await entries.create(banana);
    const edited = await entries.update(entry.id, amount(200));
    const [earlier] = await versions.listForEntry(edited);

    const restored = await versions.restore(earlier!.id);

    expect(restored.quantity.amount).toBe(100);
    expect(await db.get('entryVersions', edited.versionId)).toMatchObject({ changeType: 'restore', quantity: { amount: 200, unit: 'g' } });
    expect((await peek(db, 20)).some((i) => i.key === `version:${edited.versionId}`)).toBe(true);
  });

  it('is always later than what it replaces', async () => {
    const entry = await entries.create(banana);
    const edited = await entries.update(entry.id, amount(200));
    const [earlier] = await versions.listForEntry(edited);

    const restored = await versions.restore(earlier!.id);

    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(edited.updatedAt));
  });

  it('keeps a meal rather than going back to Uncategorized', async () => {
    const entry = await entries.create(banana);
    await db.put('entries', { ...entry, mealCategory: null });
    const categorized = await entries.update(entry.id, { mealCategory: 'dinner' });
    const [earlier] = await versions.listForEntry(categorized);

    const restored = await versions.restore(earlier!.id);

    expect(restored.mealCategory).toBe('dinner');
  });

  it('refuses a version that is not here', async () => {
    await expect(versions.restore('missing')).rejects.toThrow(/not found/);
  });

  it('survives an edit before it syncs', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);
    const [deleted] = await versions.listDeletedForDay('2026-11-04');
    await versions.restore(deleted!.id);

    await entries.update(entry.id, { name: 'Plantain' });

    expect((await peek(db, 20)).find((i) => i.key === `entry:${entry.id}`)!.op).toBe('restore');
  });
});

describe('listByDayRange', () => {
  it('is inclusive at both ends', async () => {
    for (const dayKey of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) await entries.create({ ...banana, dayKey });

    const list = await entries.listByDayRange('2026-11-02', '2026-11-03');

    expect(list.map((e) => e.dayKey).sort()).toEqual(['2026-11-02', '2026-11-03']);
  });
});
