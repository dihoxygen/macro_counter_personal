import { useEffect, useRef, useState } from 'react';
import type { View } from '../../App';
import { DayLog } from './DayLog';
import { useCurrentDayKey } from './useCurrentDayKey';

interface Props {
  /** False while another view is shown over the still-mounted Today (feature 004, research R1). */
  active?: boolean;
  onNavigate: (view: View) => void;
}

export function TodayScreen({ active = true, onNavigate }: Props) {
  const dayKey = useCurrentDayKey();
  const [refreshKey, setRefreshKey] = useState(0);
  const wasActive = useRef(active);

  // Other views can change entries and goals; reload when Today becomes visible again.
  useEffect(() => {
    if (active && !wasActive.current) setRefreshKey((k) => k + 1);
    wasActive.current = active;
  }, [active]);

  return (
    <section className="stack">
      <header className="screen-header">
        <h1>Today</h1>
      </header>
      <DayLog dayKey={dayKey} refreshKey={refreshKey} onSetGoal={() => onNavigate('goal')} />
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
