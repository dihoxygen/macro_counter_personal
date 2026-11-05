import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { ChangeType, EntryVersion, LogEntry } from '../../data/records';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import { useRemoteChanges } from '../shared/useRemoteChanges';

const CHANGE_LABELS: Record<ChangeType, string> = {
  edit: 'Edited',
  delete: 'Deleted',
  restore: 'Replaced by a restore',
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function versionSummary(version: Pick<LogEntry, 'name' | 'quantity' | 'macros'>): string {
  const { name, quantity, macros } = version;
  return `${name}, ${quantity.amount} ${quantity.unit}, ${formatKcal(macros.kcal)}, ${formatGrams(macros.proteinG)} protein`;
}

interface Props {
  entry: LogEntry;
  onClose: () => void;
  onRestored: () => void;
}

/** An entry's current state and the ones it replaced (FR-025). A restore can itself be undone here, so it applies at once. */
export function EntryHistory({ entry, onClose, onRestored }: Props) {
  const services = useServices();
  const [history, setHistory] = useState<{ current: LogEntry; versions: EntryVersion[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const remote = useRemoteChanges('version', 'entry');
  const current = history?.current ?? entry;
  const versions = history?.versions;

  // The stored entry, not the one this opened with: another device may have changed it since.
  useEffect(() => {
    let active = true;
    void (async () => {
      const latest = (await services.entries.get(entry.id)) ?? entry;
      const list = await services.entryVersions.listForEntry(latest);
      if (active) setHistory({ current: latest, versions: list });
    })();
    return () => {
      active = false;
    };
  }, [services, entry, remote]);

  const restore = async (version: EntryVersion) => {
    await services.entryVersions.restore(version.id);
    setMessage('Restored.');
    onRestored();
  };

  return (
    <section className="card stack" aria-label={`History of ${entry.name}`}>
      <strong>History</strong>
      <ul aria-label="Versions" className="stack version-list">
        <li>
          <span>{versionSummary(current)}</span>
          <span className="muted">
            Current{current.restoredAt ? `, restored ${when(current.restoredAt)}` : ''}
          </span>
        </li>
        {versions?.map((version) => (
          <li key={version.id}>
            <span>{versionSummary(version)}</span>
            <span className="muted">
              {CHANGE_LABELS[version.changeType]} {when(version.replacedAt)}
            </span>
            <button type="button" onClick={() => void restore(version)}>
              Restore this version
            </button>
          </li>
        ))}
      </ul>
      {versions?.length === 0 && <p className="muted">No earlier versions.</p>}
      {message && <p role="status">{message}</p>}
      <div className="row">
        <button type="button" onClick={onClose}>
          Back to entry
        </button>
      </div>
    </section>
  );
}
