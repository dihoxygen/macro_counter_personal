import type { Db, OutboxItem, OutboxKey, OutboxOp, SyncTransaction } from './db';

// The queue of local changes waiting to reach the server (research R2). It holds keys, not snapshots: five edits
// are one push of the latest state. Writers pass their own transaction, so a change is never saved but unqueued.

/** Queues a change, replacing any earlier one for the same record. */
export async function enqueue(tx: SyncTransaction, key: OutboxKey, op: OutboxOp, deletedAt?: string): Promise<void> {
  const outbox = tx.objectStore('outbox');
  const meta = tx.objectStore('meta');
  const pending = await outbox.get(key);
  const seq = ((await meta.get('outboxSeq')) as number) + 1;
  await meta.put(seq, 'outboxSeq');
  // Editing a restored entry before it syncs must not lose the restore (research R15).
  const effectiveOp = pending?.op === 'restore' && op === 'upsert' ? 'restore' : op;
  const item: OutboxItem = { key, op: effectiveOp, seq };
  await outbox.put(deletedAt === undefined ? item : { ...item, deletedAt });
}

/** The oldest changes first. */
export function peek(db: Db, limit: number): Promise<OutboxItem[]> {
  return db.getAllFromIndex('outbox', 'seq', null, limit);
}

/** Removes what was pushed, unless it changed while the push was in flight. */
export async function ack(db: Db, items: readonly OutboxItem[]): Promise<void> {
  const tx = db.transaction('outbox', 'readwrite');
  await Promise.all(
    items.map(async (item) => {
      const current = await tx.store.get(item.key);
      if (current?.seq === item.seq) await tx.store.delete(item.key);
    }),
  );
  await tx.done;
}

/** Stops trying to sync a record the server would refuse, so it cannot block every later push (research R6). */
export async function quarantine(db: Db, key: OutboxKey, reason: string): Promise<void> {
  const tx = db.transaction(['outbox', 'quarantine'], 'readwrite');
  await tx.objectStore('outbox').delete(key);
  await tx.objectStore('quarantine').put({ key, reason, at: new Date().toISOString() });
  await tx.done;
}

export function pendingCount(db: Db): Promise<number> {
  return db.count('outbox');
}

export function quarantineCount(db: Db): Promise<number> {
  return db.count('quarantine');
}
