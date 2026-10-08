import type { Macros, Quantity } from '../types';
import { assertMacros, assertNonNegative } from './validate';

/** Scales macros given for `from` to the quantity `to`. Units must match; no conversions. */
export function scaleMacros(macros: Macros, from: Quantity, to: Quantity): Macros {
  assertMacros(macros);
  assertNonNegative(from.amount, 'from.amount');
  assertNonNegative(to.amount, 'to.amount');
  if (from.unit !== to.unit) {
    throw new Error(`cannot scale between units ${from.unit} and ${to.unit}`);
  }
  if (from.amount === 0) {
    throw new Error('a reference amount of 0 cannot be scaled');
  }
  const factor = to.amount / from.amount;
  return {
    kcal: macros.kcal * factor,
    proteinG: macros.proteinG * factor,
    carbsG: macros.carbsG * factor,
    fatG: macros.fatG * factor,
  };
}
