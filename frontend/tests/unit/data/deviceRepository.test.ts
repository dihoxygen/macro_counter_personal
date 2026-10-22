import { describe, expect, it } from 'vitest';
import { DEVICE_DB_NAME, openDeviceRepository } from '../../../src/data/deviceRepository';

let n = 0;
const uniqueName = () => `device-test-${++n}-${Date.now()}`;
const alice = {
  userId: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user' as const,
};

describe('DeviceRepository', () => {
  it('uses the database macro-counter-device by default', () => {
    expect(DEVICE_DB_NAME).toBe('macro-counter-device');
  });

  it('creates a versioned "device" store', async () => {
    const name = uniqueName();
    const device = await openDeviceRepository(name, () => new Date('2026-10-14T12:00:00Z'));
    device.close();

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect([...raw.objectStoreNames]).toEqual(['device']);
    const version = await new Promise((resolve) => {
      const get = raw.transaction('device').objectStore('device').get('schemaVersion');
      get.onsuccess = () => resolve(get.result);
    });
    expect(version).toBe(1);
    raw.close();
  });

  it('has no active account at first', async () => {
    const device = await openDeviceRepository(uniqueName());
    expect(await device.getActiveAccount()).toBeUndefined();
  });

  it('remembers the active account with an ISO timestamp, and forgets it on clear', async () => {
    const device = await openDeviceRepository(uniqueName(), () => new Date('2026-10-14T12:00:00Z'));

    const saved = await device.setActiveAccount(alice);
    expect(saved).toEqual({ ...alice, updatedAt: '2026-10-14T12:00:00.000Z' });
    expect(await device.getActiveAccount()).toEqual(saved);

    await device.clearActiveAccount();
    expect(await device.getActiveAccount()).toBeUndefined();
  });

  it('survives reopening', async () => {
    const name = uniqueName();
    const first = await openDeviceRepository(name);
    await first.setActiveAccount(alice);
    await first.markLegacyAdopted();
    first.close();

    const second = await openDeviceRepository(name);
    expect((await second.getActiveAccount())?.userId).toBe(alice.userId);
    expect(await second.isLegacyAdopted()).toBe(true);
  });

  it('tracks whether pre-feature data was adopted', async () => {
    const device = await openDeviceRepository(uniqueName());
    expect(await device.isLegacyAdopted()).toBe(false);
    await device.markLegacyAdopted();
    expect(await device.isLegacyAdopted()).toBe(true);
  });

  it('rejects a user id that is not a UUID', async () => {
    const device = await openDeviceRepository(uniqueName());
    await expect(
      device.setActiveAccount({ ...alice, userId: '../macro-counter' }),
    ).rejects.toThrow();
    expect(await device.getActiveAccount()).toBeUndefined();
  });

  it('ignores a stored record that is not a valid account', async () => {
    const name = uniqueName();
    const device = await openDeviceRepository(name);
    device.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const tx = request.result.transaction('device', 'readwrite');
        tx.objectStore('device').put({ userId: 'nope' }, 'activeAccount');
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });

    const reopened = await openDeviceRepository(name);
    expect(await reopened.getActiveAccount()).toBeUndefined();
  });
});
