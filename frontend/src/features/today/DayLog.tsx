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
export function DayLog({ dayKey, onSetGoal }: { dayKey: DayKey; onSetGoal?: () => void }) {
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
  }, [services, dayKey, version]);

  // An editor opened on another day (before a rollover or navigation) is not shown.
  const editing = selected?.dayKey === dayKey ? selected : null;

  return (
    <div className="stack">
      <TotalsPanel
        totals={sumMacros(entries.map((e) => e.macros))}
        goalG={goalForDay(goals, dayKey)}
        onSetGoal={onSetGoal}
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
