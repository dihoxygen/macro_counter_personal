import type { PulledChange } from '../api/sync';
import type { ChangedType, Changes } from './changes';
import { syncTransaction, type Db, type OutboxKey, type SyncTransaction } from './db';

const VERSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = { entry: 'entry', food: 'food', goal: 'goal' } as const;

function isPending(tx: SyncTransaction, type: keyof typeof KEY_PREFIX, id: string) {
  return tx.objectStore('outbox').getKey(`${KEY_PREFIX[type]}:${id}`).then((key) => key !== undefined);
}

/**
 * Writes one pulled page in one transaction. Nothing here touches the outbox: these changes came from the server. A
 * record with a change of its own waiting is left alone, because the push goes first and the server decides (research
 * R2). Its revision can pass the cursor, so whenever that push loses, the server sends the winner again.
 */
export async function applyPulled(
  db: Db,
  pulled: readonly PulledChange[],
  cursor: number,
  serverNow: string,
  changes: Changes,
): Promise<void> {
  const tx = syncTransaction(db);
  const touched = new Set<ChangedType>();

  for (const change of pulled) {
    if ('deleted' in change) {
      if (change.type === 'entry' && !(await isPending(tx, 'entry', change.id))) {
        await tx.objectStore('entries').delete(change.id);
        touched.add('entry');
      }
    } else if (change.type === 'version') {
      await tx.objectStore('entryVersions').put(change.record);
      touched.add('version');
    } else if (!(await isPending(tx, change.type, change.record.id))) {
      if (change.type === 'entry') await tx.objectStore('entries').put(change.record);
      else if (change.type === 'food') await tx.objectStore('savedFoods').put(change.record);
      else if (await replaceGoalForDay(tx, change.record.id, change.record.effectiveFrom)) {
        await tx.objectStore('proteinGoals').put(change.record);
      } else continue;
      touched.add(change.type);
    }
  }

  await tx.objectStore('meta').put(cursor, 'sync.cursor');
  await tx.objectStore('meta').put(serverNow, 'sync.serverNow');
  await purgeExpiredVersions(tx, serverNow);
  await tx.done;
  if (touched.size > 0) changes.emit(touched);
}

/**
 * A day holds one goal, and the index enforces it. A pulled goal replaces a local one under another id, unless that
 * one is still waiting to be pushed: the push merges them first (research R4).
 */
async function replaceGoalForDay(tx: SyncTransaction, id: string, effectiveFrom: string): Promise<boolean> {
  const goals = tx.objectStore('proteinGoals');
  const local = await goals.index('effectiveFrom').get(effectiveFrom);
  if (!local || local.id === id) return true;
  if (await isPending(tx, 'goal', local.id)) return false;
  await goals.delete(local.id);
  return true;
}

/** Judged by the server's clock, so a wrong device clock cannot change what is listed (research R16). */
async function purgeExpiredVersions(tx: SyncTransaction, serverNow: string): Promise<void> {
  const cutoff = new Date(Date.parse(serverNow) - VERSION_DAYS * DAY_MS).toISOString();
  const expired = tx.objectStore('entryVersions').index('replacedAt');
  let cursor = await expired.openCursor(IDBKeyRange.upperBound(cutoff, true));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

export interface Merge {
  type: 'food' | 'goal';
  id: string;
  canonicalId: string;
}

/** The server merged records by natural key: this device moves to the canonical ids, in one transaction (research R4). */
export async function applyMerges(db: Db, merges: readonly Merge[], changes: Changes): Promise<void> {
  if (merges.length === 0) return;
  const tx = syncTransaction(db);
  const foodIds = new Map<string, string>();

  for (const { type, id, canonicalId } of merges) {
    if (type === 'food') {
      foodIds.set(id, canonicalId);
      const foods = tx.objectStore('savedFoods');
      const local = await foods.get(id);
      await foods.delete(id);
      if (local && !(await foods.get(canonicalId))) await foods.put({ ...local, id: canonicalId });
    } else {
      const goals = tx.objectStore('proteinGoals');
      const local = await goals.get(id);
      await goals.delete(id);
      if (local && !(await goals.get(canonicalId))) await goals.put({ ...local, id: canonicalId });
    }
    const key: OutboxKey = `${type}:${id}`;
    await tx.objectStore('outbox').delete(key);
  }

  if (foodIds.size > 0) {
    for (const store of ['entries', 'entryVersions'] as const) {
      const records = tx.objectStore(store);
      for (const record of await records.getAll()) {
        const canonical = record.savedFoodId === null ? undefined : foodIds.get(record.savedFoodId);
        if (canonical !== undefined) await records.put({ ...record, savedFoodId: canonical } as never);
      }
    }
  }

  await tx.done;
  changes.emit(new Set(merges.map((m) => m.type)));
}
