import { SCHEMA_VERSION, type Db } from './db';
import { laterThan } from './entryRepository';
import { SavedFoodSchema, type SavedFood } from './records';
import type { NewEntry, SavedFoodRepository } from './repositories';

const normalize = (name: string) => name.trim().toLowerCase();

export class IdbSavedFoodRepository implements SavedFoodRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async upsertFromEntry(entry: NewEntry): Promise<SavedFood> {
    const tx = this.db.transaction('savedFoods', 'readwrite');
    const all = await tx.store.getAll();
    const key = normalize(entry.name);
    const existing = all.find((f) => normalize(f.name) === key && f.referenceQuantity.unit === entry.quantity.unit);
    const now = new Date().toISOString();
    const food = SavedFoodSchema.parse({
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? laterThan(existing.updatedAt) : now,
      schemaVersion: SCHEMA_VERSION,
      name: existing?.name ?? entry.name.trim(),
      referenceQuantity: entry.quantity,
      macros: entry.macros,
      source: entry.source,
      lastUsedAt: entry.loggedAt,
    });
    await tx.store.put(food);
    await tx.done;
    return food;
  }

  get(id: string): Promise<SavedFood | undefined> {
    return this.db.get('savedFoods', id);
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
