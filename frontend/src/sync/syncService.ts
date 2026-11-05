import type { SyncApi, SyncState } from '../api/sync';
import type { Changes } from '../data/changes';
import type { Db } from '../data/db';
import { pendingCount, quarantineCount } from '../data/outbox';
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
    const [pending, quarantined] = await Promise.all([pendingCount(db), quarantineCount(db)]);
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
  const unsubscribeEngine = engine.subscribe(onConnectivity);

  return {
    start() {
      if (snapshot.started) return;
      snapshot = { ...snapshot, started: true };
      window.addEventListener('online', onConnectivity);
      window.addEventListener('offline', onConnectivity);
      scheduler.start();
      void refresh();
    },
    stop() {
      snapshot = { ...snapshot, started: false };
      scheduler.stop();
      unsubscribeEngine();
      window.removeEventListener('online', onConnectivity);
      window.removeEventListener('offline', onConnectivity);
    },
    notifyLocalChange() {
      scheduler.notifyLocalChange();
      void refresh();
    },
    getState: () => api.getState(),
    acknowledgeNotice: () => api.acknowledgeNotice(),
    pendingCount: () => pendingCount(db),
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
