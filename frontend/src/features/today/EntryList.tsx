import type { LogEntry } from '../../data/records';
import { groupByCategory } from '../../domain/meals';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';

/** The day by meal, each with a subtotal (FR-023). The day's own total stays in the totals panel. */
export function EntryList({ entries, onSelect }: { entries: LogEntry[]; onSelect: (entry: LogEntry) => void }) {
  if (entries.length === 0) {
    return <p className="muted">Nothing logged yet.</p>;
  }
  return (
    <ul aria-label="Entries" className="meal-groups">
      {groupByCategory(entries).map((group) => (
        <li key={group.label} className="stack">
          <h3 className="meal-heading">
            <span>{group.label}</span>
            <span className="muted">
              {formatKcal(group.subtotal.kcal)} · {formatGrams(group.subtotal.proteinG)} protein
            </span>
          </h3>
          <ul className="entry-list">
            {group.entries.map((entry) => (
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
        </li>
      ))}
    </ul>
  );
}

function formatQuantity(amount: number, unit: string): string {
  const rounded = Math.round(amount * 10) / 10;
  return unit === 'serving' ? `${rounded} serving${rounded === 1 ? '' : 's'}` : `${rounded} ${unit}`;
}
