import { useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import { toDayKey } from '../../domain/days';
import { isImplausiblyLarge } from '../../domain/nutrition/plausibility';
import type { Macros, Quantity, Unit } from '../../domain/types';
import {
  entryFieldLabels,
  parseEntryForm,
  type EntryFormErrors,
  type EntryNumberField,
} from '../shared/entryForm';
import { FieldError, LargeValuesConfirm, NumberInput } from '../shared/FormBits';

/** Enter calories and macros without the AI (FR-008). */
export function ManualEntryForm({ onSaved }: { onSaved: () => void }) {
  const services = useServices();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('g');
  const [values, setValues] = useState<Record<EntryNumberField, string>>({
    amount: '',
    kcal: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
  });
  const [errors, setErrors] = useState<EntryFormErrors>({});
  const [pending, setPending] = useState<{ name: string; quantity: Quantity; macros: Macros } | null>(null);

  const save = async (entry: { name: string; quantity: Quantity; macros: Macros }) => {
    const now = services.now();
    await services.log.confirmEntries([
      {
        ...entry,
        source: 'manual',
        dayKey: toDayKey(now),
        loggedAt: now.toISOString(),
        savedFoodId: null,
      },
    ]);
    onSaved();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseEntryForm(name, unit, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    if (isImplausiblyLarge(parsed.quantity, parsed.macros)) {
      setPending(parsed);
      return;
    }
    await save(parsed);
  };

  const set = (key: EntryNumberField) => (value: string) => setValues((s) => ({ ...s, [key]: value }));

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label>
        Food name
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <FieldError message={errors.name} />

      <div className="field-grid">
        <div>
          <NumberInput label="Amount" value={values.amount} onChange={set('amount')} />
          <FieldError message={errors.amount} />
        </div>
        <label>
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="serving">serving</option>
          </select>
        </label>
        {(Object.keys(entryFieldLabels) as (keyof typeof entryFieldLabels)[]).map((key) => (
          <div key={key}>
            <NumberInput label={entryFieldLabels[key]} value={values[key]} onChange={set(key)} />
            <FieldError message={errors[key]} />
          </div>
        ))}
      </div>

      {pending ? (
        <LargeValuesConfirm onSave={() => void save(pending)} onBack={() => setPending(null)} />
      ) : (
        <div className="row">
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      )}
    </form>
  );
}
