import type { DayKey } from '../domain/types';
import { syncTransaction, type Db } from './db';
import { keepAsVersion, laterThan } from './entryRepository';
import { newId } from './ids';
import { enqueue } from './outbox';
import { LogEntrySchema, type EntryVersion, type LogEntry } from './records';
import type { EntryVersionRepository } from './repositories';

const VERSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export class IdbEntryVersionRepository implements EntryVersionRepository {
  private readonly db: Db;
  private readonly onWrite: () => void;
  private readonly now: () => Date;

  constructor(db: Db, onWrite: () => void = () => {}, now: () => Date = () => new Date()) {
    this.db = db;
    this.onWrite = onWrite;
    this.now = now;
  }

  listAll(): Promise<EntryVersion[]> {
    return this.db.getAll('entryVersions');
  }

  /** Nothing past 90 days is listed. The server's time decides, once this device has heard it (research R16). */
  private async cutoff(): Promise<string> {
    const serverNow = (await this.db.get('meta', 'sync.serverNow')) as string | undefined;
    const reference = serverNow === undefined ? this.now().getTime() : Date.parse(serverNow);
    return new Date(reference - VERSION_DAYS * DAY_MS).toISOString();
  }

  /** Earlier states of an entry, newest first (FR-025). */
  async listForEntry(entry: Pick<LogEntry, 'id' | 'versionId'>): Promise<EntryVersion[]> {
    const cutoff = await this.cutoff();
    const versions = await this.db.getAllFromIndex('entryVersions', 'entryId', entry.id);
    return versions
      .filter((version) => version.id !== entry.versionId && version.replacedAt >= cutoff)
      .sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
  }

  /** The last state of each entry deleted from this day, and not restored since (FR-025). */
  async listDeletedForDay(dayKey: DayKey): Promise<EntryVersion[]> {
    const cutoff = await this.cutoff();
    const versions = await this.db.getAllFromIndex('entryVersions', 'dayKey', dayKey);
    const latest = new Map<string, EntryVersion>();
    for (const version of versions) {
      const seen = latest.get(version.entryId);
      if (version.changeType === 'delete' && version.replacedAt >= cutoff && (!seen || version.replacedAt > seen.replacedAt)) {
        latest.set(version.entryId, version);
      }
    }
    const live = await Promise.all([...latest.keys()].map((id) => this.db.getKey('entries', id)));
    return [...latest.values()]
      .filter((_, index) => live[index] === undefined)
      .sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
  }

  /**
   * Makes an earlier state current again under the same id, as a new change of its own (FR-026). It is queued as a
   * restore: the one change that can bring back a deleted entry (research R15).
   */
  async restore(versionId: string): Promise<LogEntry> {
    const tx = syncTransaction(this.db);
    const version = await tx.objectStore('entryVersions').get(versionId);
    if (!version) throw new Error(`version ${versionId} not found`);
    const entries = tx.objectStore('entries');
    const current = await entries.get(version.entryId);
    const updatedAt = laterThan(current?.updatedAt ?? version.replacedAt);
    if (current) await keepAsVersion(tx, current, 'restore', updatedAt);
    const restored = LogEntrySchema.parse({
      ...version,
      id: version.entryId,
      versionId: newId(),
      updatedAt,
      // Shown until the server's own time arrives. An entry never goes back to Uncategorized (FR-022).
      restoredAt: updatedAt,
      mealCategory: version.mealCategory ?? current?.mealCategory ?? null,
    });
    await entries.put(restored);
    await enqueue(tx, `entry:${restored.id}`, 'restore');
    await tx.done;
    this.onWrite();
    return restored;
  }
}
