import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services';
import type { LogEntry, ProteinGoal } from '../../data/records';
import { toDayKey } from '../../domain/days';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import { buildTrend, TREND_RANGES, trendStart, type TrendRange } from '../../domain/nutrition/trends';
import type { DayKey, Macros } from '../../domain/types';
import { useRemoteChanges } from '../shared/useRemoteChanges';
import { TrendChart } from './TrendChart';

const NO_DATA = 'no data';

const MEASURES = [
  { title: 'Calories', pick: (m: Macros) => m.kcal, format: formatKcal },
  { title: 'Protein', pick: (m: Macros) => m.proteinG, format: formatGrams },
  { title: 'Carbs', pick: (m: Macros) => m.carbsG, format: formatGrams },
  { title: 'Fat', pick: (m: Macros) => m.fatG, format: formatGrams },
] as const;

function formatDay(dayKey: DayKey): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Daily calories and macros over a range, from the entries on this device, so it works offline (FR-033, FR-035). */
export function TrendsView() {
  const services = useServices();
  const today = toDayKey(services.now());
  const [range, setRange] = useState<TrendRange>(7);
  const [data, setData] = useState<{ entries: LogEntry[]; goals: ProteinGoal[]; range: TrendRange } | null>(null);
  const remote = useRemoteChanges('entry', 'goal');

  useEffect(() => {
    let active = true;
    void Promise.all([services.entries.listByDayRange(trendStart(today, range), today), services.goals.listAll()]).then(
      ([entries, goals]) => {
        if (active) setData({ entries, goals, range });
      },
    );
    return () => {
      active = false;
    };
  }, [services, today, range, remote]);

  const trend = useMemo(() => data && buildTrend(data.entries, data.goals, today, data.range), [data, today]);

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Range">
        {TREND_RANGES.map((days) => (
          <button key={days} type="button" aria-pressed={data?.range === days} onClick={() => setRange(days)}>
            {days} days
          </button>
        ))}
      </div>
      {trend && !trend.averages && <p className="muted">Nothing logged in these days.</p>}
      {trend?.averages && (
        <>
          <dl role="group" aria-label="Averages" className="macro-list">
            {MEASURES.map(({ title, pick, format }) => (
              <div key={title}>
                <dt>Average {title.toLowerCase()}</dt>
                <dd>{format(pick(trend.averages!))}</dd>
              </div>
            ))}
          </dl>
          {MEASURES.map(({ title, pick, format }) => (
            <TrendChart
              key={title}
              title={title}
              values={trend.days.map((day) => (day.totals ? pick(day.totals) : null))}
              goals={title === 'Protein' ? trend.days.map((day) => day.goalG) : undefined}
              summary={`average ${format(pick(trend.averages!))} a day over the last ${trend.days.length} days`}
            />
          ))}
          <div className="trend-table">
            <table aria-label="Daily values">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {MEASURES.map(({ title }) => (
                    <th key={title} scope="col">
                      {title}
                    </th>
                  ))}
                  <th scope="col">Goal</th>
                </tr>
              </thead>
              <tbody>
                {trend.days.map(({ dayKey, totals, goalG }) => (
                  <tr key={dayKey}>
                    <th scope="row">{formatDay(dayKey)}</th>
                    {totals ? (
                      MEASURES.map(({ title, pick, format }) => <td key={title}>{format(pick(totals))}</td>)
                    ) : (
                      <td colSpan={MEASURES.length}>{NO_DATA}</td>
                    )}
                    <td>{goalG === null ? '–' : formatGrams(goalG)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
