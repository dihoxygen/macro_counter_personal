import { useState, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import { PhotoDecodeError } from '../../media/reencodePhoto';
import { SubmitOrProgress } from './AddFoodText';
import { ReviewEstimate } from './ReviewEstimate';
import { UserFacingError, useEstimateFlow } from './useEstimateFlow';

interface Props {
  onConfirmed: () => void;
  onText: () => void;
  onManual: () => void;
}

/** Log a meal from a photo (User Story 3). The photo is re-encoded on the device first. */
export function AddFoodPhoto({ onConfirmed, onText, onManual }: Props) {
  const services = useServices();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [missingPhoto, setMissingPhoto] = useState(false);
  const flow = useEstimateFlow(onConfirmed);
  const { phase } = flow;

  const estimate = () => {
    if (!file) {
      setMissingPhoto(true);
      return;
    }
    setMissingPhoto(false);
    void flow.run(async (signal) => {
      let jpeg: Blob;
      try {
        jpeg = await services.reencodePhoto(file);
      } catch (error) {
        if (error instanceof PhotoDecodeError) {
          throw new UserFacingError(`This image couldn’t be used. ${error.message}`);
        }
        throw error;
      }
      return services.estimateFromPhoto(jpeg, note.trim() || undefined, signal);
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    estimate();
  };

  if (phase.kind === 'review') {
    return <ReviewEstimate initial={phase.state} onConfirm={flow.confirm} onDiscard={flow.reset} />;
  }

  const recovery = (
    <div className="row">
      <button type="button" onClick={estimate}>
        Retry
      </button>
      <button type="button" onClick={onText}>
        Describe in text
      </button>
      <button type="button" onClick={onManual}>
        Enter manually
      </button>
    </div>
  );

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label>
        Photo of your meal
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={phase.kind === 'loading'}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {missingPhoto && (
        <p role="alert" className="error">
          Choose a photo first.
        </p>
      )}
      <label>
        Note (optional)
        <textarea
          rows={2}
          maxLength={300}
          value={note}
          placeholder="e.g. cooked in olive oil"
          onChange={(e) => setNote(e.target.value)}
          disabled={phase.kind === 'loading'}
        />
      </label>

      <SubmitOrProgress loading={phase.kind === 'loading'} onCancel={flow.cancel} />

      {phase.kind === 'unrecognized' && (
        <div className="warning stack">
          <span>Couldn’t identify food in this photo.</span>
          {recovery}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="stack">
          <p role="alert" className="error">
            {phase.message}
          </p>
          {recovery}
        </div>
      )}
    </form>
  );
}
