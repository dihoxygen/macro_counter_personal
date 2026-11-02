import type { FormEvent, KeyboardEvent, Ref } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  onFocus?: () => void;
}

/** The composer's description field (feature 004). Enter sends; Shift+Enter adds a new line (FR-015). */
export function DescribeInput({ value, onChange, onSend, disabled, inputRef, onFocus }: Props) {
  const send = () => {
    const text = value.trim();
    if (text !== '') onSend(text);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <form className="describe-input" onSubmit={submit} noValidate>
      <label>
        What did you eat?
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={500}
          enterKeyHint="send"
          value={value}
          placeholder="e.g. 2 scrambled eggs and a slice of whole wheat toast with butter"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keyDown}
          onFocus={onFocus}
          disabled={disabled}
        />
      </label>
      <button type="submit" className="primary" disabled={disabled}>
        Estimate
      </button>
    </form>
  );
}
