import { describe, expect, it } from 'vitest';
import { lockedRepositories } from '../../../src/data/lockedData';

describe('lockedRepositories', () => {
  it('refuses every data call until someone signs in', async () => {
    const locked = lockedRepositories();
    await expect(locked.entries.listByDay('2026-10-14')).rejects.toThrow(
      /locked until someone signs in/,
    );
    await expect(locked.savedFoods.listRecent()).rejects.toThrow(/locked/);
    await expect(locked.goals.listAll()).rejects.toThrow(/locked/);
    await expect(locked.devicePreferences.getCameraId()).rejects.toThrow(/locked/);
  });

  it('is not mistaken for a promise', () => {
    expect((lockedRepositories().entries as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
