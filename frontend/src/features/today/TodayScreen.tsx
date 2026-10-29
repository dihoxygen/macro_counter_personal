import { useEffect, useRef, useState } from 'react';
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
        <div className="row">
          <button type="button" onClick={() => onNavigate('history')}>
            Previous days
          </button>
          <button type="button" onClick={() => onNavigate('account')}>
            Account
          </button>
        </div>
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
