import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import type { Macros } from '../../domain/types';
import { ProteinProgress } from './ProteinProgress';

interface Props {
  totals: Macros;
  goalG: number | null;
  onSetGoal?: () => void;
}

/** Protein comes first and largest, with goal progress on top; this is a protein-focused app (FR-009). */
export function TotalsPanel({ totals, goalG, onSetGoal }: Props) {
  return (
    <section aria-label="Totals" className="totals card">
      <ProteinProgress loggedG={totals.proteinG} goalG={goalG} onSetGoal={onSetGoal} />
      <Total label="Protein" value={formatGrams(totals.proteinG)} primary />
      <div className="totals-secondary">
        <Total label="Calories" value={formatKcal(totals.kcal)} />
        <Total label="Carbs" value={formatGrams(totals.carbsG)} />
        <Total label="Fat" value={formatGrams(totals.fatG)} />
      </div>
    </section>
  );
}

function Total({ label, value, primary = false }: { label: string; value: string; primary?: boolean }) {
  return (
    <div role="group" aria-label={label} className={primary ? 'total primary' : 'total'}>
      <span className="total-label">{label}</span>
      <span className="total-value">{value}</span>
    </div>
  );
}
