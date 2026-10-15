import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import { z } from 'zod';
import type { LogEntry, ProteinGoal, SavedFood } from './records';
import { runMigrations, type Migration } from './migrations';

/** The single-user database from before feature 003; adopted once by the owner (legacyAdoption.ts). */
export const DB_NAME = 'macro-counter';
export const SCHEMA_VERSION = 1;

export interface MacroDb extends DBSchema {
  entries: { key: string; value: LogEntry; indexes: { dayKey: string } };
  savedFoods: { key: string; value: SavedFood; indexes: { lastUsedAt: string } };
  proteinGoals: { key: string; value: ProteinGoal; indexes: { effectiveFrom: string } };
  meta: { key: string; value: unknown };
}

export type Db = IDBPDatabase<MacroDb>;

interface UpgradeCtx {
  db: Db;
  tx: IDBPTransaction<MacroDb, StoreNames<MacroDb>[], 'versionchange'>;
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
