import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { runMigrations, type Migration } from './migrations';

// Who last signed in on this browser, and whether pre-feature data was already adopted (data-model.md:
// device database). Only this module touches macro-counter-device (Principle III).

export const DEVICE_DB_NAME = 'macro-counter-device';
export const DEVICE_SCHEMA_VERSION = 1;

export const ActiveAccountSchema = z.object({
  userId: z.uuid(),
  username: z.string().min(1),
  role: z.enum(['owner', 'user']),
  updatedAt: z.iso.datetime(),
});
export type ActiveAccount = z.infer<typeof ActiveAccountSchema>;

export interface DeviceRepository {
  getActiveAccount(): Promise<ActiveAccount | undefined>;
  setActiveAccount(account: Omit<ActiveAccount, 'updatedAt'>): Promise<ActiveAccount>;
  clearActiveAccount(): Promise<void>;
  isLegacyAdopted(): Promise<boolean>;
  markLegacyAdopted(): Promise<void>;
}

interface DeviceDb extends DBSchema {
  device: { key: string; value: unknown };
}

const migrations: Migration<IDBPDatabase<DeviceDb>>[] = [
  {
    version: 1,
    up: (db) => {
      db.createObjectStore('device');
    },
  },
];

export async function openDeviceRepository(
  name: string = DEVICE_DB_NAME,
  now: () => Date = () => new Date(),
): Promise<IdbDeviceRepository> {
  const db = await openDB<DeviceDb>(name, DEVICE_SCHEMA_VERSION, {
    upgrade(database, oldVersion, newVersion, tx) {
      runMigrations(migrations, oldVersion, newVersion ?? DEVICE_SCHEMA_VERSION, database);
      void tx.objectStore('device').put(DEVICE_SCHEMA_VERSION, 'schemaVersion');
    },
  });
  return new IdbDeviceRepository(db, now);
}

export class IdbDeviceRepository implements DeviceRepository {
  private readonly db: IDBPDatabase<DeviceDb>;
  private readonly now: () => Date;

  constructor(db: IDBPDatabase<DeviceDb>, now: () => Date) {
    this.db = db;
    this.now = now;
  }

  async getActiveAccount(): Promise<ActiveAccount | undefined> {
    const parsed = ActiveAccountSchema.safeParse(await this.db.get('device', 'activeAccount'));
    return parsed.success ? parsed.data : undefined;
  }

  async setActiveAccount(account: Omit<ActiveAccount, 'updatedAt'>): Promise<ActiveAccount> {
    const record = ActiveAccountSchema.parse({ ...account, updatedAt: this.now().toISOString() });
    await this.db.put('device', record, 'activeAccount');
    return record;
  }

  async clearActiveAccount(): Promise<void> {
    await this.db.delete('device', 'activeAccount');
  }

  async isLegacyAdopted(): Promise<boolean> {
    return (await this.db.get('device', 'legacyAdopted')) === true;
  }

  async markLegacyAdopted(): Promise<void> {
    await this.db.put('device', true, 'legacyAdopted');
  }

  close(): void {
    this.db.close();
  }
}
