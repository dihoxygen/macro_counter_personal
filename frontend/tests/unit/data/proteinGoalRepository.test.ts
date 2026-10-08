import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/data/db';
import { IdbProteinGoalRepository } from '../../../src/data/proteinGoalRepository';
import type { ProteinGoalRepository } from '../../../src/data/repositories';

let repo: ProteinGoalRepository;
let n = 0;

beforeEach(async () => {
  repo = new IdbProteinGoalRepository(await openDb(`goals-test-${++n}-${Date.now()}`));
});

describe('IdbProteinGoalRepository', () => {
  it('stores a goal with sync-ready metadata', async () => {
    const goal = await repo.setGoal('2026-10-08', 150);
    expect(goal).toMatchObject({ effectiveFrom: '2026-10-08', grams: 150, schemaVersion: 1 });
    expect(goal.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.listAll()).toEqual([goal]);
  });

  it('stores null to record that the goal was cleared', async () => {
    await repo.setGoal('2026-10-08', null);
    expect((await repo.listAll())[0]!.grams).toBeNull();
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s grams', async (bad) => {
    await expect(repo.setGoal('2026-10-08', bad)).rejects.toThrow();
    expect(await repo.listAll()).toEqual([]);
  });

  it('rejects a bad day key', async () => {
    await expect(repo.setGoal('2026-10-8', 150)).rejects.toThrow();
  });

  it("setting a goal twice on the same day replaces that day's record", async () => {
    const first = await repo.setGoal('2026-10-08', 150);
    const second = await repo.setGoal('2026-10-08', 160);
    expect(second.id).toBe(first.id);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(await repo.listAll()).toEqual([second]);
  });

  it('listAll returns the full history', async () => {
    await repo.setGoal('2026-10-01', 120);
    await repo.setGoal('2026-10-08', 150);
    expect((await repo.listAll()).map((g) => [g.effectiveFrom, g.grams])).toEqual([
      ['2026-10-01', 120],
      ['2026-10-08', 150],
    ]);
  });
});
