import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { ChangedType } from '../../data/changes';

/** A counter that rises when another device changes these kinds of record, for effects to reload on (FR-005). */
export function useRemoteChanges(...types: ChangedType[]): number {
  const { changes } = useServices();
  const [count, setCount] = useState(0);
  const watched = types.join();

  useEffect(
    () =>
      changes.subscribe((changed) => {
        if (watched.split(',').some((type) => changed.has(type as ChangedType))) setCount((c) => c + 1);
      }),
    [changes, watched],
  );

  return count;
}
