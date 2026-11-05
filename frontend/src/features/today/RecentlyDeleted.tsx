import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { EntryVersion } from '../../data/records';
import type { DayKey } from '../../domain/types';
import { useRemoteChanges } from '../shared/useRemoteChanges';
import { versionSummary } from './EntryHistory';

interface Props {
  dayKey: DayKey;
  /** Changing it reloads the list. */
  refreshKey: number;
  onRestored: () => void;
}

/** A day's deleted entries, kept for 90 days (FR-025). Takes no space when there are none. */
export function RecentlyDeleted({ dayKey, refreshKey, onRestored }: Props) {
  const services = useServices();
  const [deleted, setDeleted] = useState<EntryVersion[]>([]);
  const [open, setOpen] = useState(false);
  const [restores, setRestores] = useState(0);
  const remote = useRemoteChanges('version', 'entry');

  useEffect(() => {
    let active = true;
    void services.entryVersions.listDeletedForDay(dayKey).then((list) => {
      if (active) setDeleted(list);
    });
    return () => {
      active = false;
    };
  }, [services, dayKey, refreshKey, remote, restores]);

  if (deleted.length === 0) return null;

  const restore = async (version: EntryVersion) => {
    await services.entryVersions.restore(version.id);
    setRestores((count) => count + 1);
    onRestored();
  };

  return (
    <div className="stack">
      <div className="row">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Recently deleted ({deleted.length})
        </button>
      </div>
      {open && (
        <ul aria-label="Recently deleted entries" className="stack version-list">
          {deleted.map((version) => (
            <li key={version.id}>
              <span>{versionSummary(version)}</span>
              <button type="button" aria-label={`Restore ${version.name}`} onClick={() => void restore(version)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
