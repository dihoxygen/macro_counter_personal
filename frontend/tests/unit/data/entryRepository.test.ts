import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import type { EntryRepository, NewEntry } from '../../../src/data/repositories';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const banana: NewEntry = {
  dayKey: '2026-10-08',
  loggedAt: '2026-10-08T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 118, unit: 'g' },
  macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
  source: 'ai',
  savedFoodId: null,
};

let repo: EntryRepository;
let n = 0;

beforeEach(async () => {
  repo = new IdbEntryRepository(await openDb(`entries-test-${++n}-${Date.now()}`));
});

describe('IdbEntryRepository.create', () => {
  it('assigns a UUID v4 id, ISO UTC timestamps and schemaVersion', async () => {
    const entry = await repo.create(banana);
    expect(entry.id).toMatch(UUID_V4);
    expect(entry.createdAt).toMatch(ISO_UTC);
    expect(entry.updatedAt).toBe(entry.createdAt);
    expect(entry.schemaVersion).toBe(1);
    expect(entry).toMatchObject(banana);
    expect(await repo.get(entry.id)).toEqual(entry);
  });

  it('gives each entry a distinct id', async () => {
    const a = await repo.create(banana);
    const b = await repo.create(banana);
    expect(a.id).not.toBe(b.id);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['a name over 120 characters', { name: 'x'.repeat(121) }],
    ['negative protein', { macros: { ...banana.macros, proteinG: -1 } }],
    ['NaN kcal', { macros: { ...banana.macros, kcal: Number.NaN } }],
    ['an Infinity amount', { quantity: { amount: Number.POSITIVE_INFINITY, unit: 'g' } }],
    ['a bad unit', { quantity: { amount: 1, unit: 'oz' } }],
    ['a bad dayKey', { dayKey: '2026-10-8' }],
  ])('rejects %s instead of clamping it', async (_label, patch) => {
    await expect(repo.create({ ...banana, ...patch } as NewEntry)).rejects.toThrow();
    expect(await repo.listByDay(banana.dayKey)).toEqual([]);
  });

  it('accepts a 120-character name', async () => {
    await expect(repo.create({ ...banana, name: 'x'.repeat(120) })).resolves.toBeDefined();
  });
});

describe('IdbEntryRepository.listByDay', () => {
  it('returns only that day, ordered by loggedAt ascending', async () => {
    await repo.create({ ...banana, name: 'Late', loggedAt: '2026-10-08T20:00:00.000Z' });
    await repo.create({ ...banana, name: 'Early', loggedAt: '2026-10-08T06:00:00.000Z' });
    await repo.create({ ...banana, name: 'Other day', dayKey: '2026-10-07' });
    const names = (await repo.listByDay('2026-10-08')).map((e) => e.name);
    expect(names).toEqual(['Early', 'Late']);
  });
});

describe('IdbEntryRepository.update', () => {
  it('applies the patch, bumps updatedAt and never changes dayKey', async () => {
    const entry = await repo.create(banana);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await repo.update(entry.id, {
      macros: { ...banana.macros, proteinG: 2 },
      source: 'ai-edited',
      dayKey: '1999-01-01',
    } as never);
    expect(updated.macros.proteinG).toBe(2);
    expect(updated.source).toBe('ai-edited');
    expect(updated.dayKey).toBe('2026-10-08');
    expect(updated.id).toBe(entry.id);
    expect(updated.createdAt).toBe(entry.createdAt);
    expect(updated.updatedAt > entry.updatedAt).toBe(true);
    expect(await repo.get(entry.id)).toEqual(updated);
  });

  it('rejects invalid values', async () => {
    const entry = await repo.create(banana);
    await expect(
      repo.update(entry.id, { macros: { ...banana.macros, fatG: -2 } }),
    ).rejects.toThrow();
    expect(await repo.get(entry.id)).toEqual(entry);
  });

  it('rejects an unknown id', async () => {
    await expect(repo.update('missing', { name: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('IdbEntryRepository.delete', () => {
  it('removes the entry', async () => {
    const entry = await repo.create(banana);
    await repo.delete(entry.id);
    expect(await repo.get(entry.id)).toBeUndefined();
    expect(await repo.listByDay(banana.dayKey)).toEqual([]);
  });
});
