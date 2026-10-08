import { useEffect, useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import { toDayKey } from '../../domain/days';
import { goalForDay } from '../../domain/goals';
import { parseNonNegative } from '../shared/numberField';

const GOAL_ERROR = 'Enter a protein goal greater than 0 g';

/** Set, change or clear the daily protein goal. Changes apply from today on (FR-018, FR-020). */
export function GoalSettings({ onSaved }: { onSaved: () => void }) {
  const services = useServices();
  const today = toDayKey(services.now());
  const [current, setCurrent] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void services.goals.listAll().then((history) => {
      if (!active) return;
      const goal = goalForDay(history, today);
      setCurrent(goal);
      if (goal !== null) setValue(String(goal));
    });
    return () => {
      active = false;
    };
  }, [services, today]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const grams = parseNonNegative(value);
    if (grams === null || grams === 0) {
      setError(GOAL_ERROR);
      return;
    }
    await services.goals.setGoal(today, grams);
    onSaved();
  };

  const clear = async () => {
    await services.goals.setGoal(today, null);
    onSaved();
  };

  return (
    <form className="stack" onSubmit={save} noValidate>
      <p className="muted">
        This is a protein-focused app: your daily goal is shown on the main screen. Changes apply from today on;
        earlier days keep the goal they had.
      </p>
      <label>
        Daily protein goal (g)
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary">
          Save
        </button>
        {current !== null && (
          <button type="button" onClick={() => void clear()}>
            Clear goal
          </button>
        )}
      </div>
    </form>
  );
}
