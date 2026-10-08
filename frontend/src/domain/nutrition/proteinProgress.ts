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
