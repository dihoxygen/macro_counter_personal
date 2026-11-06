import type { DayKey } from '../domain/types';
import { RECORD_SCHEMA_VERSION, syncTransaction, type Db, type SyncTransaction } from './db';
import { newId } from './ids';
import { enqueue } from './outbox';
import { EntryVersionSchema, LogEntrySchema, type ChangeType, type LogEntry } from './records';
import type { EntryPatch, EntryRepository, NewEntry } from './repositories';

export class IdbEntryRepository implements EntryRepository {
  private readonly db: Db;
  private readonly onWrite: () => void;

  /** `onWrite` runs after a change is saved, so sync can pick it up (research R5). */
  constructor(db: Db, onWrite: () => void = () => {}) {
    this.db = db;
    this.onWrite = onWrite;
  }

  async create(input: NewEntry): Promise<LogEntry> {
    const now = new Date().toISOString();
    const entry = LogEntrySchema.parse({
      ...input,
      id: newId(),
      versionId: newId(),
      createdAt: now,
      updatedAt: now,
      schemaVersion: RECORD_SCHEMA_VERSION,
    });
    const tx = syncTransaction(this.db);
    await tx.objectStore('entries').add(entry);
    await enqueue(tx, `entry:${entry.id}`, 'upsert');
    await tx.done;
    this.onWrite();
    return entry;
  }

  get(id: string): Promise<LogEntry | undefined> {
    return this.db.get('entries', id);
  }

  async listByDay(dayKey: DayKey): Promise<LogEntry[]> {
    const entries = await this.db.getAllFromIndex('entries', 'dayKey', dayKey);
    return entries.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }

  listAll(): Promise<LogEntry[]> {
    return this.db.getAll('entries');
  }

  listByDayRange(from: DayKey, to: DayKey): Promise<LogEntry[]> {
    return this.db.getAllFromIndex('entries', 'dayKey', IDBKeyRange.bound(from, to));
  }

  async update(id: string, patch: EntryPatch): Promise<LogEntry> {
    const tx = syncTransaction(this.db);
    const existing = await tx.objectStore('entries').get(id);
    if (!existing) throw new Error(`entry ${id} not found`);
    const { name, quantity, macros, source, mealCategory } = patch;
    const changed = {
      ...existing,
      ...(name !== undefined && { name }),
      ...(quantity !== undefined && { quantity }),
      ...(macros !== undefined && { macros }),
      ...(source !== undefined && { source }),
      ...(mealCategory !== undefined && { mealCategory }),
    };
    // History holds real changes only (research R14).
    if (JSON.stringify(changed) === JSON.stringify(existing)) {
      await tx.done;
      return existing;
    }
    const updatedAt = laterThan(existing.updatedAt);
    const updated = LogEntrySchema.parse({ ...changed, versionId: newId(), updatedAt });
    await keepAsVersion(tx, existing, 'edit', updatedAt);
    await tx.objectStore('entries').put(updated);
    await enqueue(tx, `entry:${id}`, 'upsert');
    await tx.done;
    this.onWrite();
    return updated;
  }

  async delete(id: string): Promise<void> {
    const tx = syncTransaction(this.db);
    const existing = await tx.objectStore('entries').get(id);
    if (!existing) {
      await tx.done;
      return;
    }
    const deletedAt = laterThan(existing.updatedAt);
    await keepAsVersion(tx, existing, 'delete', deletedAt);
    await tx.objectStore('entries').delete(id);
    await enqueue(tx, `entry:${id}`, 'delete', deletedAt);
    await tx.done;
    this.onWrite();
  }
}

/** Keeps a state that is being replaced. Offline, this is the only copy of it anywhere (research R14). */
export async function keepAsVersion(
  tx: SyncTransaction,
  entry: LogEntry,
  changeType: ChangeType,
  replacedAt: string,
): Promise<void> {
  const { versionId, id, ...fields } = entry;
  const version = EntryVersionSchema.parse({ ...fields, id: versionId, entryId: id, changeType, replacedAt });
  await tx.objectStore('entryVersions').put(version);
  await enqueue(tx, `version:${versionId}`, 'insert');
}

/** Current time, nudged forward if needed so updatedAt always increases. */
export function laterThan(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  return new Date(now > prev ? now : prev + 1).toISOString();
}
