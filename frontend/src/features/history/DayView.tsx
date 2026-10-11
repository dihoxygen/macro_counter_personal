import { useState } from 'react';
import { useServices } from '../../app/services';
import { nextDay, previousDay, toDayKey } from '../../domain/days';
import type { DayKey } from '../../domain/types';
import { DayLog } from '../today/DayLog';

/** Browse, edit and delete entries of earlier days (FR-012). */
export function DayView() {
  const { now } = useServices();
  const today = toDayKey(now());
  const [dayKey, setDayKey] = useState<DayKey>(() => previousDay(today));

  return (
    <div className="stack">
      <div className="row day-nav">
        <button type="button" aria-label="Previous day" onClick={() => setDayKey(previousDay(dayKey))}>
          ←
        </button>
        <h2>{formatDay(dayKey)}</h2>
        <button
          type="button"
          aria-label="Next day"
          disabled={dayKey >= today}
          onClick={() => setDayKey(nextDay(dayKey))}
        >
          →
        </button>
      </div>
      <DayLog dayKey={dayKey} />
    </div>
  );
}

function formatDay(dayKey: DayKey): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
