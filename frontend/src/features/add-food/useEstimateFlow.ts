import { useRef, useState } from 'react';
import { EstimateError, type Estimate } from '../../api/estimates';
import { useServices } from '../../app/services';
import { startReview, toEntries, type ReviewState } from '../../domain/review';

export type Phase =
  | { kind: 'input' }
  | { kind: 'loading' }
  | { kind: 'review'; state: ReviewState }
  | { kind: 'unrecognized' }
  | { kind: 'error'; message: string };

/** The estimate lifecycle shared by text and photo entry: request → review → confirm (data-model.md). */
export function useEstimateFlow(onConfirmed: () => void) {
  const services = useServices();
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const controller = useRef<AbortController | null>(null);

  /** Runs a request; `request` may throw an EstimateError, or any Error with a user-facing message. */
  const run = async (request: (signal: AbortSignal) => Promise<Estimate>) => {
    const current = new AbortController();
    controller.current = current;
    setPhase({ kind: 'loading' });
    try {
      const estimate = await request(current.signal);
      if (current.signal.aborted) return;
      setPhase(estimate.recognized ? { kind: 'review', state: startReview(estimate) } : { kind: 'unrecognized' });
    } catch (error) {
      if (current.signal.aborted) return;
      setPhase({ kind: 'error', message: messageFor(error) });
    }
  };

  const cancel = () => {
    controller.current?.abort();
    setPhase({ kind: 'input' });
  };

  const reset = () => setPhase({ kind: 'input' });

  const confirm = async (state: ReviewState) => {
    await services.log.confirmEntries(toEntries(state, services.now()));
    onConfirmed();
  };

  return { phase, run, cancel, reset, confirm };
}

/** An error whose message is written for the user (e.g. a photo that cannot be read). */
export class UserFacingError extends Error {}

function messageFor(error: unknown): string {
  if (error instanceof EstimateError || error instanceof UserFacingError) return error.message;
  return new EstimateError('network').message;
}
