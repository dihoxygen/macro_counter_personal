import type { Db } from './db';
import type { EntryVersion } from './records';
import type { EntryVersionRepository } from './repositories';

export class IdbEntryVersionRepository implements EntryVersionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  listAll(): Promise<EntryVersion[]> {
    return this.db.getAll('entryVersions');
  }
}
