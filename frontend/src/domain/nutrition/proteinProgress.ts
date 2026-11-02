import { assertNonNegative } from './validate';

export interface ProteinProgress {
  loggedG: number;
  goalG: number;
  remainingG: number;
  exceededG: number;
  met: boolean;
}

/** Today's protein against the goal (data-model.md). Null when there is no goal. Full precision. */
export function proteinProgress(loggedG: number, goalG: number | null): ProteinProgress | null {
  assertNonNegative(loggedG, 'loggedG');
  if (goalG === null) return null;
  if (!Number.isFinite(goalG) || goalG <= 0) {
    throw new RangeError(`goalG must be a finite number > 0 (got ${goalG})`);
  }
  return {
    loggedG,
    goalG,
    remainingG: Math.max(goalG - loggedG, 0),
    exceededG: Math.max(loggedG - goalG, 0),
    met: loggedG >= goalG,
  };
}

/**
 * Widths of the protein bar's logged and pending segments, in percent of the goal (feature 004, data-model.md).
 * Pending is the protein of an estimate not yet confirmed. The two never add up to more than 100. Full precision.
 */
export function proteinSegments(
  loggedG: number,
  pendingG: number,
  goalG: number | null,
): { loggedPct: number; pendingPct: number } {
  assertNonNegative(loggedG, 'loggedG');
  assertNonNegative(pendingG, 'pendingG');
  if (goalG === null) return { loggedPct: 0, pendingPct: 0 };
  if (!Number.isFinite(goalG) || goalG <= 0) {
    throw new RangeError(`goalG must be a finite number > 0 (got ${goalG})`);
  }
  const loggedPct = Math.min(loggedG / goalG, 1) * 100;
  const pendingPct = Math.min((loggedG + pendingG) / goalG, 1) * 100 - loggedPct;
  return { loggedPct, pendingPct };
}
