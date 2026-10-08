import type { Estimate, EstimateItem } from '../../src/api/estimates';

export const bananaItem: EstimateItem = {
  name: 'Banana',
  portion: { amount: 118, unit: 'g' },
  portionDescription: '1 medium banana (~118 g)',
  macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
  flags: [],
};

export const eggItem: EstimateItem = {
  name: 'Egg',
  portion: { amount: 50, unit: 'g' },
  portionDescription: '1 large egg (~50 g)',
  macros: { kcal: 78, proteinG: 6.3, carbsG: 0.6, fatG: 5.3 },
  flags: [],
};

export const toastItem: EstimateItem = {
  name: 'Toast',
  portion: { amount: 30, unit: 'g' },
  portionDescription: '1 slice whole wheat (~30 g)',
  macros: { kcal: 69, proteinG: 3.6, carbsG: 12, fatG: 0.9 },
  flags: [],
};

export function estimateOf(...items: EstimateItem[]): Estimate {
  const total = items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.macros.kcal,
      proteinG: acc.proteinG + i.macros.proteinG,
      carbsG: acc.carbsG + i.macros.carbsG,
      fatG: acc.fatG + i.macros.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return {
    recognized: items.length > 0,
    items,
    total,
    flags: [...new Set(items.flatMap((i) => i.flags))],
  };
}

/** An estimate call that only settles when aborted (rejecting with AbortError). */
export function pendingUntilAborted() {
  let lastSignal: AbortSignal | undefined;
  const fn = (_input: unknown, signal: AbortSignal) => {
    lastSignal = signal;
    return new Promise<Estimate>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  return { fn, signal: () => lastSignal };
}
