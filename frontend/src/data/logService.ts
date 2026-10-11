import type { LogEntry } from './records';
import type { EntryRepository, NewEntry, SavedFoodRepository } from './repositories';

/** Confirms foods into the log and remembers each one for quick re-logging (FR-014). */
export class LogService {
  private readonly entries: EntryRepository;
  private readonly savedFoods: SavedFoodRepository;

  constructor(entries: EntryRepository, savedFoods: SavedFoodRepository) {
    this.entries = entries;
    this.savedFoods = savedFoods;
  }

  async confirmEntries(entries: readonly NewEntry[]): Promise<LogEntry[]> {
    const created: LogEntry[] = [];
    for (const entry of entries) {
      created.push(await this.entries.create(entry));
      await this.savedFoods.upsertFromEntry(entry);
    }
    return created;
  }
}
