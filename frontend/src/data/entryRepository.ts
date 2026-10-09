import type { DayKey } from '../domain/types';
import { SCHEMA_VERSION, type Db } from './db';
import { newId } from './ids';
import { LogEntrySchema, type LogEntry } from './records';
import type { EntryPatch, EntryRepository, NewEntry } from './repositories';

export class IdbEntryRepository implements EntryRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(input: NewEntry): Promise<LogEntry> {
    const now = new Date().toISOString();
    const entry = LogEntrySchema.parse({
      ...input,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    });
    await this.db.add('entries', entry);
    return entry;
  }

  get(id: string): Promise<LogEntry | undefined> {
    return this.db.get('entries', id);
  }

  async listByDay(dayKey: DayKey): Promise<LogEntry[]> {
    const entries = await this.db.getAllFromIndex('entries', 'dayKey', dayKey);
    return entries.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }

  async update(id: string, patch: EntryPatch): Promise<LogEntry> {
    const tx = this.db.transaction('entries', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) throw new Error(`entry ${id} not found`);
    const { name, quantity, macros, source } = patch;
    const updated = LogEntrySchema.parse({
      ...existing,
      ...(name !== undefined && { name }),
      ...(quantity !== undefined && { quantity }),
      ...(macros !== undefined && { macros }),
      ...(source !== undefined && { source }),
      updatedAt: laterThan(existing.updatedAt),
    });
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('entries', id);
  }
}

/** Current time, nudged forward if needed so updatedAt always increases. */
export function laterThan(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  return new Date(now > prev ? now : prev + 1).toISOString();
}
