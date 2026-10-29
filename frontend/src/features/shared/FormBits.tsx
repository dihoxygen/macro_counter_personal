import { useId, useState } from 'react';

/**
 * A password field the person can reveal while typing (ASVS 2.1.12). Paste and password managers still work.
 * The button is named just "Show"/"Hide" (tied to its field by aria-controls), so the field's label stays unique.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  maxLength?: number;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="password-field">
      <label>
        {label}
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={maxLength}
        />
      </label>
      <button type="button" aria-controls={id} onClick={() => setShown(!shown)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

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
