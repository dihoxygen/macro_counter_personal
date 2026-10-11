import { useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import type { LogEntry } from '../../data/records';
import { isImplausiblyLarge } from '../../domain/nutrition/plausibility';
import { scaleMacros } from '../../domain/nutrition/scale';
import type { Macros, Quantity } from '../../domain/types';
import {
  entryFieldLabels,
  parseEntryForm,
  toInputValue,
  type EntryFormErrors,
  type EntryNumberField,
} from '../shared/entryForm';
import { parseNonNegative } from '../shared/numberField';
import { FieldError, LargeValuesConfirm, NumberInput } from '../shared/FormBits';

type MacroField = keyof typeof entryFieldLabels;

interface Props {
  entry: LogEntry;
  onClose: () => void;
  onChanged: () => void;
}

/** Edit or delete a logged entry (FR-010). Its dayKey never changes. */
export function EntryEditor({ entry, onClose, onChanged }: Props) {
  const services = useServices();
  const [name, setName] = useState(entry.name);
  const [values, setValues] = useState<Record<EntryNumberField, string>>(() =>
    draftFrom(entry.quantity.amount, entry.macros),
  );
  // Full-precision macros scaled from the original entry; used as long as the user has not typed macros.
  const [scaled, setScaled] = useState<Macros>(entry.macros);
  const [macrosTouched, setMacrosTouched] = useState(false);
  const [errors, setErrors] = useState<EntryFormErrors>({});
  const [pending, setPending] = useState<{ name: string; quantity: Quantity; macros: Macros } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const changeAmount = (raw: string) => {
    setValues((v) => ({ ...v, amount: raw }));
    const amount = parseNonNegative(raw);
    if (macrosTouched || amount === null || entry.quantity.amount === 0) return;
    const next = scaleMacros(entry.macros, entry.quantity, { amount, unit: entry.quantity.unit });
    setScaled(next);
    setValues((v) => ({ ...v, ...draftFrom(amount, next), amount: raw }));
  };

  const changeMacro = (key: MacroField) => (raw: string) => {
    setMacrosTouched(true);
    setValues((v) => ({ ...v, [key]: raw }));
  };

  const save = async (update: { name: string; quantity: Quantity; macros: Macros }) => {
    await services.entries.update(entry.id, {
      name: update.name,
      quantity: update.quantity,
      macros: update.macros,
      source: macrosTouched && entry.source === 'ai' ? 'ai-edited' : entry.source,
    });
    onChanged();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseEntryForm(name, entry.quantity.unit, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const update = { ...parsed, macros: macrosTouched ? parsed.macros : scaled };
    if (isImplausiblyLarge(update.quantity, update.macros)) {
      setPending(update);
      return;
    }
    await save(update);
  };

  const remove = async () => {
    await services.entries.delete(entry.id);
    onChanged();
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={`Edit ${entry.name}`}>
      <label>
        Food name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <FieldError message={errors.name} />
      <div className="field-grid">
        <div>
          <NumberInput label={`Amount (${entry.quantity.unit})`} value={values.amount} onChange={changeAmount} />
          <FieldError message={errors.amount} />
        </div>
        {(Object.keys(entryFieldLabels) as MacroField[]).map((key) => (
          <div key={key}>
            <NumberInput label={entryFieldLabels[key]} value={values[key]} onChange={changeMacro(key)} />
            <FieldError message={errors[key]} />
          </div>
        ))}
      </div>

      {pending ? (
        <LargeValuesConfirm onSave={() => void save(pending)} onBack={() => setPending(null)} />
      ) : confirmingDelete ? (
        <div className="warning stack">
          <span>Delete this entry? Its values will be removed from that day’s totals.</span>
          <div className="row">
            <button type="button" className="primary" onClick={() => void remove()}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="submit" className="primary">
            Save
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      )}
    </form>
  );
}

function draftFrom(amount: number, macros: Macros): Record<EntryNumberField, string> {
  return {
    amount: toInputValue(amount),
    kcal: toInputValue(macros.kcal),
    proteinG: toInputValue(macros.proteinG),
    carbsG: toInputValue(macros.carbsG),
    fatG: toInputValue(macros.fatG),
  };
}
