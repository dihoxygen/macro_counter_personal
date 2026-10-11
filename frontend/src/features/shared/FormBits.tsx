export function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span role="alert" className="error">
      {message}
    </span>
  );
}

/** Second step shown before saving values above the plausibility limits. */
export function LargeValuesConfirm({ onSave, onBack }: { onSave: () => void; onBack: () => void }) {
  return (
    <div className="warning stack">
      <span>These values are unusually large. Check them before saving.</span>
      <div className="row">
        <button type="button" className="primary" onClick={onSave}>
          Save anyway
        </button>
        <button type="button" onClick={onBack}>
          Go back
        </button>
      </div>
    </div>
  );
}
