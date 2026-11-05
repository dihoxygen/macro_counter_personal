import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, syncTransaction, type Db } from '../../../src/data/db';
import { ack, enqueue, peek, pendingCount, quarantine, quarantineCount } from '../../../src/data/outbox';

let db: Db;
let n = 0;

beforeEach(async () => {
  db = await openDb(`outbox-test-${++n}-${Date.now()}`);
});

async function put(key: `entry:${string}`, op: 'upsert' | 'restore' | 'delete', deletedAt?: string) {
  const tx = syncTransaction(db);
  await enqueue(tx, key, op, deletedAt);
  await tx.done;
}

describe('enqueue', () => {
  it('gives each change a higher seq', async () => {
    await put('entry:a', 'upsert');
    await put('entry:b', 'upsert');

    expect((await peek(db, 10)).map((i) => [i.key, i.seq])).toEqual([
      ['entry:a', 1],
      ['entry:b', 2],
    ]);
  });

  it('replaces a key, so five edits are one change', async () => {
    await put('entry:a', 'upsert');
    await put('entry:b', 'upsert');
    await put('entry:a', 'upsert');

    expect((await peek(db, 10)).map((i) => [i.key, i.seq])).toEqual([
      ['entry:b', 2],
      ['entry:a', 3],
    ]);
  });

  it('keeps a pending restore when the restored entry is edited', async () => {
    await put('entry:a', 'restore');
    await put('entry:a', 'upsert');

    expect((await peek(db, 10))[0]!.op).toBe('restore');
  });

  it('lets a delete replace a pending restore', async () => {
    await put('entry:a', 'restore');
    await put('entry:a', 'delete', '2026-11-04T08:00:00.000Z');

    expect((await peek(db, 10))[0]).toMatchObject({ op: 'delete', deletedAt: '2026-11-04T08:00:00.000Z' });
  });

  it('drops the delete time when the entry comes back', async () => {
    await put('entry:a', 'delete', '2026-11-04T08:00:00.000Z');
    await put('entry:a', 'restore');

    expect((await peek(db, 10))[0]).not.toHaveProperty('deletedAt');
  });

  it('writes nothing if the transaction aborts', async () => {
    const tx = syncTransaction(db);
    await enqueue(tx, 'entry:a', 'upsert');
    tx.abort();
    await tx.done.catch(() => {});

    expect(await pendingCount(db)).toBe(0);
  });
});

describe('peek', () => {
  it('returns the oldest changes first, up to the limit', async () => {
    await put('entry:a', 'upsert');
    await put('entry:b', 'upsert');
    await put('entry:c', 'upsert');

    expect((await peek(db, 2)).map((i) => i.key)).toEqual(['entry:a', 'entry:b']);
  });
});

describe('ack', () => {
  it('removes what was pushed', async () => {
    await put('entry:a', 'upsert');

    await ack(db, await peek(db, 10));

    expect(await pendingCount(db)).toBe(0);
  });

  it('keeps a change made while the push was in flight', async () => {
    await put('entry:a', 'upsert');
    const sent = await peek(db, 10);

    await put('entry:a', 'upsert');
    await ack(db, sent);

    expect(await pendingCount(db)).toBe(1);
  });
});

describe('quarantine', () => {
  it('moves a change out of the outbox with its reason', async () => {
    await put('entry:a', 'upsert');

    await quarantine(db, 'entry:a', 'invalid_record');

    expect(await pendingCount(db)).toBe(0);
    expect(await quarantineCount(db)).toBe(1);
    expect(await db.get('quarantine', 'entry:a')).toMatchObject({ key: 'entry:a', reason: 'invalid_record' });
  });
});
