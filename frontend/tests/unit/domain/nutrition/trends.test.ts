import { describe, expect, it } from 'vitest';
import { buildTrend, type TrendEntry } from '../../../../src/domain/nutrition/trends';
import type { Macros } from '../../../../src/domain/types';

const TODAY = '2026-11-04';

const macros = (kcal: number, proteinG: number, carbsG = 0, fatG = 0): Macros => ({ kcal, proteinG, carbsG, fatG });
const on = (dayKey: string, m: Macros): TrendEntry => ({ dayKey, macros: m });

describe('buildTrend', () => {
  it.each([7, 30, 90])('covers a %i-day range ending today, oldest first', (range) => {
    const trend = buildTrend([], [], TODAY, range);

    expect(trend.days).toHaveLength(range);
    expect(trend.days.at(-1)!.dayKey).toBe(TODAY);
  });

  it('starts a week back', () => {
    expect(buildTrend([], [], TODAY, 7).days[0]!.dayKey).toBe('2026-10-29');
  });

  it('adds up each day from its entries (hand-verified)', () => {
    const trend = buildTrend(
      [on(TODAY, macros(250, 20, 30, 5)), on(TODAY, macros(150.5, 10.25, 12, 3)), on('2026-11-03', macros(500, 40, 60, 12))],
      [],
      TODAY,
      7,
    );

    expect(trend.days.at(-1)!.totals).toEqual(macros(400.5, 30.25, 42, 8));
    expect(trend.days.at(-2)!.totals).toEqual(macros(500, 40, 60, 12));
  });

  it('shows a day with no entries as no data, never as zero', () => {
    const trend = buildTrend([on(TODAY, macros(100, 10))], [], TODAY, 7);

    expect(trend.days[0]!.totals).toBeNull();
  });

  it('counts a day of real zero values as data', () => {
    const trend = buildTrend([on(TODAY, macros(0, 0)), on('2026-11-03', macros(100, 10))], [], TODAY, 7);

    expect(trend.days.at(-1)!.totals).toEqual(macros(0, 0));
    expect(trend.averages).toEqual(macros(50, 5));
  });

  it('averages only the days with data (hand-verified)', () => {
    const trend = buildTrend(
      [on('2026-11-01', macros(1000, 90, 100, 30)), on('2026-11-02', macros(2000, 130, 200, 60)), on(TODAY, macros(1500, 110, 150, 45))],
      [],
      TODAY,
      30,
    );

    expect(trend.averages).toEqual(macros(1500, 110, 150, 45));
  });

  it('has no average for an empty range', () => {
    expect(buildTrend([], [], TODAY, 7).averages).toBeNull();
  });

  it('ignores entries outside the range', () => {
    const trend = buildTrend([on('2026-01-01', macros(999, 99)), on(TODAY, macros(100, 10))], [], TODAY, 7);

    expect(trend.averages).toEqual(macros(100, 10));
  });

  it('shows the goal that applied each day', () => {
    const goals = [
      { effectiveFrom: '2026-10-01', grams: 120 },
      { effectiveFrom: '2026-11-02', grams: 150 },
      { effectiveFrom: '2026-11-04', grams: null },
    ];

    const days = buildTrend([], goals, TODAY, 4).days.map((d) => d.goalG);

    expect(days).toEqual([120, 150, 150, null]);
  });
});
