import type { Macros, Quantity, Unit } from '../../domain/types';
import { NUMBER_ERROR, parseNonNegative } from './numberField';

// Validation shared by manual entry and entry editing, so both apply the same rules.

export type EntryNumberField = 'amount' | 'kcal' | 'proteinG' | 'carbsG' | 'fatG';
export type EntryFormErrors = Partial<Record<EntryNumberField | 'name', string>>;

export const entryFieldLabels: Record<Exclude<EntryNumberField, 'amount'>, string> = {
  kcal: 'Calories (kcal)',
  proteinG: 'Protein (g)',
  carbsG: 'Carbs (g)',
  fatG: 'Fat (g)',
};

export type ParsedEntryForm =
  | { ok: true; name: string; quantity: Quantity; macros: Macros }
  | { ok: false; errors: EntryFormErrors };

export function parseEntryForm(
  name: string,
  unit: Unit,
  values: Record<EntryNumberField, string>,
): ParsedEntryForm {
  const errors: EntryFormErrors = {};
  const trimmed = name.trim();
  if (trimmed === '') errors.name = 'Name is required.';
  else if (trimmed.length > 120) errors.name = 'Keep the name to 120 characters or fewer.';

  const parsed = {} as Record<EntryNumberField, number>;
  for (const key of Object.keys(values) as EntryNumberField[]) {
    const value = parseNonNegative(values[key]);
    if (value === null) errors[key] = NUMBER_ERROR;
    else parsed[key] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    name: trimmed,
    quantity: { amount: parsed.amount, unit },
    macros: { kcal: parsed.kcal, proteinG: parsed.proteinG, carbsG: parsed.carbsG, fatG: parsed.fatG },
  };
}

/** A short, editable form of a full-precision number (display only; stored values keep precision). */
export function toInputValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}
