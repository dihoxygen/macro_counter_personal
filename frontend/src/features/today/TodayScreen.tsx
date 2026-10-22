import type { View } from '../../App';
import { DayLog } from './DayLog';
import { useCurrentDayKey } from './useCurrentDayKey';

export function TodayScreen({ onNavigate }: { onNavigate: (view: View) => void }) {
  const dayKey = useCurrentDayKey();

  return (
    <section className="stack">
      <header className="screen-header">
        <h1>Today</h1>
      </header>
      <DayLog dayKey={dayKey} onSetGoal={() => onNavigate('goal')} />
      <div className="row">
        <button type="button" className="primary" onClick={() => onNavigate('add')}>
          Add food
        </button>
        <button type="button" onClick={() => onNavigate('recent')}>
          Recent
        </button>
        <button type="button" onClick={() => onNavigate('history')}>
          Previous days
        </button>
        <button type="button" onClick={() => onNavigate('account')}>
          Account
        </button>
      </div>
    </section>
  );
}
