import type { DayKey, MealCategory } from '../domain/types';
import type { EntryVersion, LogEntry, ProteinGoal, SavedFood } from './records';

// UI and domain code use these interfaces only; never IndexedDB directly (Principle III).

/** Every new entry has a meal (FR-020); only entries from before categories existed have none. */
export type NewEntry = Pick<
  LogEntry,
  'dayKey' | 'loggedAt' | 'name' | 'quantity' | 'macros' | 'source' | 'savedFoodId'
> & { mealCategory: MealCategory };

/** dayKey is fixed at creation and can never be changed (travel edge case). */
export type EntryPatch = Partial<Pick<LogEntry, 'name' | 'quantity' | 'macros' | 'source'>> & {
  /** Never null: an entry cannot go back to Uncategorized (FR-022). */
  mealCategory?: MealCategory;
};

export interface EntryRepository {
  create(entry: NewEntry): Promise<LogEntry>;
  get(id: string): Promise<LogEntry | undefined>;
  listByDay(dayKey: DayKey): Promise<LogEntry[]>;
  listAll(): Promise<LogEntry[]>;
  update(id: string, patch: EntryPatch): Promise<LogEntry>;
  delete(id: string): Promise<void>;
}

export interface SavedFoodRepository {
  /** Saves a confirmed food, matching an existing one by normalized name and unit (data-model.md). */
  upsertFromEntry(entry: NewEntry): Promise<SavedFood>;
  get(id: string): Promise<SavedFood | undefined>;
  listAll(): Promise<SavedFood[]>;
  /** Most recently used first. */
  listRecent(limit?: number): Promise<SavedFood[]>;
}

export interface EntryVersionRepository {
  listAll(): Promise<EntryVersion[]>;
}

export interface ProteinGoalRepository {
  /** grams must be finite and > 0, or null to clear the goal from that day on. */
  setGoal(effectiveFrom: DayKey, grams: number | null): Promise<ProteinGoal>;
  listAll(): Promise<ProteinGoal[]>;
}

/**
 * Settings that only make sense on this device (feature 002). They are never synced or exported:
 * a camera ID, for example, means nothing on another device.
 */
export interface DevicePreferences {
  /** The camera last used for a snapshot, or null if none is remembered. */
  getCameraId(): Promise<string | null>;
  /** Ignores an empty ID (some browsers report none before permission). */
  setCameraId(id: string): Promise<void>;
}
