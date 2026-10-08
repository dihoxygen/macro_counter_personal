import type { LogEntry } from '../../data/records';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';

export function EntryList({ entries, onSelect }: { entries: LogEntry[]; onSelect: (entry: LogEntry) => void }) {
  if (entries.length === 0) {
    return <p className="muted">Nothing logged yet.</p>;
  }
  return (
    <ul aria-label="Entries" className="entry-list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button type="button" className="entry" onClick={() => onSelect(entry)}>
            <span className="entry-name">{entry.name}</span>
            <span className="muted">
              {formatQuantity(entry.quantity.amount, entry.quantity.unit)} · {formatKcal(entry.macros.kcal)} ·{' '}
              {formatGrams(entry.macros.proteinG)} protein
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function formatQuantity(amount: number, unit: string): string {
  const rounded = Math.round(amount * 10) / 10;
  return unit === 'serving' ? `${rounded} serving${rounded === 1 ? '' : 's'}` : `${rounded} ${unit}`;
}
