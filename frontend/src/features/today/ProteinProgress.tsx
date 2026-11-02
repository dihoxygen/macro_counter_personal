import { formatGrams, formatGramsOfGoal } from '../../domain/nutrition/format';
import { proteinProgress, proteinSegments } from '../../domain/nutrition/proteinProgress';

interface Props {
  loggedG: number;
  goalG: number | null;
  /** When given, a prompt to set the goal (none yet, Story 5 #1) or to change it (FR-018) is shown. */
  onSetGoal?: () => void;
  /** Protein of an open, unconfirmed estimate (feature 004, FR-004). Never counted as logged. */
  pendingG?: number;
}

/** Protein logged against the day's goal: the number this app is built around (FR-019). */
export function ProteinProgress({ loggedG, goalG, onSetGoal, pendingG = 0 }: Props) {
  const progress = proteinProgress(loggedG, goalG);

  const pending = pendingG > 0 ? <span className="goal-pending">+{formatGrams(pendingG)} pending</span> : null;

  if (!progress) {
    if (!onSetGoal && !pending) return null;
    return (
      <div className="goal-prompt row">
        {onSetGoal && (
          <button type="button" onClick={onSetGoal}>
            Set a protein goal
          </button>
        )}
        {pending}
      </div>
    );
  }

  const { loggedPct, pendingPct } = proteinSegments(progress.loggedG, pendingG, progress.goalG);
  return (
    <section aria-label="Protein goal" className={progress.met ? 'goal met' : 'goal'}>
      <div className="goal-line">
        <strong className="goal-amount">{formatGramsOfGoal(progress.loggedG, progress.goalG)}</strong>
        {progress.met ? <span className="goal-status">Goal met</span> : <span>{formatGrams(progress.remainingG)} left</span>}
        {progress.exceededG > 0 && <span>+{formatGrams(progress.exceededG)}</span>}
        {pending}
        {onSetGoal && (
          <button type="button" className="goal-change" onClick={onSetGoal}>
            Change goal
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Protein toward goal"
        aria-valuemin={0}
        aria-valuemax={progress.goalG}
        aria-valuenow={Math.min(progress.loggedG, progress.goalG)}
        className="goal-bar"
      >
        <div className="goal-bar-fill" style={{ width: `${loggedPct}%` }} />
        {pendingPct > 0 && <div className="goal-bar-pending" style={{ width: `${pendingPct}%` }} />}
      </div>
    </section>
  );
}
