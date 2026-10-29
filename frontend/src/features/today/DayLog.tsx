import type { DayKey } from '../../domain/types';
import { EntryEditor } from './EntryEditor';
import { EntryList } from './EntryList';
import { TotalsPanel } from './TotalsPanel';
import { useDayLog } from './useDayLog';

interface Props {
  dayKey: DayKey;
  /** Changing it reloads the day. */
  refreshKey?: number;
  onSetGoal?: () => void;
  /** Protein of an open estimate card (feature 004). Unset in the day history view. */
  pendingG?: number;
}

/** One day's totals and entries, with editing. Used by the day history view; Today lays out the same pieces. */
export function DayLog({ dayKey, refreshKey = 0, onSetGoal, pendingG }: Props) {
  const day = useDayLog(dayKey, refreshKey);

  return (
    <div className="stack">
      <TotalsPanel totals={day.totals} goalG={day.goalG} onSetGoal={onSetGoal} pendingG={pendingG} />
      {day.editing && (
        <EntryEditor key={day.editing.id} entry={day.editing} onClose={day.closeEditor} onChanged={day.changed} />
      )}
      <EntryList entries={day.entries} onSelect={day.select} />
    </div>
  );
}
