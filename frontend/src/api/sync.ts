import { z } from 'zod';
import { EntryVersionSchema, LogEntrySchema, ProteinGoalSchema, SavedFoodSchema } from '../data/records';
import type { EntryVersion, LogEntry, ProteinGoal, SavedFood } from '../data/records';
import { apiFetch } from './http';

// The typed client for /api/sync (specs/007-cross-device-sync/contracts/sync-api.yaml).

const SyncStateSchema = z.object({ noticeAcknowledged: z.boolean(), revision: z.number().int() });
export type SyncState = z.infer<typeof SyncStateSchema>;

/** A record as it is pushed: restoredAt belongs to the server (research R15). */
export type PushedEntry = Omit<LogEntry, 'restoredAt'>;
export type PushedVersion = Omit<EntryVersion, 'restoredAt'>;

export type PushChange =
  | { type: 'entry'; op: 'upsert' | 'restore'; id: string; record: PushedEntry }
  | { type: 'food'; op: 'upsert'; id: string; record: SavedFood }
  | { type: 'goal'; op: 'upsert'; id: string; record: ProteinGoal }
  | { type: 'version'; op: 'insert'; id: string; record: PushedVersion }
  | { type: 'entry'; op: 'delete'; id: string; deletedAt: string };

export interface PushRequest {
  clientNow: string;
  changes: PushChange[];
}

const RecordType = z.enum(['entry', 'food', 'goal', 'version']);

const PushResponseSchema = z.object({
  revision: z.number().int(),
  results: z.array(
    z.object({
      type: RecordType,
      id: z.string(),
      status: z.enum(['applied', 'superseded', 'merged']),
      canonicalId: z.string().optional(),
    }),
  ),
});
export type PushResponse = z.infer<typeof PushResponseSchema>;

const PulledChangeSchema = z.union([
  z.object({ type: z.literal('entry'), revision: z.number().int(), record: LogEntrySchema }),
  z.object({ type: z.literal('food'), revision: z.number().int(), record: SavedFoodSchema }),
  z.object({ type: z.literal('goal'), revision: z.number().int(), record: ProteinGoalSchema }),
  z.object({ type: z.literal('version'), revision: z.number().int(), record: EntryVersionSchema }),
  z.object({
    type: z.enum(['entry', 'food', 'goal']),
    revision: z.number().int(),
    id: z.string(),
    deleted: z.literal(true),
  }),
]);
export type PulledChange = z.infer<typeof PulledChangeSchema>;

const PullResponseSchema = z.object({
  changes: z.array(PulledChangeSchema),
  cursor: z.number().int(),
  hasMore: z.boolean(),
  serverNow: z.string(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

export interface SyncApi {
  getState(): Promise<SyncState>;
  acknowledgeNotice(): Promise<void>;
  push(request: PushRequest): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
}

/**
 * The client for one account's local database. The cookie is shared by every tab, so each request says whose database
 * it is for, and the server refuses it if that is not the session's account (research R22).
 */
export function syncApiFor(userId: string): SyncApi {
  const headers = { 'X-Sync-Account': userId };
  return {
    async getState() {
      return SyncStateSchema.parse(await (await apiFetch('/api/sync/state', { headers })).json());
    },
    async acknowledgeNotice() {
      await apiFetch('/api/sync/notice', { method: 'POST', headers });
    },
    async push(request) {
      const response = await apiFetch('/api/sync/push', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      return PushResponseSchema.parse(await response.json());
    },
    async pull(since) {
      return PullResponseSchema.parse(await (await apiFetch(`/api/sync/changes?since=${since}`, { headers })).json());
    },
  };
}
