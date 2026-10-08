import type { Macros } from '../types';

/** Throws RangeError unless value is a finite number ≥ 0. */
export function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number ≥ 0 (got ${value})`);
  }
}

export function assertMacros(macros: Macros): void {
  assertNonNegative(macros.kcal, 'kcal');
  assertNonNegative(macros.proteinG, 'proteinG');
  assertNonNegative(macros.carbsG, 'carbsG');
  assertNonNegative(macros.fatG, 'fatG');
}
