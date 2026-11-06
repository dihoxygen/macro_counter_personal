import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/http';
import type { PullResponse, PushRequest, PushResponse, SyncApi } from '../../../src/api/sync';
import { createChanges } from '../../../src/data/changes';
import { openDb, type Db } from '../../../src/data/db';
import { IdbEntryRepository } from '../../../src/data/entryRepository';
import { peek, pendingCount, quarantineCount } from '../../../src/data/outbox';
import { IdbProteinGoalRepository } from '../../../src/data/proteinGoalRepository';
import type { LogEntry } from '../../../src/data/records';
import type { NewEntry } from '../../../src/data/repositories';
import { IdbSavedFoodRepository } from '../../../src/data/savedFoodRepository';
import { sumMacros } from '../../../src/domain/nutrition/totals';
import { createSyncEngine, type SyncEngine } from '../../../src/sync/syncEngine';

const SERVER_NOW = '2026-11-04T09:00:00.000Z';

const banana: NewEntry = {
  dayKey: '2026-11-04',
  loggedAt: '2026-11-04T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 120, unit: 'g' },
  macros: { kcal: 107.123456789, proteinG: 1.3, carbsG: 27.5, fatG: 0.4 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
};

const emptyPage: PullResponse = { changes: [], cursor: 0, hasMore: false, serverNow: SERVER_NOW };

class FakeApi implements SyncApi {
  pushes: PushRequest[] = [];
  pulls: number[] = [];
  order: string[] = [];
  pages: PullResponse[] = [];
  pushError: unknown;
  pullError: unknown;
  respond: (request: PushRequest) => PushResponse = (request) => ({
    revision: 1,
    results: request.changes.map((c) => ({ type: c.type, id: c.id, status: 'applied' as const })),
  });

  getState = async () => ({ noticeAcknowledged: true, revision: 0 });
  acknowledgeNotice = async () => undefined;

  push = async (request: PushRequest) => {
    this.order.push('push');
    this.pushes.push(request);
    if (this.pushError) throw this.pushError;
    return this.respond(request);
  };

  pull = async (since: number) => {
    this.order.push('pull');
    this.pulls.push(since);
    if (this.pullError) throw this.pullError;
    return this.pages.shift() ?? { ...emptyPage, cursor: since };
  };
}

let db: Db;
let api: FakeApi;
let engine: SyncEngine;
let entries: IdbEntryRepository;
let n = 0;

beforeEach(async () => {
  db = await openDb(`sync-engine-test-${++n}-${Date.now()}`);
  api = new FakeApi();
  engine = createSyncEngine({ db, api, changes: createChanges(), now: () => new Date('2026-11-04T08:30:00.000Z') });
  entries = new IdbEntryRepository(db);
});

describe('a round', () => {
  it('pushes, then pulls', async () => {
    await entries.create(banana);

    await engine.runRound();

    expect(api.order).toEqual(['push', 'pull']);
    expect(engine.outcome()).toEqual({ kind: 'ok' });
  });

  it('pulls without pushing when nothing is waiting', async () => {
    await engine.runRound();

    expect(api.order).toEqual(['pull']);
  });

  it('sends the device time and the latest state of each record, once', async () => {
    const entry = await entries.create(banana);
    const edited = await entries.update(entry.id, { name: 'Plantain' });

    await engine.runRound();

    const [request] = api.pushes;
    expect(request!.clientNow).toBe('2026-11-04T08:30:00.000Z');
    const upserts = request!.changes.filter((c) => c.type === 'entry');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ op: 'upsert', id: entry.id, record: { name: 'Plantain', versionId: edited.versionId } });
  });

  it('sends each replaced state as a version, so offline edits are not lost', async () => {
    const entry = await entries.create(banana);
    await entries.update(entry.id, { name: 'One' });
    await entries.update(entry.id, { name: 'Two' });
    await entries.update(entry.id, { name: 'Three' });

    await engine.runRound();

    const versions = api.pushes[0]!.changes.filter((c) => c.type === 'version');
    expect(versions.map((v) => (v as { record: { name: string } }).record.name)).toEqual(['Banana', 'One', 'Two']);
    expect(versions.every((v) => v.op === 'insert')).toBe(true);
  });

  it('sends a delete with its time and no record', async () => {
    const entry = await entries.create(banana);
    await entries.delete(entry.id);

    await engine.runRound();

    const change = api.pushes[0]!.changes.find((c) => c.type === 'entry')!;
    const version = await db.get('entryVersions', entry.versionId);
    expect(change).toEqual({ type: 'entry', op: 'delete', id: entry.id, deletedAt: version!.replacedAt });
  });

  it('sends a restore as its own kind of change', async () => {
    const entry = await entries.create(banana);
    await db.put('outbox', { key: `entry:${entry.id}`, op: 'restore', seq: 1 });

    await engine.runRound();

    expect(api.pushes[0]!.changes[0]).toMatchObject({ type: 'entry', op: 'restore', id: entry.id });
  });

  it('never sends restoredAt, which belongs to the server', async () => {
    const entry = await entries.create(banana);
    await db.put('entries', { ...entry, restoredAt: SERVER_NOW });
    await entries.update(entry.id, { name: 'Plantain' });

    await engine.runRound();

    expect(JSON.stringify(api.pushes[0]!.changes)).not.toContain('restoredAt');
  });

  it('never sends a photo or a device preference', async () => {
    await entries.create(banana);
    await db.put('meta', 'camera-1', 'cameraId');

    await engine.runRound();

    const sent = JSON.stringify(api.pushes[0]);
    expect(sent).not.toContain('camera');
    expect(sent).not.toContain('photo');
  });

  it('splits a large queue into pushes of 200', async () => {
    const foods = new IdbSavedFoodRepository(db);
    for (let i = 0; i < 205; i++) await foods.upsertFromEntry({ ...banana, name: `Food ${i}` });

    await engine.runRound();

    expect(api.pushes.map((p) => p.changes.length)).toEqual([200, 5]);
    expect(await pendingCount(db)).toBe(0);
  });

  it('clears what was applied or superseded', async () => {
    await entries.create(banana);
    await new IdbProteinGoalRepository(db).setGoal('2026-11-04', 150);
    api.respond = (request) => ({
      revision: 2,
      results: request.changes.map((c, i) => ({ type: c.type, id: c.id, status: i === 0 ? 'applied' : 'superseded' })),
    });

    await engine.runRound();

    expect(await pendingCount(db)).toBe(0);
  });

  it('follows pull pages and saves the cursor after each', async () => {
    api.pages = [
      { ...emptyPage, cursor: 500, hasMore: true },
      { ...emptyPage, cursor: 730, hasMore: false },
    ];

    await engine.runRound();

    expect(api.pulls).toEqual([0, 500]);
    expect(await db.get('meta', 'sync.cursor')).toBe(730);
  });

  it('starts the next round from the saved cursor', async () => {
    api.pages = [{ ...emptyPage, cursor: 12 }];
    await engine.runRound();

    await engine.runRound();

    expect(api.pulls).toEqual([0, 12]);
  });

  it('keeps totals exact through a round trip', async () => {
    const entry = await entries.create(banana);
    let sent: LogEntry | undefined;
    api.respond = (request) => {
      sent = (request.changes[0] as { record: LogEntry }).record;
      return { revision: 1, results: [{ type: 'entry', id: entry.id, status: 'applied' }] };
    };
    await engine.runRound();
    api.pages = [{ ...emptyPage, cursor: 1, changes: [{ type: 'entry', revision: 1, record: sent! }] }];

    await engine.runRound();

    expect(sumMacros([(await entries.get(entry.id))!.macros])).toEqual(sumMacros([banana.macros]));
  });

  it('a change skipped by a pull while pending still ends up matching the server', async () => {
    const entry = await entries.create(banana);
    // The first push fails, so the pull that follows in a later round finds the key pending and skips it.
    api.pushError = new ApiError('network');
    await engine.runRound();
    api.pushError = undefined;
    api.respond = (request) => ({
      revision: 3,
      results: request.changes.map((c) => ({ type: c.type, id: c.id, status: 'superseded' })),
    });
    // The server keeps a tombstone, and gives it a new revision, so the pull after the push brings it.
    api.pages = [{ ...emptyPage, cursor: 3, changes: [{ type: 'entry', revision: 3, id: entry.id, deleted: true }] }];

    await engine.runRound();

    expect(await entries.get(entry.id)).toBeUndefined();
  });

  it('runs one round at a time', async () => {
    await entries.create(banana);

    await Promise.all([engine.runRound(), engine.runRound()]);

    expect(api.pushes).toHaveLength(1);
  });
});

