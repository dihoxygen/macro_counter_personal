import { describe, expect, it } from 'vitest';
import { goalForDay } from '../../../src/domain/goals';

const history = [
  { effectiveFrom: '2026-10-08', grams: 150 },
  { effectiveFrom: '2026-10-01', grams: 120 },
  { effectiveFrom: '2026-10-05', grams: null },
  { effectiveFrom: '2026-10-06', grams: 130 },
];

describe('goalForDay', () => {
  it('uses the record with the largest effectiveFrom ≤ the day', () => {
    expect(goalForDay(history, '2026-10-01')).toBe(120);
    expect(goalForDay(history, '2026-10-04')).toBe(120);
    expect(goalForDay(history, '2026-10-07')).toBe(130);
    expect(goalForDay(history, '2026-10-08')).toBe(150);
    expect(goalForDay(history, '2027-01-01')).toBe(150);
  });

  it('returns null when the goal was cleared for that period', () => {
    expect(goalForDay(history, '2026-10-05')).toBeNull();
  });

  it('returns null when no record applies yet', () => {
    expect(goalForDay(history, '2026-09-30')).toBeNull();
    expect(goalForDay([], '2026-10-08')).toBeNull();
  });

  it('ignores a future-dated record for earlier days', () => {
    expect(goalForDay([{ effectiveFrom: '2026-12-01', grams: 200 }], '2026-10-08')).toBeNull();
  });
});
