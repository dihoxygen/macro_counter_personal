import { formatGrams, formatGramsOfGoal } from '../../domain/nutrition/format';
import { proteinProgress } from '../../domain/nutrition/proteinProgress';

interface Props {
  loggedG: number;
  goalG: number | null;
  /** When given and there is no goal, a prompt to set one is shown (Story 5 #1). */
  onSetGoal?: () => void;
}

/** Protein logged against the day's goal: the number this app is built around (FR-019). */
export function ProteinProgress({ loggedG, goalG, onSetGoal }: Props) {
  const progress = proteinProgress(loggedG, goalG);

  if (!progress) {
    return onSetGoal ? (
      <div className="goal-prompt">
        <button type="button" onClick={onSetGoal}>
          Set a protein goal
        </button>
      </div>
    ) : null;
  }

  const percent = Math.min(progress.loggedG / progress.goalG, 1) * 100;
  return (
    <section aria-label="Protein goal" className={progress.met ? 'goal met' : 'goal'}>
      <div className="goal-line">
        <strong className="goal-amount">{formatGramsOfGoal(progress.loggedG, progress.goalG)}</strong>
        {progress.met ? <span className="goal-status">Goal met</span> : <span>{formatGrams(progress.remainingG)} left</span>}
        {progress.exceededG > 0 && <span>+{formatGrams(progress.exceededG)}</span>}
      </div>
      <div
        role="progressbar"
        aria-label="Protein toward goal"
        aria-valuemin={0}
        aria-valuemax={progress.goalG}
        aria-valuenow={Math.min(progress.loggedG, progress.goalG)}
        className="goal-bar"
      >
        <div className="goal-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
