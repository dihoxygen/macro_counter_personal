import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { LogEntry, ProteinGoal } from '../../data/records';
import { goalForDay } from '../../domain/goals';
import { sumMacros } from '../../domain/nutrition/totals';
import type { DayKey } from '../../domain/types';
import { useRemoteChanges } from '../shared/useRemoteChanges';

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
  const [notice, setNotice] = useState<string | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const remote = useRemoteChanges('entry', 'goal');
  const selectedId = selected?.id;

  // Unsaved edits stay when an open entry changes elsewhere; saving resolves that like any edit (contracts/ui-sync.md).
  useEffect(() => {
    if (remote === 0 || selectedId === undefined) return undefined;
    let active = true;
    void services.entries.get(selectedId).then((entry) => {
      if (active && !entry) {
        setSelected(null);
        setNotice('This entry was deleted on another device');
      }
    });
    return () => {
      active = false;
    };
  }, [services, remote, selectedId]);

  useEffect(() => {
    let active = true;
    void Promise.all([services.entries.listByDay(dayKey), services.goals.listAll()]).then(
      ([list, history]) => {
        if (!active) return;
        setEntries(list);
        setGoals(history);
      },
    );
    return () => {
      active = false;
    };
  }, [services, dayKey, version, refreshKey, remote]);

  return {
    entries,
    totals: sumMacros(entries.map((e) => e.macros)),
    goalG: goalForDay(goals, dayKey),
    // An editor opened on another day (before a rollover or navigation) is not shown.
    editing: selected?.dayKey === dayKey ? selected : null,
    notice,
    /** Rises after each local change, for pieces that show more of the day. */
    reloads: version,
    select: (entry: LogEntry) => {
      setNotice(null);
      setSelected(entry);
    },
    closeEditor: () => setSelected(null),
    changed: () => {
      setSelected(null);
      reload();
    },
  };
}
