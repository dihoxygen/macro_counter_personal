import { daysBefore } from '../days';
import { goalForDay, type GoalRecord } from '../goals';
import type { DayKey, Macros } from '../types';
import { sumMacros } from './totals';

export interface TrendEntry {
  dayKey: DayKey;
  macros: Macros;
}

export interface TrendDay {
  dayKey: DayKey;
  /** Null when nothing was logged: "no data", which is not the same as zero (FR-034). */
  totals: Macros | null;
  /** The protein goal that applied that day. */
  goalG: number | null;
}

export interface Trend {
  /** Oldest first, ending today. */
  days: TrendDay[];
  /** Over the days that have data. Null when none do. */
  averages: Macros | null;
}

export const TREND_RANGES = [7, 30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** The first day of a range ending on `today`. */
export function trendStart(today: DayKey, rangeDays: number): DayKey {
  return daysBefore(today, rangeDays - 1);
}

/** Calculated from the entries every time: no totals are stored, so a past edit shows at once (FR-032). */
export function buildTrend(
  entries: readonly TrendEntry[],
  goals: readonly GoalRecord[],
  today: DayKey,
  rangeDays: number,
): Trend {
  const byDay = new Map<DayKey, Macros[]>();
  for (const { dayKey, macros } of entries) {
    const list = byDay.get(dayKey);
    if (list) list.push(macros);
    else byDay.set(dayKey, [macros]);
  }

  const days: TrendDay[] = [];
  for (let back = rangeDays - 1; back >= 0; back--) {
    const dayKey = daysBefore(today, back);
    const macros = byDay.get(dayKey);
    days.push({ dayKey, totals: macros ? sumMacros(macros) : null, goalG: goalForDay(goals, dayKey) });
  }

  const withData = days.flatMap((day) => (day.totals ? [day.totals] : []));
  if (withData.length === 0) return { days, averages: null };
  const sum = sumMacros(withData);
  const count = withData.length;
  return {
    days,
    averages: {
      kcal: sum.kcal / count,
      proteinG: sum.proteinG / count,
      carbsG: sum.carbsG / count,
      fatG: sum.fatG / count,
    },
  };
}
