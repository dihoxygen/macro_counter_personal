import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { LogEntry, ProteinGoal } from '../../data/records';
import { goalForDay } from '../../domain/goals';
import { sumMacros } from '../../domain/nutrition/totals';
import type { DayKey } from '../../domain/types';
import { EntryEditor } from './EntryEditor';
import { EntryList } from './EntryList';
import { TotalsPanel } from './TotalsPanel';

/** One day's totals and entries, with editing. Shared by Today and the day history view. */
interface Props {
  dayKey: DayKey;
  /** Changing it reloads the day (feature 004: Today refreshes after logging or when shown again). */
  refreshKey?: number;
  onSetGoal?: () => void;
  /** Protein of an open estimate card on Today (feature 004). */
  pendingG?: number;
}

export function DayLog({ dayKey, refreshKey = 0, onSetGoal, pendingG }: Props) {
  const services = useServices();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [goals, setGoals] = useState<ProteinGoal[]>([]);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    void Promise.all([services.entries.listByDay(dayKey), services.goals.listAll()]).then(([list, history]) => {
      if (!active) return;
      setEntries(list);
      setGoals(history);
    });
    return () => {
      active = false;
    };
  }, [services, dayKey, version, refreshKey]);

  // An editor opened on another day (before a rollover or navigation) is not shown.
  const editing = selected?.dayKey === dayKey ? selected : null;

  return (
    <div className="stack">
      <TotalsPanel
        totals={sumMacros(entries.map((e) => e.macros))}
        goalG={goalForDay(goals, dayKey)}
        onSetGoal={onSetGoal}
        pendingG={pendingG}
      />
      {editing && (
        <EntryEditor
          key={editing.id}
          entry={editing}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
      <EntryList entries={entries} onSelect={setSelected} />
    </div>
  );
}
