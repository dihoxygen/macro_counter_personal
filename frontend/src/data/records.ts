import { z } from 'zod';
import { DayKeySchema, MacrosSchema, QuantitySchema, SourceSchema } from '../domain/types';

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

export const LogEntrySchema = z.object({
  ...RecordMeta,
  dayKey: DayKeySchema,
  loggedAt: z.string(),
  name: NameSchema,
  quantity: QuantitySchema,
  macros: MacrosSchema,
  source: SourceSchema,
  savedFoodId: z.string().nullable(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

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
