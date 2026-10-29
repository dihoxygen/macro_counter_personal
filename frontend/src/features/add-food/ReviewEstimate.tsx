import { useState } from 'react';
import { formatGrams, formatKcal } from '../../domain/nutrition/format';
import {
  acceptWarning,
  addItem,
  removeItem,
  canConfirm,
  editItem,
  needsAcceptance,
  reviewTotal,
  type ItemPatch,
  type ReviewItem,
  type ReviewState,
} from '../../domain/review';
import type { Macros, Quantity, Unit } from '../../domain/types';
import { entryFieldLabels, parseEntryForm, type EntryFormErrors, type EntryNumberField } from '../shared/entryForm';
import { FieldError, NumberInput } from '../shared/FormBits';
import { NUMBER_ERROR, parseNonNegative } from '../shared/numberField';

interface Props {
  initial: ReviewState;
  onConfirm: (state: ReviewState) => Promise<void>;
  onDiscard: () => void;
  /** Called with the state after every edit, not on first render (feature 004: pending protein). */
  onChange?: (state: ReviewState) => void;
}

/** Review, edit and confirm an AI estimate. Nothing is saved until Confirm (FR-006). */
export function ReviewEstimate({ initial, onConfirm, onDiscard, onChange }: Props) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const apply = (change: (s: ReviewState) => ReviewState) => {
    const next = change(state);
    setState(next);
    onChange?.(next);
  };

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm(state);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack" aria-label="Review estimate">
      <p>
        <span className="badge">AI estimate</span>{' '}
        <span className="muted">Check the values and edit anything that looks wrong.</span>
      </p>
      {state.items.map((item, index) => (
        <ReviewItemCard
          key={index}
          item={item}
          onEdit={(patch) => apply((s) => editItem(s, index, patch))}
          onAccept={() => apply((s) => acceptWarning(s, index))}
          onRemove={() => apply((s) => removeItem(s, index))}
        />
      ))}
      {adding ? (
        <NewItemForm
          onAdd={(item) => {
            apply((s) => addItem(s, item));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="row">
          <button type="button" onClick={() => setAdding(true)}>
            Add item
          </button>
        </div>
      )}
      {state.items.length > 1 && (
        <div role="group" aria-label="Total" className="card">
          <strong>Total</strong>
          <MacroList macros={reviewTotal(state)} />
        </div>
      )}
      <div className="row">
        <button type="button" className="primary" disabled={!canConfirm(state) || saving} onClick={confirm}>
          Confirm
        </button>
        <button type="button" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
      </div>
    </section>
  );
}

const warnings = {
  calorie_macro_mismatch: 'Calories don’t match the protein, carbs and fat. Check the values.',
  large_portion: 'This is an unusually large portion. Check the amount.',
} as const;

function ReviewItemCard({
  item,
  onEdit,
  onAccept,
  onRemove,
}: {
  item: ReviewItem;
  onEdit: (patch: ItemPatch) => void;
  onAccept: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div role="group" aria-label={item.name} className="card stack">
      <div>
        <strong>{item.name}</strong>
        <div className="muted">{item.portionDescription || formatPortion(item.portion)}</div>
      </div>
      {editing ? (
        <ItemEditor
          item={item}
          onDone={(patch) => {
            onEdit(patch);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <MacroList macros={item.macros} />
          <div className="row">
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </>
      )}
      {item.flags.length > 0 && (
        <div className="warning stack">
          {item.flags.map((flag) => (
            <span key={flag}>{warnings[flag]}</span>
          ))}
          {needsAcceptance(item) ? (
            <div className="row">
              <button type="button" onClick={onAccept}>
                Yes, these values are right
              </button>
            </div>
          ) : (
            <span className="muted">You accepted these values.</span>
          )}
        </div>
      )}
    </div>
  );
}

function MacroList({ macros }: { macros: Macros }) {
  return (
    <dl className="macro-list">
      <div>
        <dt>Calories</dt>
        <dd>{formatKcal(macros.kcal)}</dd>
      </div>
      <div>
        <dt>Protein</dt>
        <dd>{formatGrams(macros.proteinG)}</dd>
      </div>
      <div>
        <dt>Carbs</dt>
        <dd>{formatGrams(macros.carbsG)}</dd>
      </div>
      <div>
        <dt>Fat</dt>
        <dd>{formatGrams(macros.fatG)}</dd>
      </div>
    </dl>
  );
}

type Draft = Record<'amount' | 'kcal' | 'proteinG' | 'carbsG' | 'fatG', string>;

function ItemEditor({ item, onDone }: { item: ReviewItem; onDone: (patch: ItemPatch) => void }) {
  const [name, setName] = useState(item.name);
  const [draft, setDraft] = useState<Draft>({
    amount: String(item.portion.amount),
    kcal: String(item.macros.kcal),
    proteinG: String(item.macros.proteinG),
    carbsG: String(item.macros.carbsG),
    fatG: String(item.macros.fatG),
  });
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    const values = Object.fromEntries(
      Object.entries(draft).map(([key, raw]) => [key, parseNonNegative(raw)]),
    ) as Record<keyof Draft, number | null>;
    if (Object.values(values).some((v) => v === null)) {
      setError(NUMBER_ERROR);
      return;
    }
    if (name.trim() === '') {
      setError('Name is required.');
      return;
    }
    onDone({
      name: name.trim(),
      portion: { amount: values.amount!, unit: item.portion.unit },
      macros: {
        kcal: values.kcal!,
        proteinG: values.proteinG!,
        carbsG: values.carbsG!,
        fatG: values.fatG!,
      },
    });
  };

  const field = (key: keyof Draft, label: string) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="stack">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <div className="field-grid">
        {field('amount', `Amount (${item.portion.unit})`)}
        {field('kcal', 'Calories (kcal)')}
        {field('proteinG', 'Protein (g)')}
        {field('carbsG', 'Carbs (g)')}
        {field('fatG', 'Fat (g)')}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" onClick={done}>
          Done
        </button>
      </div>
    </div>
  );
}

function formatPortion(portion: Quantity): string {
  return `${toShort(portion.amount)} ${portion.unit}`;
}

function toShort(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Add a food the AI missed (photo review, US3). */
function NewItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (item: { name: string; portion: Quantity; macros: Macros }) => void;
  onCancel: () => void;
}) {
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
  const set = (key: EntryNumberField) => (value: string) => setValues((s) => ({ ...s, [key]: value }));

  const add = () => {
    const parsed = parseEntryForm(name, unit, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    onAdd({ name: parsed.name, portion: parsed.quantity, macros: parsed.macros });
  };

  return (
    <div role="group" aria-label="New item" className="card stack">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
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
      <div className="row">
        <button type="button" onClick={add}>
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
