import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { z } from 'zod';
import { newId } from './ids';
import type { EntryVersion, LogEntry, ProteinGoal, SavedFood } from './records';
import { runMigrations, type Migration } from './migrations';

/** The single-user database from before feature 003; adopted once by the owner (legacyAdoption.ts). */
export const DB_NAME = 'macro-counter';
export const SCHEMA_VERSION = 2;

/** The shape of a record on the wire, separate from the database's own version (data-model.md). */
export const RECORD_SCHEMA_VERSION = 1;

export type OutboxKey = `entry:${string}` | `food:${string}` | `goal:${string}` | `version:${string}`;
export type OutboxOp = 'upsert' | 'restore' | 'delete' | 'insert';

/** A local change waiting to reach the server. `deletedAt` is set on a delete, whose record is already gone. */
export interface OutboxItem {
  key: OutboxKey;
  op: OutboxOp;
  seq: number;
  deletedAt?: string;
}

/** A change the server would refuse. Its record stays in its own store, on this device (research R6). */
export interface QuarantineItem {
  key: OutboxKey;
  reason: string;
  at: string;
}

export interface MacroDb extends DBSchema {
  entries: { key: string; value: LogEntry; indexes: { dayKey: string } };
  savedFoods: { key: string; value: SavedFood; indexes: { lastUsedAt: string } };
  proteinGoals: { key: string; value: ProteinGoal; indexes: { effectiveFrom: string } };
  entryVersions: {
    key: string;
    value: EntryVersion;
    indexes: { entryId: string; dayKey: string; replacedAt: string };
  };
  outbox: { key: string; value: OutboxItem; indexes: { seq: number } };
  quarantine: { key: string; value: QuarantineItem };
  meta: { key: string; value: unknown };
}

export type Db = IDBPDatabase<MacroDb>;

const SYNC_STORES: StoreNames<MacroDb>[] = [
  'entries',
  'savedFoods',
  'proteinGoals',
  'entryVersions',
  'outbox',
  'quarantine',
  'meta',
];

export type SyncTransaction = IDBPTransaction<MacroDb, StoreNames<MacroDb>[], 'readwrite'>;

/** One transaction over a record and its outbox item, so a crash cannot leave a change saved but unqueued (research R2). */
export function syncTransaction(db: Db): SyncTransaction {
  return db.transaction(SYNC_STORES, 'readwrite');
}

interface UpgradeCtx {
  db: Db;
  tx: IDBPTransaction<MacroDb, StoreNames<MacroDb>[], 'versionchange'>;
}

/**
 * Existing records for the first sync (research R6): entries gain their new fields and a link to their saved food
 * (research R18), and everything is queued. Foods come first, so the server has seen them by the time entries link
 * to them. Nothing about an entry's content or times changes.
 */
async function prepareForFirstSync(tx: UpgradeCtx['tx']): Promise<void> {
  const entries = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  const foods = await tx.objectStore('savedFoods').getAll();
  const goals = await tx.objectStore('proteinGoals').getAll();
  const normalize = (name: string) => name.trim().toLowerCase();
  const foodIds = new Map(foods.map((f) => [`${normalize(f.name)}|${f.referenceQuantity.unit}`, f.id]));

  let seq = 0;
  const queue = (key: OutboxKey) => outbox.put({ key, op: 'upsert', seq: ++seq });
  for (const food of foods) await queue(`food:${food.id}`);
  for (const goal of goals) await queue(`goal:${goal.id}`);
  for (const entry of await entries.getAll()) {
    const savedFoodId = entry.savedFoodId ?? foodIds.get(`${normalize(entry.name)}|${entry.quantity.unit}`) ?? null;
    await entries.put({ ...entry, savedFoodId, versionId: newId(), mealCategory: null });
    await queue(`entry:${entry.id}`);
  }
  await tx.objectStore('meta').put(seq, 'outboxSeq');
  await tx.objectStore('meta').put(0, 'sync.cursor');
}

const migrations: Migration<UpgradeCtx>[] = [
  {
    version: 1,
    up: ({ db }) => {
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('dayKey', 'dayKey');
      db.createObjectStore('savedFoods', { keyPath: 'id' }).createIndex('lastUsedAt', 'lastUsedAt');
      db.createObjectStore('proteinGoals', { keyPath: 'id' }).createIndex(
        'effectiveFrom',
        'effectiveFrom',
        { unique: true },
      );
      db.createObjectStore('meta');
    },
  },
  {
    version: 2,
    up: ({ db, tx }) => {
      const versions = db.createObjectStore('entryVersions', { keyPath: 'id' });
      versions.createIndex('entryId', 'entryId');
      versions.createIndex('dayKey', 'dayKey');
      versions.createIndex('replacedAt', 'replacedAt');
      db.createObjectStore('outbox', { keyPath: 'key' }).createIndex('seq', 'seq');
      db.createObjectStore('quarantine', { keyPath: 'key' });
      // A failed migration must leave the old data as it was, not half converted.
      void prepareForFirstSync(tx).catch(() => tx.abort());
    },
  },
];

export function openDb(name: string = DB_NAME): Promise<Db> {
  return openDB<MacroDb>(name, SCHEMA_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations(migrations, oldVersion, newVersion ?? SCHEMA_VERSION, { db, tx });
      void tx.objectStore('meta').put(SCHEMA_VERSION, 'schemaVersion');
    },
  });
}

/** Each account's food data lives in its own database, named by the account's id (FR-016, R9). */
export function userDbName(userId: string): string {
  return `${DB_NAME}.u.${z.uuid().parse(userId)}`;
}

export function openUserDb(userId: string): Promise<Db> {
  return openDb(userDbName(userId));
}
