import { describe, expect, it, vi } from 'vitest';
import { DB_NAME, openDb, openUserDb, userDbName } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { runMigrations, type Migration } from '../../../src/data/migrations';

let n = 0;
const uniqueName = () => `db-test-${++n}-${Date.now()}`;

describe('openDb', () => {
  it('uses the database name macro-counter by default', () => {
    expect(DB_NAME).toBe('macro-counter');
  });

  it('creates the stores and indexes', async () => {
    const db = await openDb(uniqueName());
    expect([...db.objectStoreNames].sort()).toEqual([
      'entries',
      'meta',
      'proteinGoals',
      'savedFoods',
    ]);

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

describe('per-account databases (FR-016)', () => {
  const alice = '6f1c2a4e-0000-4000-8000-00000000000a';
  const bob = '6f1c2a4e-0000-4000-8000-00000000000b';

  it('names each account its own database', () => {
    expect(userDbName(alice)).toBe(`macro-counter.u.${alice}`);
  });

  it.each(['', 'alice', '../macro-counter', `${alice}x`, 'macro-counter'])(
    'rejects %j as an account id',
    (id) => {
      expect(() => userDbName(id)).toThrow();
    },
  );

  it('keeps two accounts apart and runs the normal schema for each', async () => {
    const a = await openUserDb(alice);
    const b = await openUserDb(bob);
    expect([...b.objectStoreNames].sort()).toEqual([
      'entries',
      'meta',
      'proteinGoals',
      'savedFoods',
    ]);
    expect(await b.get('meta', 'schemaVersion')).toBe(1);

    await new IdbEntryRepository(a).create({
      dayKey: '2026-10-14',
      loggedAt: '2026-10-14T08:00:00.000Z',
      name: 'Banana',
      quantity: { amount: 118, unit: 'g' },
      macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
      source: 'manual',
      savedFoodId: null,
    });

    expect(await new IdbEntryRepository(a).listByDay('2026-10-14')).toHaveLength(1);
    expect(await new IdbEntryRepository(b).listByDay('2026-10-14')).toHaveLength(0);
    a.close();
    b.close();
  });
});
