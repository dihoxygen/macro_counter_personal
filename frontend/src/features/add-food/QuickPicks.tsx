import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { SavedFood } from '../../data/records';

const SHOWN = 5;

interface Props {
  /** Changing it reloads the list, e.g. after something was logged. */
  refreshKey: number;
  disabled: boolean;
  onPick: (food: SavedFood) => void;
  onMore: () => void;
}

/** The most recently used saved foods, one tap from Today (feature 004, FR-007). Renders nothing without any. */
export function QuickPicks({ refreshKey, disabled, onPick, onMore }: Props) {
  const services = useServices();
  const [foods, setFoods] = useState<SavedFood[]>([]);

  useEffect(() => {
    let active = true;
    void services.savedFoods.listRecent(SHOWN).then((list) => {
      if (active) setFoods(list);
    });
    return () => {
      active = false;
    };
  }, [services, refreshKey]);

  if (foods.length === 0) return null;

  return (
    <div role="group" aria-label="Recent foods" className="quick-picks">
      {foods.map((food) => (
        <button key={food.id} type="button" disabled={disabled} onClick={() => onPick(food)}>
          {food.name}
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={onMore}>
        More recent foods
      </button>
    </div>
  );
}
