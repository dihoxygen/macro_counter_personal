// The only place in the app where nutrition values are rounded (Principle II).

export function formatKcal(kcal: number): string {
  return `${Math.round(kcal)} kcal`;
}

/** "90 / 150 g": logged protein against the goal. */
export function formatGramsOfGoal(loggedG: number, goalG: number): string {
  return `${Math.round(loggedG * 10) / 10} / ${formatGrams(goalG)}`;
}

/** Rounds to 1 decimal place and drops a trailing ".0": 90 → "90 g", 9.94 → "9.9 g". */
export function formatGrams(grams: number): string {
  return `${Math.round(grams * 10) / 10} g`;
}
