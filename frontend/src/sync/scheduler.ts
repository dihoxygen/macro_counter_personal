import type { RoundOutcome } from './syncEngine';

const POLL_MS = 5_000;
const DEBOUNCE_MS = 500;
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export interface SyncScheduler {
  start(): void;
  stop(): void;
  /** A local change was saved: sync it soon (research R5). */
  notifyLocalChange(): void;
}

interface Deps {
  runRound: () => Promise<void>;
  outcome: () => RoundOutcome;
}

/**
 * When sync runs (research R5): every 5 s while the tab is visible and online, soon after a local change, and at once
 * on start, on returning to the tab and on reconnecting. Hidden tabs do not poll. Failures back off to a minute, and any
 * of those triggers starts over.
 */
export function createSyncScheduler({ runRound, outcome }: Deps): SyncScheduler {
  let started = false;
  let running = false;
  let runAgain = false;
  let failures = 0;
  let next: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const canRun = () => started && navigator.onLine && document.visibilityState === 'visible';

  function schedule(delay: number) {
    clearTimeout(next);
    next = setTimeout(() => void round(), delay);
  }

  function afterRound() {
    if (!started) return;
    if (runAgain) {
      runAgain = false;
      void round();
      return;
    }
    const result = outcome();
    if (result.kind === 'ok' || result.kind === 'idle') {
      failures = 0;
      schedule(POLL_MS);
    } else if (result.kind === 'failing' || result.kind === 'offline') {
      const backoff = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
      failures += 1;
      schedule(result.kind === 'failing' && result.retryAfterSeconds !== undefined ? result.retryAfterSeconds * 1000 : backoff);
    }
    // Signed out, or the notice is not acknowledged: nothing to do until something changes.
  }

  async function round() {
    if (running) {
      runAgain = true;
      return;
    }
    if (!canRun()) return;
    clearTimeout(next);
    running = true;
    try {
      await runRound();
    } finally {
      running = false;
      afterRound();
    }
  }

  /** Something happened that is worth trying again for, right away. */
  function trigger() {
    failures = 0;
    void round();
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') trigger();
  };

  return {
    start() {
      if (started) return;
      started = true;
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', trigger);
      trigger();
    },
    stop() {
      started = false;
      clearTimeout(next);
      clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', trigger);
    },
    notifyLocalChange() {
      if (!started) return;
      clearTimeout(debounce);
      debounce = setTimeout(trigger, DEBOUNCE_MS);
    },
  };
}
