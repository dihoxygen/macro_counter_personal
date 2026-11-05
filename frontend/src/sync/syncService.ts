import type { SyncApi, SyncState } from '../api/sync';
import type { Changes } from '../data/changes';
import type { Db } from '../data/db';
import { quarantineCount, unsyncedCount } from '../data/outbox';
import { createSyncScheduler } from './scheduler';
import { createSyncEngine, type RoundOutcome } from './syncEngine';

/** What the status indicator shows (FR-010). */
export interface SyncSnapshot {
  started: boolean;
  online: boolean;
  outcome: RoundOutcome;
  running: boolean;
  pending: number;
  quarantined: number;
}

/** Everything the UI knows about sync: it never sees the engine, the transport or the outbox (Principle III). */
export interface SyncService {
  /** Begins syncing. Called once the notice has been acknowledged (FR-017). */
  start(): void;
  stop(): void;
  /**
   * Stops for good, and waits for a round in flight. Before signing out: a late request would find the session gone,
   * so nothing can start again from here, not even a state check that was still on its way.
   */
  drain(): Promise<void>;
  /** Undoes a drain, when signing out did not work after all. */
  resume(): void;
  notifyLocalChange(): void;
  getState(): Promise<SyncState>;
  acknowledgeNotice(): Promise<void>;
  pendingCount(): Promise<number>;
  /** True when this device holds everything, for the export note (FR-037). */
  isComplete(): Promise<boolean>;
  snapshot(): SyncSnapshot;
  subscribe(listener: () => void): () => void;
}

interface Deps {
  db: Db;
  api: SyncApi;
  changes: Changes;
  now: () => Date;
}

export function createSyncService({ db, api, changes, now }: Deps): SyncService {
  const engine = createSyncEngine({ db, api, changes, now });
  const scheduler = createSyncScheduler({ runRound: engine.runRound, outcome: engine.outcome });
  const listeners = new Set<() => void>();
  let snapshot: SyncSnapshot = {
    started: false,
    online: navigator.onLine,
    outcome: engine.outcome(),
    running: false,
    pending: 0,
    quarantined: 0,
  };

  async function refresh() {
    const [pending, quarantined] = await Promise.all([unsyncedCount(db), quarantineCount(db)]);
    snapshot = {
      ...snapshot,
      online: navigator.onLine,
      outcome: engine.outcome(),
      running: engine.isRunning(),
      pending,
      quarantined,
    };
    for (const listener of listeners) listener();
  }

  const onConnectivity = () => void refresh();
  let unsubscribeEngine = () => {};
  let drained = false;

  function start() {
    if (snapshot.started || drained) return;
    snapshot = { ...snapshot, started: true };
    // Here, not once at creation: stop() ends this, and React runs a mount twice in development.
    unsubscribeEngine = engine.subscribe(onConnectivity);
    window.addEventListener('online', onConnectivity);
    window.addEventListener('offline', onConnectivity);
    scheduler.start();
    void refresh();
  }

  function stop() {
    snapshot = { ...snapshot, started: false };
    scheduler.stop();
    unsubscribeEngine();
    window.removeEventListener('online', onConnectivity);
    window.removeEventListener('offline', onConnectivity);
  }

  return {
    start,
    stop,
    async drain() {
      drained = true;
      stop();
      await engine.settled();
    },
    resume() {
      drained = false;
      start();
    },
    notifyLocalChange() {
      scheduler.notifyLocalChange();
      void refresh();
    },
    getState: () => api.getState(),
    acknowledgeNotice: () => api.acknowledgeNotice(),
    pendingCount: () => unsyncedCount(db),
    isComplete: () => engine.isComplete(),
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
