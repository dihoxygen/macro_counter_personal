import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import type { SavedFood } from '../../data/records';
import { reviewTotal, type ReviewState } from '../../domain/review';
import type { Estimate } from '../../api/estimates';
import { RelogForm } from '../recent/RelogForm';
import { DescribeInput } from './DescribeInput';
import { ManualEntryForm } from './ManualEntryForm';
import { PhotoInput } from './PhotoInput';
import { QuickPicks } from './QuickPicks';
import { ReviewEstimate } from './ReviewEstimate';
import { useEstimateFlow } from './useEstimateFlow';
import { usePhotoSelection } from './usePhotoSelection';

type Method = 'describe' | 'photo' | 'manual';

const methods: { method: Method; label: string }[] = [
  { method: 'describe', label: 'Describe' },
  { method: 'photo', label: 'Photo' },
  { method: 'manual', label: 'Manual' },
];

interface Props {
  /** False while Today is hidden behind another view: the live camera is then turned off. */
  active: boolean;
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
export function Composer({ active, refreshKey, onLogged, onMoreRecent, onPendingChange }: Props) {
  const services = useServices();
  const offline = services.aiBlockedReason === 'offline';
  const [aiAvailable, setAiAvailable] = useState(!offline);
  const [method, setMethod] = useState<Method>(offline ? 'manual' : 'describe');
  const selection = usePhotoSelection();
  const [note, setNote] = useState('');
  const [describeDraft, setDescribeDraft] = useState('');
  const [manualKey, setManualKey] = useState(0);
  const [relog, setRelog] = useState<SavedFood | null>(null);
  // Repeats the last lookup for Retry: the same text, or the same (already re-encoded) photo and note.
  const lastRequest = useRef<(signal: AbortSignal) => Promise<Estimate>>(null);
  const focusInputNext = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardAreaRef = useRef<HTMLDivElement>(null);
  const flow = useEstimateFlow(() => undefined);
  const { phase } = flow;
  // One thing in the card area at a time: an estimate loading or under review, or a re-log (FR-005).
  const busy = phase.kind === 'loading' || phase.kind === 'review' || relog !== null;

  // AI lookup can be unavailable (not configured) or blocked (offline); manual entry always works (FR-010).
  useEffect(() => {
    if (offline) return;
    let isMounted = true;
    void services.getStatus().then((status) => {
      if (!isMounted) return;
      setAiAvailable(status.aiAvailable);
      if (!status.aiAvailable) setMethod('manual');
    });
    return () => {
      isMounted = false;
    };
  }, [services, offline]);

  useEffect(() => {
    onPendingChange(phase.kind === 'review' ? reviewTotal(phase.state).proteinG : 0);
  }, [phase, onPendingChange]);

  // Move focus to a card when it opens, and back to the field once it is confirmed (research R7). A layout
  // effect, so focus has moved by the time the change is painted.
  useLayoutEffect(() => {
    if (phase.kind === 'review') {
      cardAreaRef.current?.querySelector<HTMLElement>('[aria-label="Review estimate"]')?.focus();
    } else if (phase.kind === 'input' && focusInputNext.current) {
      focusInputNext.current = false;
      inputRef.current?.focus();
    }
  }, [phase.kind]);

  const lookUp = (request: (signal: AbortSignal) => Promise<Estimate>) => {
    lastRequest.current = request;
    void flow.run(request);
  };

  const estimateText = (text: string) => lookUp((signal) => services.estimateFromText(text, signal));
  const estimatePhoto = (jpeg: Blob, photoNote: string | undefined) =>
    lookUp((signal) => services.estimateFromPhoto(jpeg, photoNote, signal));

  const retry = () => {
    if (lastRequest.current) lookUp(lastRequest.current);
  };

  const confirm = async (state: ReviewState) => {
    await flow.confirm(state);
    if (method === 'photo') {
      selection.remove();
      setNote('');
    } else {
      setDescribeDraft('');
      focusInputNext.current = true;
    }
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

  const switchTo = (next: Method) => {
    flow.reset();
    setMethod(next);
  };

  const manualSaved = () => {
    setManualKey((k) => k + 1); // a fresh, empty form
    onLogged();
  };

  const recovery = (
    <div className="row">
      <button type="button" onClick={retry}>
        Retry
      </button>
      {method === 'photo' && (
        <button type="button" onClick={() => switchTo('describe')}>
          Describe in text
        </button>
      )}
      <button type="button" onClick={() => switchTo('manual')}>
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
            <span>
              {method === 'photo'
                ? 'Couldn’t identify food in this photo.'
                : 'Couldn’t identify food. Try describing it differently, or enter it manually.'}
            </span>
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

      {!aiAvailable && (
        <p className="warning">
          {offline
            ? 'Sign in or reconnect to use AI lookup. You can still enter the food manually.'
            : 'AI lookup is unavailable right now. You can still enter the food manually.'}
        </p>
      )}

      <div className="row" role="group" aria-label="Entry method">
        {methods.map(({ method: m, label }) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            disabled={busy || (!aiAvailable && m !== 'manual')}
            onClick={() => switchTo(m)}
          >
            {label}
          </button>
        ))}
      </div>

      <div hidden={method !== 'describe'}>
        <DescribeInput
          value={describeDraft}
          onChange={setDescribeDraft}
          onSend={estimateText}
          disabled={busy}
          inputRef={inputRef}
        />
      </div>
      <div hidden={method !== 'photo'}>
        <PhotoInput
          selection={selection}
          note={note}
          onNoteChange={setNote}
          onSend={estimatePhoto}
          disabled={busy}
          active={active && method === 'photo'}
        />
      </div>
      {/* Kept mounted while hidden, so a half-typed entry survives switching method (FR-011). */}
      <div hidden={method !== 'manual'}>
        <ManualEntryForm key={manualKey} onSaved={manualSaved} />
      </div>
    </section>
  );
}
