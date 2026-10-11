import type { DayKey } from '../domain/types';
import type { LogEntry, ProteinGoal, SavedFood } from './records';

// UI and domain code use these interfaces only; never IndexedDB directly (Principle III).

export type NewEntry = Pick<
  LogEntry,
  'dayKey' | 'loggedAt' | 'name' | 'quantity' | 'macros' | 'source' | 'savedFoodId'
>;

/** dayKey is fixed at creation and can never be changed (travel edge case). */
export type EntryPatch = Partial<Pick<LogEntry, 'name' | 'quantity' | 'macros' | 'source'>>;

export interface EntryRepository {
  create(entry: NewEntry): Promise<LogEntry>;
  get(id: string): Promise<LogEntry | undefined>;
  listByDay(dayKey: DayKey): Promise<LogEntry[]>;
  update(id: string, patch: EntryPatch): Promise<LogEntry>;
  delete(id: string): Promise<void>;
}

export interface SavedFoodRepository {
  /** Saves a confirmed food, matching an existing one by normalized name and unit (data-model.md). */
  upsertFromEntry(entry: NewEntry): Promise<SavedFood>;
  get(id: string): Promise<SavedFood | undefined>;
  /** Most recently used first. */
  listRecent(limit?: number): Promise<SavedFood[]>;
}

export interface ProteinGoalRepository {
  /** grams must be finite and > 0, or null to clear the goal from that day on. */
  setGoal(effectiveFrom: DayKey, grams: number | null): Promise<ProteinGoal>;
  listAll(): Promise<ProteinGoal[]>;
}
