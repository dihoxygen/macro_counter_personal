import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../../src/data/db';
import { IdbDevicePreferences } from '../../../src/data/devicePreferences';

let db: Db;
let prefs: IdbDevicePreferences;
let n = 0;

beforeEach(async () => {
  db = await openDb(`prefs-test-${++n}-${Date.now()}`);
  prefs = new IdbDevicePreferences(db);
});

describe('IdbDevicePreferences', () => {
  it('has no preferred camera at first', async () => {
    expect(await prefs.getCameraId()).toBeNull();
  });

  it('remembers the last camera used', async () => {
    await prefs.setCameraId('c922');
    await prefs.setCameraId('front');
    expect(await prefs.getCameraId()).toBe('front');
  });

  it('survives reopening the database', async () => {
    await prefs.setCameraId('c922');
    expect(await new IdbDevicePreferences(db).getCameraId()).toBe('c922');
  });

  it('ignores an empty camera ID', async () => {
    await prefs.setCameraId('c922');
    await prefs.setCameraId('');
    expect(await prefs.getCameraId()).toBe('c922');
  });

  it('treats a malformed stored value as no preference', async () => {
    await db.put('meta', 42, 'preferredCameraId');
    expect(await prefs.getCameraId()).toBeNull();
  });
});
