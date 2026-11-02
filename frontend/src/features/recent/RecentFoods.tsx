import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { SavedFood } from '../../data/records';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import { toInputValue } from '../shared/entryForm';
import { RelogForm } from './RelogForm';

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
