import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import type { View } from '../../App';
import { Composer } from '../add-food/Composer';
import { EntryEditor } from './EntryEditor';
import { EntryList } from './EntryList';
import { TotalsPanel } from './TotalsPanel';
import { useCurrentDayKey } from './useCurrentDayKey';
import { useDayLog } from './useDayLog';

interface Props {
  /** False while another view is shown over the still-mounted Today (feature 004, research R1). */
  active?: boolean;
  onNavigate: (view: View) => void;
}

export function TodayScreen({ active = true, onNavigate }: Props) {
  const { now } = useServices();
  const dayKey = useCurrentDayKey();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingProteinG, setPendingProteinG] = useState(0);
  const wasActive = useRef(active);
  const day = useDayLog(dayKey, refreshKey);

  // Other views can change entries and goals; reload when Today becomes visible again.
  useEffect(() => {
    if (active && !wasActive.current) setRefreshKey((k) => k + 1);
    wasActive.current = active;
  }, [active]);

  return (
    // One grid for every width: a single column on phones, entries beside the composer from 960 px (research R3).
    <section className="today">
      <header className="screen-header today-header">
        <h1>Today</h1>
        <span className="muted today-date">{formatToday(now())}</span>
        <nav className="today-nav" aria-label="Other views">
          <button type="button" className="icon-button" aria-label="Previous days" onClick={() => onNavigate('history')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </button>
          <button type="button" className="icon-button" aria-label="Goal settings" onClick={() => onNavigate('goal')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1" />
            </svg>
          </button>
          <button type="button" className="icon-button" aria-label="Account" onClick={() => onNavigate('account')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
            </svg>
          </button>
        </nav>
      </header>
      <div className="today-summary">
        <TotalsPanel
          totals={day.totals}
          goalG={day.goalG}
          pendingG={pendingProteinG}
          onSetGoal={() => onNavigate('goal')}
        />
      </div>
      <div className="today-entries stack">
        {day.editing && (
          <EntryEditor key={day.editing.id} entry={day.editing} onClose={day.closeEditor} onChanged={day.changed} />
        )}
        <EntryList entries={day.entries} onSelect={day.select} />
      </div>
      <Composer
        active={active}
        refreshKey={refreshKey}
        onLogged={() => setRefreshKey((k) => k + 1)}
        onMoreRecent={() => onNavigate('recent')}
        onPendingChange={setPendingProteinG}
      />
    </section>
  );
}

function formatToday(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
