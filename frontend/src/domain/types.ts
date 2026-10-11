import { z } from 'zod';

// z.number() rejects NaN and ±Infinity, so "finite" holds for every number below.
const nonNegative = z.number().min(0);

export const UnitSchema = z.enum(['g', 'ml', 'serving']);
export type Unit = z.infer<typeof UnitSchema>;

export const QuantitySchema = z.object({
  amount: nonNegative,
  unit: UnitSchema,
});
export type Quantity = z.infer<typeof QuantitySchema>;

export const MacrosSchema = z.object({
  kcal: nonNegative,
  proteinG: nonNegative,
  carbsG: nonNegative,
  fatG: nonNegative,
});
export type Macros = z.infer<typeof MacrosSchema>;

export const SourceSchema = z.enum(['ai', 'ai-edited', 'manual']);
export type Source = z.infer<typeof SourceSchema>;

export const DayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DayKey = z.infer<typeof DayKeySchema>;
