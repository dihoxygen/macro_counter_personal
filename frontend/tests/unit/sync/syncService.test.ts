import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncApi } from '../../../src/api/sync';
import { createChanges } from '../../../src/data/changes';
import { openDb, type Db } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { unsyncedCount } from '../../../src/data/outbox';
import type { NewEntry } from '../../../src/data/repositories';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';
import { createSyncService, type SyncService } from '../../../src/sync/syncService';

const banana: NewEntry = {
  dayKey: '2026-11-04',
  loggedAt: '2026-11-04T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 120, unit: 'g' },
  macros: { kcal: 107, proteinG: 1.3, carbsG: 27.5, fatG: 0.4 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
};

const api: SyncApi = {
  getState: async () => ({ noticeAcknowledged: true, revision: 0 }),
  acknowledgeNotice: async () => undefined,
  push: async (request) => ({
    revision: 1,
    results: request.changes.map((c) => ({ type: c.type, id: c.id, status: 'applied' as const })),
  }),
  pull: async (since) => ({ changes: [], cursor: since, hasMore: false, serverNow: '2026-11-04T09:00:00.000Z' }),
};

let db: Db;
let sync: SyncService;
let n = 0;

beforeEach(async () => {
  db = await openDb(`sync-service-test-${++n}-${Date.now()}`);
  sync = createSyncService({ db, api, changes: createChanges(), now: () => new Date() });
});

afterEach(() => sync.stop());

const settled = (service: SyncService) =>
  vi.waitFor(() => expect(service.snapshot()).toMatchObject({ outcome: { kind: 'ok' }, running: false, pending: 0 }));

describe('the snapshot', () => {
  it('reports a finished round', async () => {
    sync.start();

    await settled(sync);
  });

  it('keeps reporting after a stop and a start, as React does on mount in development', async () => {
    sync.start();
    sync.stop();
    const entries = new IdbEntryRepository(db);
    await entries.create(banana);

    sync.start();

    await settled(sync);
  });

  it('counts a waiting change when it is told about one', async () => {
    await new IdbEntryRepository(db).create(banana);

    sync.notifyLocalChange();

    await vi.waitFor(() => expect(sync.snapshot().pending).toBe(1));
  });

  it('tells subscribers', async () => {
    const listener = vi.fn();
    sync.subscribe(listener);

    sync.notifyLocalChange();

    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
  });
});

describe('drain', () => {
  it('waits for a round in flight, and runs no more', async () => {
    let finishPull!: () => void;
    const pull = vi.fn(
      (since: number) =>
        new Promise<Awaited<ReturnType<SyncApi['pull']>>>((resolve) => {
          finishPull = () => resolve({ changes: [], cursor: since, hasMore: false, serverNow: '2026-11-04T09:00:00.000Z' });
        }),
    );
    const slow = createSyncService({ db, api: { ...api, pull }, changes: createChanges(), now: () => new Date() });
    slow.start();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());

    let drained = false;
    const draining = slow.drain().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);

    finishPull();
    await draining;

    expect(drained).toBe(true);
    expect(slow.snapshot().started).toBe(false);
    expect(pull).toHaveBeenCalledOnce();
  });

  it('is immediate when nothing is running', async () => {
    await sync.drain();

    expect(sync.snapshot().started).toBe(false);
  });

  it('refuses a late start, from a state check that was still on its way', async () => {
    await sync.drain();

    sync.start();

    expect(sync.snapshot().started).toBe(false);
  });

  it('syncs again after resume, when signing out did not work', async () => {
    await sync.drain();

    sync.resume();

    expect(sync.snapshot().started).toBe(true);
    await settled(sync);
  });
});

describe('unsyncedCount', () => {
  it('counts what a person changed, not the records behind it', async () => {
    const foods = new IdbSavedFoodRepository(db);
    const entries = new IdbEntryRepository(db);
    await foods.upsertFromEntry(banana);
    const entry = await entries.create(banana);
    await entries.update(entry.id, { name: 'Plantain' });

    expect(await unsyncedCount(db)).toBe(1);
  });

  it('never says nothing is waiting when something is', async () => {
    await new IdbSavedFoodRepository(db).upsertFromEntry(banana);

    expect(await unsyncedCount(db)).toBe(1);
  });

  it('is zero when nothing is waiting', async () => {
    expect(await unsyncedCount(db)).toBe(0);
  });
});
