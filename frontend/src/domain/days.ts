import { DayKeySchema, type DayKey } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of `date` as YYYY-MM-DD. */
export function toDayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function previousDay(dayKey: DayKey): DayKey {
  return shift(dayKey, -1);
}

export function nextDay(dayKey: DayKey): DayKey {
  return shift(dayKey, 1);
}

/** Calendar arithmetic in UTC so DST transitions can never skip or repeat a day. */
function shift(dayKey: DayKey, days: number): DayKey {
  if (!DayKeySchema.safeParse(dayKey).success) throw new RangeError(`not a day key: ${dayKey}`);
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
