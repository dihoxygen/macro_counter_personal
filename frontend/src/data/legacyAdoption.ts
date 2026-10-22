import type { SessionUser } from '../api/auth';
import type { Db } from './db';
import type { DeviceRepository } from './deviceRepository';

// FR-018: the food data saved before feature 003 (one database, no accounts) belongs to the owner. It is
// copied into the owner's own database once, checked, and only then removed. Nobody else ever gets it.

const stores = ['entries', 'savedFoods', 'proteinGoals'] as const;
type Store = (typeof stores)[number];

export type AdoptionResult = 'not-owner' | 'already-done' | 'nothing-to-adopt' | 'adopted';

export interface AdoptionDeps {
  device: DeviceRepository;
  legacyExists: () => Promise<boolean>;
  openLegacy: () => Promise<Db>;
  openTarget: () => Promise<Db>;
  deleteLegacy: () => Promise<void>;
  /** Replaceable in tests to simulate a lossy copy. */
  copyStore?: (from: Db, to: Db, store: Store) => Promise<void>;
}

export async function adoptLegacyData(
  user: SessionUser,
  deps: AdoptionDeps,
): Promise<AdoptionResult> {
  if (user.role !== 'owner') return 'not-owner';
  if (await deps.device.isLegacyAdopted()) return 'already-done';
  if (!(await deps.legacyExists())) {
    await deps.device.markLegacyAdopted();
    return 'nothing-to-adopt';
  }

  const copy = deps.copyStore ?? copyStore;
  const legacy = await deps.openLegacy();
  const target = await deps.openTarget();
  try {
    for (const store of stores) {
      await copy(legacy, target, store);
    }
    for (const store of stores) {
      const [before, after] = await Promise.all([legacy.count(store), target.count(store)]);
      if (after < before) {
        throw new Error(
          `Adoption of ${store} came up short: ${after} copied, fewer than the ${before} saved before.`,
        );
      }
    }
  } finally {
    legacy.close();
    target.close();
  }

  await deps.deleteLegacy();
  await deps.device.markLegacyAdopted();
  return 'adopted';
}

/** Copies every record of one store in a single read-write transaction, ids and timestamps unchanged. */
async function copyStore(from: Db, to: Db, store: Store): Promise<void> {
  const records = await from.getAll(store);
  const tx = to.transaction(store, 'readwrite');
  await Promise.all([...records.map((record) => tx.store.put(record)), tx.done]);
}

/** Whether a database with this name exists in this browser (without creating it). */
export async function databaseExists(name: string): Promise<boolean> {
  const databases = await indexedDB.databases();
  return databases.some((db) => db.name === name);
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}`));
    // A still-open connection elsewhere (another tab) delays deletion; it completes when that tab closes.
    request.onblocked = () => resolve();
  });
}
