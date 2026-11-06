import { z } from 'zod';
import { MealCategorySchema, UnitSchema, SourceSchema } from '../domain/types';
import { ChangeTypeSchema } from './records';

// The server's validation bounds (data-model.md), checked before a push. Pushes are all or nothing, so one record the
// server would refuse must be set aside here, or it would block every later change (research R6).

const KNOWN_SCHEMA_VERSION = 1;

const Timestamp = z.string().refine(
  (s) => /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  'ISO 8601 with an offset',
);

const CalendarDate = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(s);
}, 'a real calendar date');

const Name = z.string().max(120).refine((s) => s.trim().length > 0);

const Quantity = z.strictObject({ amount: z.number().min(0).max(100_000), unit: UnitSchema });

const Macros = z.strictObject({
  kcal: z.number().min(0).max(100_000),
  proteinG: z.number().min(0).max(10_000),
  carbsG: z.number().min(0).max(10_000),
  fatG: z.number().min(0).max(10_000),
});

const Meta = {
  id: z.uuid(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  schemaVersion: z.literal(KNOWN_SCHEMA_VERSION),
};

const EntryFields = {
  dayKey: CalendarDate,
  loggedAt: Timestamp,
  name: Name,
  quantity: Quantity,
  macros: Macros,
  source: SourceSchema,
  savedFoodId: z.uuid().nullable(),
  mealCategory: MealCategorySchema.nullable(),
};

const schemas = {
  entry: z.strictObject({ ...Meta, versionId: z.uuid(), ...EntryFields }),
  version: z.strictObject({
    ...Meta,
    entryId: z.uuid(),
    changeType: ChangeTypeSchema,
    replacedAt: Timestamp,
    ...EntryFields,
  }),
  food: z.strictObject({
    ...Meta,
    name: Name,
    referenceQuantity: Quantity,
    macros: Macros,
    source: SourceSchema,
    lastUsedAt: Timestamp,
  }),
  goal: z.strictObject({
    ...Meta,
    effectiveFrom: CalendarDate,
    grams: z.number().gt(0).max(10_000).nullable(),
  }),
};

export type BoundsType = keyof typeof schemas;

/** Why the server would refuse this record, or undefined if it would not. */
export function refusalFor(type: BoundsType, record: object): 'invalid_record' | 'unknown_schema_version' | undefined {
  const version = (record as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version !== KNOWN_SCHEMA_VERSION) return 'unknown_schema_version';
  return schemas[type].safeParse(record).success ? undefined : 'invalid_record';
}
