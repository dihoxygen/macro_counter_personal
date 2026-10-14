import { useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import { ReviewEstimate } from './ReviewEstimate';
import { useEstimateFlow } from './useEstimateFlow';

interface Props {
  onConfirmed: () => void;
  onManual: () => void;
}

export function AddFoodText({ onConfirmed, onManual }: Props) {
  const services = useServices();
  const [description, setDescription] = useState('');
  const flow = useEstimateFlow(onConfirmed);
  const { phase } = flow;

  const estimate = () => {
    const text = description.trim();
    if (text === '') return;
    void flow.run((signal) => services.estimateFromText(text, signal));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    estimate();
  };

  if (phase.kind === 'review') {
    return <ReviewEstimate initial={phase.state} onConfirm={flow.confirm} onDiscard={flow.reset} />;
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label>
        What did you eat?
        <textarea
          rows={3}
          maxLength={500}
          value={description}
          placeholder="e.g. 2 scrambled eggs and a slice of whole wheat toast with butter"
          onChange={(e) => setDescription(e.target.value)}
          disabled={phase.kind === 'loading'}
        />
      </label>

      <SubmitOrProgress loading={phase.kind === 'loading'} onCancel={flow.cancel} />

      {phase.kind === 'unrecognized' && (
        <div className="warning stack">
          <span>Couldn’t identify food. Try describing it differently, or enter it manually.</span>
          <div className="row">
            <button type="button" onClick={estimate}>
              Retry
            </button>
            <button type="button" onClick={onManual}>
              Enter manually
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="stack">
          <p role="alert" className="error">
            {phase.message}
          </p>
          <div className="row">
            <button type="button" onClick={estimate}>
              Retry
            </button>
            <button type="button" onClick={onManual}>
              Enter manually
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

export function SubmitOrProgress({
  loading,
  disabled = false,
  onCancel,
}: {
  loading: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return loading ? (
    <div className="row">
      <span role="status">Estimating…</span>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ) : (
    <div className="row">
      <button type="submit" className="primary" disabled={disabled}>
        Estimate
      </button>
    </div>
  );
}
