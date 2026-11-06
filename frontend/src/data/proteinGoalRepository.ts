import type { DayKey } from '../domain/types';
import { RECORD_SCHEMA_VERSION, syncTransaction, type Db } from './db';
import { newId } from './ids';
import { laterThan } from './entryRepository';
import { enqueue } from './outbox';
import { ProteinGoalSchema, type ProteinGoal } from './records';
import type { ProteinGoalRepository } from './repositories';

export class IdbProteinGoalRepository implements ProteinGoalRepository {
  private readonly db: Db;
  private readonly onWrite: () => void;

  constructor(db: Db, onWrite: () => void = () => {}) {
    this.db = db;
    this.onWrite = onWrite;
  }

  /** Records the goal from `effectiveFrom` on; a second change on the same day replaces the first. */
  async setGoal(effectiveFrom: DayKey, grams: number | null): Promise<ProteinGoal> {
    const tx = syncTransaction(this.db);
    const store = tx.objectStore('proteinGoals');
    const existing = await store.index('effectiveFrom').get(effectiveFrom);
    const now = new Date().toISOString();
    const goal = ProteinGoalSchema.parse({
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? laterThan(existing.updatedAt) : now,
      schemaVersion: RECORD_SCHEMA_VERSION,
      effectiveFrom,
      grams,
    });
    await store.put(goal);
    await enqueue(tx, `goal:${goal.id}`, 'upsert');
    await tx.done;
    this.onWrite();
    return goal;
  }

  /** The full history, oldest first. */
  listAll(): Promise<ProteinGoal[]> {
    return this.db.getAllFromIndex('proteinGoals', 'effectiveFrom');
  }
}
