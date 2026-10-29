import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { LogEntry, ProteinGoal } from '../../data/records';
import { goalForDay } from '../../domain/goals';
import { sumMacros } from '../../domain/nutrition/totals';
import type { DayKey } from '../../domain/types';

/**
 * One day's entries, totals and goal, plus which entry is being edited. Shared by DayLog (history) and Today,
 * which lays the pieces out itself (feature 004). Changing refreshKey reloads the day.
 */
export function useDayLog(dayKey: DayKey, refreshKey = 0) {
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

  return {
    entries,
    totals: sumMacros(entries.map((e) => e.macros)),
    goalG: goalForDay(goals, dayKey),
    // An editor opened on another day (before a rollover or navigation) is not shown.
    editing: selected?.dayKey === dayKey ? selected : null,
    select: setSelected,
    closeEditor: () => setSelected(null),
    changed: () => {
      setSelected(null);
      reload();
    },
  };
}
