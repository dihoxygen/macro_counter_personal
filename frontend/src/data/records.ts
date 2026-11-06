import { z } from 'zod';
import { DayKeySchema, MacrosSchema, MealCategorySchema, QuantitySchema, SourceSchema } from '../domain/types';

// Persisted record shapes (data-model.md). Every record carries sync-ready metadata (Principle III).
const RecordMeta = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.number().int(),
};

export const NameSchema = z
  .string()
  .max(120)
  .refine((s) => s.trim().length > 0, 'Name is required');

const EntryFields = {
  dayKey: DayKeySchema,
  loggedAt: z.string(),
  name: NameSchema,
  quantity: QuantitySchema,
  macros: MacrosSchema,
  source: SourceSchema,
  savedFoodId: z.string().nullable(),
  /** Null is "Uncategorized": entries from before categories existed (FR-022). */
  mealCategory: MealCategorySchema.nullable(),
  /** Set by the server, and only ever read here: a device never sends it (research R15). */
  restoredAt: z.string().nullable().optional(),
};

export const LogEntrySchema = z.object({
  ...RecordMeta,
  /** Identifies this saved state of the entry; every change gets a new one (research R14). */
  versionId: z.string().min(1),
  ...EntryFields,
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const ChangeTypeSchema = z.enum(['edit', 'delete', 'restore']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

/** A replaced state of an entry, kept for 90 days. `id` is that state's versionId (research R14). */
export const EntryVersionSchema = z.object({
  ...RecordMeta,
  entryId: z.string().min(1),
  changeType: ChangeTypeSchema,
  replacedAt: z.string(),
  ...EntryFields,
});
export type EntryVersion = z.infer<typeof EntryVersionSchema>;

export const SavedFoodSchema = z.object({
  ...RecordMeta,
  name: NameSchema,
  referenceQuantity: QuantitySchema,
  macros: MacrosSchema,
  source: SourceSchema,
  lastUsedAt: z.string(),
});
export type SavedFood = z.infer<typeof SavedFoodSchema>;

export const ProteinGoalSchema = z.object({
  ...RecordMeta,
  effectiveFrom: DayKeySchema,
  grams: z.number().gt(0).nullable(),
});
export type ProteinGoal = z.infer<typeof ProteinGoalSchema>;
