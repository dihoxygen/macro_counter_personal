import { describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../../src/data/db';
import { openDeviceRepository } from '../../../src/data/deviceRepository';
import { adoptLegacyData, type AdoptionDeps } from '../../../src/data/legacyAdoption';
import type { LogEntry, ProteinGoal, SavedFood } from '../../../src/data/records';

let n = 0;
const owner = {
  id: '6f1c2a4e-0000-4000-8000-0000000000aa',
  username: 'sam',
  role: 'owner' as const,
};
const friend = {
  id: '6f1c2a4e-0000-4000-8000-0000000000bb',
  username: 'kim',
  role: 'user' as const,
};
const meta = (id: string) => ({
  id,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-02-03T04:05:06.000Z',
  schemaVersion: 1,
});
const macros = { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 };

function entry(i: number): LogEntry {
  return {
    ...meta(`entry-${i}`),
    dayKey: '2026-01-02',
    loggedAt: `2026-01-02T0${i}:00:00.000Z`,
    name: `Food ${i}`,
    quantity: { amount: 100, unit: 'g' },
    macros,
    source: 'manual',
    savedFoodId: null,
  };
}

function food(i: number): SavedFood {
  return {
    ...meta(`food-${i}`),
    name: `Food ${i}`,
    referenceQuantity: { amount: 100, unit: 'g' },
    macros,
    source: 'manual',
    lastUsedAt: '2026-01-02T00:00:00.000Z',
  };
}

const goal: ProteinGoal = { ...meta('goal-1'), effectiveFrom: '2026-01-01', grams: 140 };

/** A world with an optional pre-feature database, a device repository and an empty target. */
async function world(withLegacy = true) {
  const id = ++n;
  const legacyName = `legacy-${id}`;
  const targetName = `target-${id}`;
  if (withLegacy) {
    const legacy = await openDb(legacyName);
    for (const e of [entry(1), entry(2), entry(3)]) await legacy.put('entries', e);
    for (const f of [food(1), food(2)]) await legacy.put('savedFoods', f);
    await legacy.put('proteinGoals', goal);
    legacy.close();
  }
  const device = await openDeviceRepository(`device-${id}`);
  let legacyDeleted = false;
  const deps: AdoptionDeps = {
    device,
    legacyExists: async () => withLegacy && !legacyDeleted,
    openLegacy: () => openDb(legacyName),
    openTarget: () => openDb(targetName),
    deleteLegacy: vi.fn(async () => {
      legacyDeleted = true;
    }),
  };
  return { deps, device, targetName, isDeleted: () => legacyDeleted };
}

async function contents(db: Db) {
  return {
    entries: await db.getAll('entries'),
    savedFoods: await db.getAll('savedFoods'),
    proteinGoals: await db.getAll('proteinGoals'),
  };
}

describe('adoptLegacyData (FR-018: owner only, once, without loss)', () => {
  it('never adopts for a regular user', async () => {
    const { deps, device, targetName } = await world();

    expect(await adoptLegacyData(friend, deps)).toBe('not-owner');

    expect(deps.deleteLegacy).not.toHaveBeenCalled();
    expect(await device.isLegacyAdopted()).toBe(false);
    const target = await openDb(targetName);
    expect((await contents(target)).entries).toHaveLength(0);
    target.close();
  });

  it('copies every record unchanged for the owner, then deletes the legacy data and remembers it', async () => {
    const { deps, device, targetName } = await world();

    expect(await adoptLegacyData(owner, deps)).toBe('adopted');

    const target = await openDb(targetName);
    const copied = await contents(target);
    target.close();
    expect(copied.entries.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      entry(1),
      entry(2),
      entry(3),
    ]);
    expect(copied.savedFoods.sort((a, b) => a.id.localeCompare(b.id))).toEqual([food(1), food(2)]);
    expect(copied.proteinGoals).toEqual([goal]);
    expect(deps.deleteLegacy).toHaveBeenCalledTimes(1);
    expect(await device.isLegacyAdopted()).toBe(true);
  });

  it('does nothing the second time', async () => {
    const { deps } = await world();
    await adoptLegacyData(owner, deps);

    expect(await adoptLegacyData(owner, deps)).toBe('already-done');
    expect(deps.deleteLegacy).toHaveBeenCalledTimes(1);
  });

  it('with no legacy data, just remembers that there is nothing to adopt', async () => {
    const { deps, device } = await world(false);

    expect(await adoptLegacyData(owner, deps)).toBe('nothing-to-adopt');

    expect(deps.deleteLegacy).not.toHaveBeenCalled();
    expect(await device.isLegacyAdopted()).toBe(true);
  });

  it('keeps the legacy data when copying fails', async () => {
    const { deps, device } = await world();
    const failing: AdoptionDeps = {
      ...deps,
      openTarget: async () => {
        const db = await deps.openTarget();
        db.close(); // every write now fails
        return db;
      },
    };

    await expect(adoptLegacyData(owner, failing)).rejects.toThrow();

    expect(deps.deleteLegacy).not.toHaveBeenCalled();
    expect(await device.isLegacyAdopted()).toBe(false);
  });

  it('keeps the legacy data when the copy comes up short', async () => {
    const { deps, device } = await world();
    const lossy: AdoptionDeps = { ...deps, copyStore: async () => undefined }; // copies nothing

    await expect(adoptLegacyData(owner, lossy)).rejects.toThrow(/fewer/);

    expect(deps.deleteLegacy).not.toHaveBeenCalled();
    expect(await device.isLegacyAdopted()).toBe(false);
  });
});