describe('when a round fails', () => {
  it('reports offline and keeps the queue on a network failure', async () => {
    await entries.create(banana);
    api.pushError = new ApiError('network');

    await engine.runRound();

    expect(engine.outcome()).toEqual({ kind: 'offline' });
    expect(await pendingCount(db)).toBe(1);
  });

  it('reports a failure and keeps the queue when the server is down', async () => {
    await entries.create(banana);
    api.pushError = new ApiError('service_unavailable', 503);

    await engine.runRound();

    expect(engine.outcome()).toEqual({ kind: 'failing' });
    expect(await pendingCount(db)).toBe(1);
  });

  it('passes on how long a rate limit asks it to wait', async () => {
    api.pullError = new ApiError('rate_limited', 429, undefined, 30);

    await engine.runRound();

    expect(engine.outcome()).toEqual({ kind: 'failing', retryAfterSeconds: 30 });
  });

  it('stops on an expired session and keeps the queue', async () => {
    await entries.create(banana);
    api.pushError = new ApiError('unauthenticated', 401);

    await engine.runRound();

    expect(engine.outcome()).toEqual({ kind: 'signed-out' });
    expect(api.order).toEqual(['push']);
    expect(await pendingCount(db)).toBe(1);
  });

  it('says sync is off until the notice is acknowledged', async () => {
    await entries.create(banana);
    api.pushError = new ApiError('sync_notice_required', 409);

    await engine.runRound();

    expect(engine.outcome()).toEqual({ kind: 'off' });
  });
});

