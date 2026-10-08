import type { DayKey } from '../domain/types';
import { SCHEMA_VERSION, type Db } from './db';
import { laterThan } from './entryRepository';
import { ProteinGoalSchema, type ProteinGoal } from './records';
import type { ProteinGoalRepository } from './repositories';

export class IdbProteinGoalRepository implements ProteinGoalRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** Records the goal from `effectiveFrom` on; a second change on the same day replaces the first. */
  async setGoal(effectiveFrom: DayKey, grams: number | null): Promise<ProteinGoal> {
    const tx = this.db.transaction('proteinGoals', 'readwrite');
    const existing = await tx.store.index('effectiveFrom').get(effectiveFrom);
    const now = new Date().toISOString();
    const goal = ProteinGoalSchema.parse({
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? laterThan(existing.updatedAt) : now,
      schemaVersion: SCHEMA_VERSION,
      effectiveFrom,
      grams,
    });
    await tx.store.put(goal);
    await tx.done;
    return goal;
  }

  /** The full history, oldest first. */
  listAll(): Promise<ProteinGoal[]> {
    return this.db.getAllFromIndex('proteinGoals', 'effectiveFrom');
  }
}
