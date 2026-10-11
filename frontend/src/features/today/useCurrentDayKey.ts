import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { toDayKey } from '../../domain/days';
import type { DayKey } from '../../domain/types';

const CHECK_EVERY_MS = 60_000;

/** Today's local day key; re-checked once a minute and when the page becomes visible (research R8). */
export function useCurrentDayKey(): DayKey {
  const { now } = useServices();
  const [dayKey, setDayKey] = useState(() => toDayKey(now()));

  useEffect(() => {
    const check = () => setDayKey(toDayKey(now()));
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [now]);

  return dayKey;
}
