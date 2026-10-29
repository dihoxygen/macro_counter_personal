import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import type { SavedFood } from '../../data/records';
import { reviewTotal, type ReviewState } from '../../domain/review';
import { DescribeInput } from './DescribeInput';
import { RelogForm } from '../recent/RelogForm';
import { ManualEntryForm } from './ManualEntryForm';
import { QuickPicks } from './QuickPicks';
import { ReviewEstimate } from './ReviewEstimate';
import { useEstimateFlow } from './useEstimateFlow';

type Method = 'describe' | 'manual';

const methods: { method: Method; label: string }[] = [
  { method: 'describe', label: 'Describe' },
  { method: 'manual', label: 'Manual' },
];

interface Props {
  /** Changes whenever Today reloads (after logging, or on coming back to Today). */
  refreshKey: number;
  /** Called after something was logged, so Today reloads its entries and totals. */
  onLogged: () => void;
  /** Opens the full Recent foods screen (FR-008). */
  onMoreRecent: () => void;
  /** The protein of the card under review, or 0 when none is open (FR-004). */
  onPendingChange: (proteinG: number) => void;
}

/**
 * Logging on Today (feature 004): one input for every method, and one estimate flow, so at most one estimate
 * is pending (FR-005). Its review card appears here, above the input, instead of on a separate screen.
 */
export function Composer({ refreshKey, onLogged, onMoreRecent, onPendingChange }: Props) {
  const services = useServices();
  const [method, setMethod] = useState<Method>('describe');
  const [describeDraft, setDescribeDraft] = useState('');
  const [manualKey, setManualKey] = useState(0);
  const [relog, setRelog] = useState<SavedFood | null>(null);
  const lastText = useRef('');
  const focusInputNext = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardAreaRef = useRef<HTMLDivElement>(null);
  const flow = useEstimateFlow(() => undefined);
  const { phase } = flow;
  // One thing in the card area at a time: an estimate loading or under review, or a re-log (FR-005).
  const busy = phase.kind === 'loading' || phase.kind === 'review' || relog !== null;

  useEffect(() => {
    onPendingChange(phase.kind === 'review' ? reviewTotal(phase.state).proteinG : 0);
  }, [phase, onPendingChange]);

  // Move focus to a card when it opens, and back to the field once it is confirmed (research R7).
  useEffect(() => {
    if (phase.kind === 'review') {
      cardAreaRef.current?.querySelector<HTMLElement>('[aria-label="Review estimate"]')?.focus();
    } else if (phase.kind === 'input' && focusInputNext.current) {
      focusInputNext.current = false;
      inputRef.current?.focus();
    }
  }, [phase.kind]);

  const estimate = (text: string) => {
    lastText.current = text;
    void flow.run((signal) => services.estimateFromText(text, signal));
  };

  const confirm = async (state: ReviewState) => {
    await flow.confirm(state);
    setDescribeDraft('');
    focusInputNext.current = true;
    flow.reset();
    onLogged();
  };

  const pick = (food: SavedFood) => {
    flow.reset(); // a quick pick replaces an error or "couldn't identify" message
    setRelog(food);
  };

  const relogged = () => {
    setRelog(null);
    onLogged();
  };

  const enterManually = () => {
    flow.reset();
    setMethod('manual');
  };

  const manualSaved = () => {
    setManualKey((k) => k + 1); // a fresh, empty form
    setMethod('describe');
    onLogged();
  };

  const recovery = (
    <div className="row">
      <button type="button" onClick={() => estimate(lastText.current)}>
        Retry
      </button>
      <button type="button" onClick={enterManually}>
        Enter manually
      </button>
    </div>
  );

  return (
    <section aria-label="Log food" className="composer stack">
      <div ref={cardAreaRef} className="card-area">
        {phase.kind === 'loading' && (
          <div className="row">
            <span role="status">Estimating…</span>
            <button type="button" onClick={flow.cancel}>
              Cancel
            </button>
          </div>
        )}
        {phase.kind === 'review' && (
          <ReviewEstimate
            initial={phase.state}
            onConfirm={confirm}
            onDiscard={flow.reset}
            onChange={(state) => onPendingChange(reviewTotal(state).proteinG)}
          />
        )}
        {phase.kind === 'unrecognized' && (
          <div className="warning stack">
            <span>Couldn’t identify food. Try describing it differently, or enter it manually.</span>
            {recovery}
          </div>
        )}
        {relog && (
          <RelogForm key={relog.id} food={relog} onLogged={relogged} onBack={() => setRelog(null)} backLabel="Cancel" />
        )}
        {phase.kind === 'error' && (
          <div className="stack">
            <p role="alert" className="error">
              {phase.message}
            </p>
            {recovery}
          </div>
        )}
      </div>

      <QuickPicks refreshKey={refreshKey} disabled={busy} onPick={pick} onMore={onMoreRecent} />

      <div className="row" role="group" aria-label="Entry method">
        {methods.map(({ method: m, label }) => (
          <button key={m} type="button" aria-pressed={method === m} disabled={busy} onClick={() => setMethod(m)}>
            {label}
          </button>
        ))}
      </div>

      <div hidden={method !== 'describe'}>
        <DescribeInput
          value={describeDraft}
          onChange={setDescribeDraft}
          onSend={estimate}
          disabled={busy}
          inputRef={inputRef}
        />
      </div>
      {method === 'manual' && <ManualEntryForm key={manualKey} onSaved={manualSaved} />}
    </section>
  );
}
