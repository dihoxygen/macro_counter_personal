/** Parses a form value as a finite number ≥ 0, or returns null. Empty input is invalid. */
export function parseNonNegative(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export const NUMBER_ERROR = 'Enter a number 0 or more.';
