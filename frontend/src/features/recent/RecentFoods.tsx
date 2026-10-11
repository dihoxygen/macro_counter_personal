import { useEffect, useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import type { SavedFood } from '../../data/records';
import { toDayKey } from '../../domain/days';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import { scaleMacros } from '../../domain/nutrition/scale';
import type { Macros } from '../../domain/types';
import { toInputValue } from '../shared/entryForm';
import { FieldError } from '../shared/FormBits';
import { NUMBER_ERROR, parseNonNegative } from '../shared/numberField';

/** Re-log a previously confirmed food without asking the AI again (User Story 4). */
export function RecentFoods({ onLogged }: { onLogged: () => void }) {
  const services = useServices();
  const [foods, setFoods] = useState<SavedFood[] | null>(null);
  const [picked, setPicked] = useState<SavedFood | null>(null);

  useEffect(() => {
    let active = true;
    void services.savedFoods.listRecent().then((list) => {
      if (active) setFoods(list);
    });
    return () => {
      active = false;
    };
  }, [services]);

  if (picked) {
    return <RelogForm food={picked} onLogged={onLogged} onBack={() => setPicked(null)} />;
  }
  if (foods === null) return null;
  if (foods.length === 0) {
    return <p className="muted">No saved foods yet. Foods you confirm are remembered here.</p>;
  }

  return (
    <ul aria-label="Recent foods" className="entry-list">
      {foods.map((food) => (
        <li key={food.id}>
          <button type="button" className="entry" onClick={() => setPicked(food)}>
            <span className="entry-name">{food.name}</span>
            <span className="muted">
              {toInputValue(food.referenceQuantity.amount)} {food.referenceQuantity.unit} · {formatKcal(food.macros.kcal)} ·{' '}
              {formatGrams(food.macros.proteinG)} protein
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RelogForm({ food, onLogged, onBack }: { food: SavedFood; onLogged: () => void; onBack: () => void }) {
  const services = useServices();
  const reference = food.referenceQuantity;
  // A reference amount of 0 cannot be scaled; such foods are logged at their saved values.
  const scalable = reference.amount > 0;
  const [amount, setAmount] = useState(toInputValue(reference.amount));
  const [error, setError] = useState<string | null>(null);

  const parsed = parseNonNegative(amount);
  const macros: Macros | null = !scalable
    ? food.macros
    : parsed === null
      ? null
      : scaleMacros(food.macros, reference, { amount: parsed, unit: reference.unit });

  const log = async (event: FormEvent) => {
    event.preventDefault();
    if (macros === null || parsed === null) {
      setError(NUMBER_ERROR);
      return;
    }
    const now = services.now();
    await services.log.confirmEntries([
      {
        name: food.name,
        quantity: scalable ? { amount: parsed, unit: reference.unit } : reference,
        macros,
        source: food.source,
        savedFoodId: food.id,
        dayKey: toDayKey(now),
        loggedAt: now.toISOString(),
      },
    ]);
    onLogged();
  };

  return (
    <form className="card stack" onSubmit={log} noValidate>
      <strong>{food.name}</strong>
      <div className="row">
        <label>
          Amount
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={amount}
            disabled={!scalable}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
          />
        </label>
        <span className="unit">{reference.unit}</span>
      </div>
      <FieldError message={error ?? undefined} />
      {macros && (
        <div role="group" aria-label="Will log" className="macro-list">
          <div>
            <span className="total-label">Protein</span> <strong>{formatGrams(macros.proteinG)}</strong>
          </div>
          <div>
            <span className="total-label">Calories</span> <strong>{formatKcal(macros.kcal)}</strong>
          </div>
          <div>
            <span className="total-label">Carbs</span> <strong>{formatGrams(macros.carbsG)}</strong>
          </div>
          <div>
            <span className="total-label">Fat</span> <strong>{formatGrams(macros.fatG)}</strong>
          </div>
        </div>
      )}
      <div className="row">
        <button type="submit" className="primary">
          Log
        </button>
        <button type="button" onClick={onBack}>
          Back to list
        </button>
      </div>
    </form>
  );
}
