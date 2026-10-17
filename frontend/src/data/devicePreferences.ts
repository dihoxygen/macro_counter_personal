import type { Db } from './db';
import type { DevicePreferences } from './repositories';

const CAMERA_KEY = 'preferredCameraId';

/** Device-local settings kept in the `meta` store (no schema change: it is a plain key/value store). */
export class IdbDevicePreferences implements DevicePreferences {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getCameraId(): Promise<string | null> {
    const value = await this.db.get('meta', CAMERA_KEY);
    return typeof value === 'string' && value !== '' ? value : null;
  }

  async setCameraId(id: string): Promise<void> {
    if (id === '') return;
    await this.db.put('meta', id, CAMERA_KEY);
  }
}
