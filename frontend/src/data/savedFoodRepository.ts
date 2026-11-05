import { RECORD_SCHEMA_VERSION, syncTransaction, type Db } from './db';
import { newId } from './ids';
import { laterThan } from './entryRepository';
import { enqueue } from './outbox';
import { SavedFoodSchema, type SavedFood } from './records';
import type { NewEntry, SavedFoodRepository } from './repositories';

const normalize = (name: string) => name.trim().toLowerCase();

export class IdbSavedFoodRepository implements SavedFoodRepository {
  private readonly db: Db;
  private readonly onWrite: () => void;

  constructor(db: Db, onWrite: () => void = () => {}) {
    this.db = db;
    this.onWrite = onWrite;
  }

  async upsertFromEntry(entry: NewEntry): Promise<SavedFood> {
    const tx = syncTransaction(this.db);
    const store = tx.objectStore('savedFoods');
    const all = await store.getAll();
    const key = normalize(entry.name);
    const existing = all.find((f) => normalize(f.name) === key && f.referenceQuantity.unit === entry.quantity.unit);
    const now = new Date().toISOString();
    const food = SavedFoodSchema.parse({
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? laterThan(existing.updatedAt) : now,
      schemaVersion: RECORD_SCHEMA_VERSION,
      name: existing?.name ?? entry.name.trim(),
      referenceQuantity: entry.quantity,
      macros: entry.macros,
      source: entry.source,
      lastUsedAt: entry.loggedAt,
    });
    await store.put(food);
    await enqueue(tx, `food:${food.id}`, 'upsert');
    await tx.done;
    this.onWrite();
    return food;
  }

  get(id: string): Promise<SavedFood | undefined> {
    return this.db.get('savedFoods', id);
  }

  listAll(): Promise<SavedFood[]> {
    return this.db.getAll('savedFoods');
  }

  async listRecent(limit = 20): Promise<SavedFood[]> {
    const foods: SavedFood[] = [];
    let cursor = await this.db.transaction('savedFoods').store.index('lastUsedAt').openCursor(null, 'prev');
    while (cursor && foods.length < limit) {
      foods.push(cursor.value);
      cursor = await cursor.continue();
    }
    return foods;
  }
}
