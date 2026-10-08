import type { Macros } from '../types';
import { assertMacros } from './validate';

/** Field-wise sum at full precision. Throws RangeError on any invalid value. */
export function sumMacros(list: readonly Macros[]): Macros {
  const total: Macros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const m of list) {
    assertMacros(m);
    total.kcal += m.kcal;
    total.proteinG += m.proteinG;
    total.carbsG += m.carbsG;
    total.fatG += m.fatG;
  }
  return total;
}
