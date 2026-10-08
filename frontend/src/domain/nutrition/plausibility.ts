import type { Macros, Quantity } from '../types';
import { assertMacros } from './validate';

// Same limits as the backend validator (research R5).
const MAX_PORTION = 2000; // g or ml
const MAX_KCAL = 5000;
const MAX_MACRO_G = 1000;
const MISMATCH_FLOOR_KCAL = 20;
const MISMATCH_PERCENT = 15;

/** True when values are big enough that the user must confirm them before saving. */
export function isImplausiblyLarge(quantity: Quantity, macros: Macros): boolean {
  return (
    (quantity.unit !== 'serving' && quantity.amount > MAX_PORTION) ||
    macros.kcal > MAX_KCAL ||
    macros.proteinG > MAX_MACRO_G ||
    macros.carbsG > MAX_MACRO_G ||
    macros.fatG > MAX_MACRO_G
  );
}

/** True when the portion alone is large enough to flag (the backend's large_portion rule). */
export function isLargePortion(quantity: Quantity): boolean {
  return quantity.unit !== 'serving' && quantity.amount > MAX_PORTION;
}

/** |kcal − (4P + 4C + 9F)| > max(20 kcal, 15% of 4P + 4C + 9F); mirrors backend MacroMath. */
export function isCalorieMismatch(macros: Macros): boolean {
  assertMacros(macros);
  const expected = 4 * macros.proteinG + 4 * macros.carbsG + 9 * macros.fatG;
  // Multiply before dividing so 15% of round numbers stays exact (170 → 25.5).
  const tolerance = Math.max(MISMATCH_FLOOR_KCAL, (expected * MISMATCH_PERCENT) / 100);
  return Math.abs(macros.kcal - expected) > tolerance;
}
