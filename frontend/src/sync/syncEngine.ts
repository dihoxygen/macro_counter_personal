import { ApiError } from '../api/http';
import type { PushChange, PushRequest, SyncApi } from '../api/sync';
import type { Changes } from '../data/changes';
import type { Db, OutboxItem, OutboxKey } from '../data/db';
import { ack, peek, pendingCount, quarantine, quarantineCount } from '../data/outbox';
import { applyMerges, applyPulled, type Merge } from '../data/remoteApply';
import { refusalFor, type BoundsType } from '../data/syncBounds';

const PUSH_BATCH = 200;
const FIRST_PULL_DONE = 'sync.firstPullDone';

export type RoundOutcome =
  | { kind: 'idle' | 'ok' | 'offline' | 'off' | 'signed-out' }
  | { kind: 'failing'; retryAfterSeconds?: number };

export interface SyncEngine {
  /** Push, then pull (research R2). A call during a round joins it. */
  runRound(): Promise<void>;
  outcome(): RoundOutcome;
  isRunning(): boolean;
  /** Resolves once no round is running. */
  settled(): Promise<void>;
  /** True when this device holds everything: the first pull finished, nothing is queued or set aside (research R21). */
  isComplete(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

interface Deps {
  db: Db;
  api: SyncApi;
  changes: Changes;
  now: () => Date;
}

function splitKey(key: OutboxKey): { type: BoundsType; id: string } {
  const separator = key.indexOf(':');
  return { type: key.slice(0, separator) as BoundsType, id: key.slice(separator + 1) };
}

/** Reads the record a queued change refers to. Undefined means it is gone, and the change with it. */
async function buildChange(db: Db, item: OutboxItem): Promise<PushChange | undefined> {
  const { type, id } = splitKey(item.key);
  if (type === 'entry') {
    if (item.op === 'delete') return { type, op: 'delete', id, deletedAt: item.deletedAt! };
    const record = await db.get('entries', id);
    if (!record) return undefined;
    delete record.restoredAt; // The server's own (research R15).
    return { type, op: item.op === 'restore' ? 'restore' : 'upsert', id, record };
  }
  if (type === 'version') {
    const record = await db.get('entryVersions', id);
    if (!record) return undefined;
    delete record.restoredAt;
    return { type, op: 'insert', id, record };
  }
  if (type === 'food') {
    const record = await db.get('savedFoods', id);
    return record && { type, op: 'upsert', id, record };
  }
  const record = await db.get('proteinGoals', id);
  return record && { type, op: 'upsert', id, record };
}

const recordOf = (change: PushChange) => ('record' in change ? change.record : undefined);

interface InvalidChange {
  index: number;
  reason: string;
}

function invalidChanges(error: ApiError): InvalidChange[] {
  const invalid = error.problem?.invalid;
  return error.code === 'invalid_request' && Array.isArray(invalid) ? (invalid as InvalidChange[]) : [];
}

export function createSyncEngine({ db, api, changes, now }: Deps): SyncEngine {
  const listeners = new Set<() => void>();
  let outcome: RoundOutcome = { kind: 'idle' };
  let round: Promise<void> | undefined;
  let morePages = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Everything queued when the round began. Changes made during it wait for the next one. */
  async function push(): Promise<void> {
    const lastSeq = (await db.get('meta', 'outboxSeq')) as number;
    for (;;) {
      const items = (await peek(db, PUSH_BATCH)).filter((item) => item.seq <= lastSeq);
      if (items.length === 0) return;

      const sent: OutboxItem[] = [];
      const request: PushRequest = { clientNow: now().toISOString(), changes: [] };
      for (const item of items) {
        const change = await buildChange(db, item);
        const record = change && recordOf(change);
        const refusal = record && refusalFor(splitKey(item.key).type, record);
        if (!change) await ack(db, [item]);
        else if (refusal) await quarantine(db, item.key, refusal);
        else {
          sent.push(item);
          request.changes.push(change);
        }
      }
      if (request.changes.length === 0) continue;

      try {
        const response = await api.push(request);
        const merges: Merge[] = response.results.flatMap(({ type, id, status, canonicalId }) =>
          status === 'merged' && canonicalId && (type === 'food' || type === 'goal') ? [{ type, id, canonicalId }] : [],
        );
        await applyMerges(db, merges, changes);
        await ack(db, sent);
      } catch (error) {
        if (error instanceof ApiError) {
          for (const { index, reason } of invalidChanges(error)) {
            const item = sent[index];
            if (item) await quarantine(db, item.key, reason);
          }
        }
        throw error;
      }
    }
  }

  async function pull(): Promise<void> {
    for (;;) {
      const since = ((await db.get('meta', 'sync.cursor')) as number | undefined) ?? 0;
      const page = await api.pull(since);
      morePages = page.hasMore;
      await applyPulled(db, page.changes, page.cursor, page.serverNow, changes);
      if (!page.hasMore) {
        await db.put('meta', true, FIRST_PULL_DONE);
        return;
      }
    }
  }

  function outcomeOf(error: unknown): RoundOutcome {
    if (error instanceof ApiError) {
      if (error.code === 'network') return { kind: 'offline' };
      if (error.code === 'unauthenticated') return { kind: 'signed-out' };
      if (error.code === 'sync_notice_required') return { kind: 'off' };
      if (error.retryAfterSeconds !== undefined) return { kind: 'failing', retryAfterSeconds: error.retryAfterSeconds };
    }
    return { kind: 'failing' };
  }

  async function run(): Promise<void> {
    notify();
    try {
      await push();
      await pull();
      outcome = { kind: 'ok' };
    } catch (error) {
      outcome = outcomeOf(error);
    } finally {
      round = undefined;
      notify();
    }
  }

  return {
    runRound() {
      round ??= run();
      return round;
    },
    outcome: () => outcome,
    isRunning: () => round !== undefined,
    settled: () => round ?? Promise.resolve(),
    async isComplete() {
      const [firstPull, pending, setAside] = await Promise.all([
        db.get('meta', FIRST_PULL_DONE),
        pendingCount(db),
        quarantineCount(db),
      ]);
      return firstPull === true && !morePages && pending === 0 && setAside === 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
