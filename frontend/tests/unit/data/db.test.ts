import { describe, expect, it, vi } from 'vitest';
import { DB_NAME, openDb } from '../../../src/data/db';
import { runMigrations, type Migration } from '../../../src/data/migrations';

let n = 0;
const uniqueName = () => `db-test-${++n}-${Date.now()}`;

describe('openDb', () => {
  it('uses the database name macro-counter by default', () => {
    expect(DB_NAME).toBe('macro-counter');
  });

  it('creates the stores and indexes', async () => {
    const db = await openDb(uniqueName());
    expect([...db.objectStoreNames].sort()).toEqual(['entries', 'meta', 'proteinGoals', 'savedFoods']);

    const tx = db.transaction(['entries', 'savedFoods', 'proteinGoals']);
    expect([...tx.objectStore('entries').indexNames]).toContain('dayKey');
    expect([...tx.objectStore('savedFoods').indexNames]).toContain('lastUsedAt');
    const goalIndex = tx.objectStore('proteinGoals').index('effectiveFrom');
    expect(goalIndex.unique).toBe(true);
    await tx.done;
    db.close();
  });

  it('writes meta.schemaVersion = 1', async () => {
    const db = await openDb(uniqueName());
    expect(await db.get('meta', 'schemaVersion')).toBe(1);
    db.close();
  });

  it('does not re-run migrations when the database is opened again', async () => {
    const name = uniqueName();
    const first = await openDb(name);
    await first.put('meta', 99, 'marker');
    first.close();
    const second = await openDb(name);
    expect(await second.get('meta', 'marker')).toBe(99);
    expect(await second.get('meta', 'schemaVersion')).toBe(1);
    second.close();
  });
});

describe('runMigrations', () => {
  const make = (version: number, log: number[]): Migration<null> => ({
    version,
    up: () => {
      log.push(version);
    },
  });

  it('applies pending migrations in version order, each exactly once', () => {
    const log: number[] = [];
    const migrations = [make(3, log), make(1, log), make(2, log)];
    runMigrations(migrations, 0, 3, null);
    expect(log).toEqual([1, 2, 3]);
  });

  it('applies only migrations newer than the old version', () => {
    const log: number[] = [];
    runMigrations([make(1, log), make(2, log), make(3, log)], 1, 3, null);
    expect(log).toEqual([2, 3]);
  });

  it('does nothing when already up to date', () => {
    const up = vi.fn();
    runMigrations([{ version: 1, up }], 1, 1, null);
    expect(up).not.toHaveBeenCalled();
  });

  it('fails loudly on a version gap', () => {
    const log: number[] = [];
    expect(() => runMigrations([make(1, log), make(3, log)], 0, 3, null)).toThrow(/gap|missing/i);
    expect(log).toEqual([]);
  });

  it('fails loudly when the target version has no migration', () => {
    const log: number[] = [];
    expect(() => runMigrations([make(1, log)], 0, 2, null)).toThrow(/missing/i);
  });

  it('fails loudly on duplicate versions', () => {
    const log: number[] = [];
    expect(() => runMigrations([make(1, log), make(1, log)], 0, 1, null)).toThrow(/duplicate/i);
  });
});