describe('a change made during a push', () => {
  it('stays queued and goes in the next round', async () => {
    const entry = await entries.create(banana);
    const push = api.push;
    api.push = async (request) => {
      await entries.update(entry.id, { name: 'Edited in flight' });
      return push(request);
    };

    await engine.runRound();

    expect((await peek(db, 10)).some((i) => i.key === `entry:${entry.id}`)).toBe(true);
    api.push = push;

    await engine.runRound();

    expect(await pendingCount(db)).toBe(0);
    const last = api.pushes.at(-1)!.changes.find((c) => c.type === 'entry');
    expect(last).toMatchObject({ record: { name: 'Edited in flight' } });
  });
});

describe('merges', () => {
  it('moves a merged food to its canonical id', async () => {
    const food = await new IdbSavedFoodRepository(db).upsertFromEntry(banana);
    api.respond = () => ({ revision: 1, results: [{ type: 'food', id: food.id, status: 'merged', canonicalId: 'canonical' }] });

    await engine.runRound();

    expect(await db.get('savedFoods', food.id)).toBeUndefined();
    expect(await db.get('savedFoods', 'canonical')).toBeDefined();
    expect(await pendingCount(db)).toBe(0);
  });
});

describe('records the server would refuse', () => {
  it('are set aside before the push, and the rest goes on', async () => {
    const good = await entries.create(banana);
    const bad = await entries.create({ ...banana, name: 'Too much' });
    await db.put('entries', { ...bad, quantity: { amount: 200_000, unit: 'g' } });

    await engine.runRound();

    expect(api.pushes[0]!.changes.map((c) => c.id)).toEqual([good.id]);
    expect(await quarantineCount(db)).toBe(1);
    expect(await entries.get(bad.id)).toBeDefined();
    expect(await pendingCount(db)).toBe(0);
  });

  it('are set aside when the server refuses them after all', async () => {
    const first = await entries.create(banana);
    const second = await entries.create(banana);
    api.pushError = new ApiError('invalid_request', 400, {
      invalid: [{ index: 1, reason: 'day_key_changed' }],
    });

    await engine.runRound();
    api.pushError = undefined;
    await engine.runRound();

    expect(await db.get('quarantine', `entry:${second.id}`)).toMatchObject({ reason: 'day_key_changed' });
    expect(api.pushes.at(-1)!.changes.map((c) => c.id)).toEqual([first.id]);
  });
});

describe('isComplete', () => {
  it('is false until the first pull has finished', async () => {
    expect(await engine.isComplete()).toBe(false);

    await engine.runRound();

    expect(await engine.isComplete()).toBe(true);
  });

  it('is false while a pull has more pages to fetch', async () => {
    api.pages = [{ ...emptyPage, cursor: 500, hasMore: true }];
    api.pullError = undefined;
    const pull = api.pull;
    api.pull = async (since) => {
      if (since === 500) throw new ApiError('network');
      return pull(since);
    };

    await engine.runRound();

    expect(await engine.isComplete()).toBe(false);
  });

  it('is false while anything is queued or set aside', async () => {
    await engine.runRound();

    await entries.create(banana);
    expect(await engine.isComplete()).toBe(false);

    await engine.runRound();
    expect(await engine.isComplete()).toBe(true);

    await db.put('quarantine', { key: 'entry:x', reason: 'invalid_record', at: SERVER_NOW });
    expect(await engine.isComplete()).toBe(false);
  });

  it('remembers a finished first pull across a reload', async () => {
    await engine.runRound();

    const reloaded = createSyncEngine({ db, api, changes: createChanges(), now: () => new Date() });

    expect(await reloaded.isComplete()).toBe(true);
  });
});

describe('subscribers', () => {
  it('hear when a round starts and ends', async () => {
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    await engine.runRound();
    unsubscribe();
    await engine.runRound();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(engine.isRunning()).toBe(false);
  });
});
