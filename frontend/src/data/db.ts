import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { LogEntry, ProteinGoal, SavedFood } from './records';
import { runMigrations, type Migration } from './migrations';

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
