import { describe, expect, it } from 'vitest';
import { nextDay, previousDay, toDayKey } from '../../../src/domain/days';

describe('toDayKey', () => {
  it('uses the local calendar date with zero padding', () => {
    expect(toDayKey(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
    expect(toDayKey(new Date(2026, 9, 8, 9, 30))).toBe('2026-10-08');
  });

  it('puts 23:59:59.999 and 00:00:00.000 local on different days', () => {
    expect(toDayKey(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31');
    expect(toDayKey(new Date(2027, 0, 1, 0, 0, 0, 0))).toBe('2027-01-01');
  });

  it('is stable across DST transition dates', () => {
    // US and EU transitions; the key must be the local date whatever the zone offset does.
    for (const d of [
      new Date(2026, 2, 8, 1, 30),
      new Date(2026, 2, 8, 3, 30),
      new Date(2026, 2, 29, 1, 30),
      new Date(2026, 10, 1, 1, 30),
      new Date(2026, 9, 25, 2, 30),
    ]) {
      const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(toDayKey(d)).toBe(expected);
    }
  });
});

describe('previousDay / nextDay', () => {
  it.each([
    ['2026-10-08', '2026-10-07', '2026-10-09'],
    ['2026-11-01', '2026-10-31', '2026-11-02'],
    ['2027-01-01', '2026-12-31', '2027-01-02'],
    ['2026-03-29', '2026-03-28', '2026-03-30'], // EU DST change
    ['2026-03-08', '2026-03-07', '2026-03-09'], // US DST change
  ])('around %s', (day, prev, next) => {
    expect(previousDay(day)).toBe(prev);
    expect(nextDay(day)).toBe(next);
  });

  it('handles leap years: 2028-02-28 → 2028-02-29 → 2028-03-01', () => {
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('2028-02-29')).toBe('2028-03-01');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
  });

  it('handles non-leap years: 2027-02-28 → 2027-03-01', () => {
    expect(nextDay('2027-02-28')).toBe('2027-03-01');
    expect(previousDay('2027-03-01')).toBe('2027-02-28');
  });

  it('rejects a malformed day key', () => {
    expect(() => nextDay('2026-1-1')).toThrow(RangeError);
    expect(() => previousDay('not a day')).toThrow(RangeError);
  });
});
