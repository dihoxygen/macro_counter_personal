import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setCsrfToken } from '../../../src/api/http';
import { syncApiFor } from '../../../src/api/sync';

const USER = '6f1c2a4e-0000-4000-8000-000000000001';
const syncApi = syncApiFor(USER);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const problem = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/problem+json', ...headers } });

const entry = {
  id: 'e1',
  versionId: 'v1',
  createdAt: '2026-11-04T08:00:00.000Z',
  updatedAt: '2026-11-04T08:00:00.000Z',
  schemaVersion: 1,
  dayKey: '2026-11-04',
  loggedAt: '2026-11-04T08:00:00.000Z',
  name: 'Banana',
  quantity: { amount: 120, unit: 'g' },
  macros: { kcal: 107, proteinG: 1.3, carbsG: 27.5, fatG: 0.4 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
  restoredAt: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCsrfToken('token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(undefined);
});

describe('getState', () => {
  it('reads the state', async () => {
    fetchMock.mockResolvedValue(json({ noticeAcknowledged: true, revision: 4 }));

    expect(await syncApi.getState()).toEqual({ noticeAcknowledged: true, revision: 4 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sync/state');
  });
});

describe('acknowledgeNotice', () => {
  it('posts with the CSRF token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await syncApi.acknowledgeNotice();

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/sync/notice');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('token');
  });
});

describe('push', () => {
  it('sends the device time and changes, and reads the results', async () => {
    fetchMock.mockResolvedValue(
      json({ revision: 3, results: [{ type: 'food', id: 'f2', status: 'merged', canonicalId: 'f1' }] }),
    );

    const result = await syncApi.push({ clientNow: '2026-11-04T08:00:00.000Z', changes: [] });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/sync/push');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('token');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ clientNow: '2026-11-04T08:00:00.000Z', changes: [] });
    expect(result.results[0]).toEqual({ type: 'food', id: 'f2', status: 'merged', canonicalId: 'f1' });
  });

  it('rejects an answer that does not match the contract', async () => {
    fetchMock.mockResolvedValue(json({ revision: 'three', results: [] }));

    await expect(syncApi.push({ clientNow: 'x', changes: [] })).rejects.toThrow();
  });
});

describe('pull', () => {
  it('reads every kind of change', async () => {
    fetchMock.mockResolvedValue(
      json({
        changes: [
          { type: 'entry', revision: 1, record: entry },
          { type: 'entry', revision: 2, id: 'e2', deleted: true },
          {
            type: 'version',
            revision: 3,
            record: { ...entry, id: 'v0', versionId: undefined, entryId: 'e1', changeType: 'edit', replacedAt: entry.updatedAt },
          },
        ],
        cursor: 3,
        hasMore: false,
        serverNow: '2026-11-04T09:00:00.000Z',
      }),
    );

    const page = await syncApi.pull(0);

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sync/changes?since=0');
    expect(page.cursor).toBe(3);
    expect(page.serverNow).toBe('2026-11-04T09:00:00.000Z');
    expect(page.changes.map((c) => c.type)).toEqual(['entry', 'entry', 'version']);
    expect(page.changes[1]).toEqual({ type: 'entry', revision: 2, id: 'e2', deleted: true });
  });

  it('rejects a record that does not match its type', async () => {
    fetchMock.mockResolvedValue(
      json({ changes: [{ type: 'entry', revision: 1, record: { id: 'e1' } }], cursor: 1, hasMore: false, serverNow: 'x' }),
    );

    await expect(syncApi.pull(0)).rejects.toThrow();
  });
});

describe('errors', () => {
  async function codeFor(response: Response) {
    fetchMock.mockResolvedValue(response);
    return syncApi.pull(0).catch((error: unknown) => error as ApiError);
  }

  it.each([
    [409, 'sync_notice_required'],
    [400, 'too_many_changes'],
    [503, 'service_unavailable'],
    [401, 'unauthenticated'],
  ])('maps %i %s', async (status, code) => {
    expect(await codeFor(problem(status, { code }))).toMatchObject({ code, status });
  });

  it('carries the invalid changes', async () => {
    const error = await codeFor(problem(400, { code: 'invalid_request', invalid: [{ index: 1, reason: 'invalid_record' }] }));

    expect((error as ApiError).problem).toMatchObject({ invalid: [{ index: 1, reason: 'invalid_record' }] });
  });

  it('carries Retry-After on a rate limit', async () => {
    const error = await codeFor(problem(429, { code: 'rate_limited' }, { 'Retry-After': '12' }));

    expect(error).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 12 });
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));

    await expect(syncApi.pull(0)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('the account a tab belongs to', () => {
  it('goes with every request, so the server can refuse a stale tab', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/notice')
        ? new Response(null, { status: 204 })
        : json(
            url.endsWith('/state')
              ? { noticeAcknowledged: true, revision: 0 }
              : url.endsWith('/push')
                ? { revision: 0, results: [] }
                : { changes: [], cursor: 0, hasMore: false, serverNow: 'x' },
          ),
    );

    await syncApi.getState();
    await syncApi.acknowledgeNotice();
    await syncApi.push({ clientNow: 'x', changes: [] });
    await syncApi.pull(0);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('X-Sync-Account')).toBe(USER);
    }
  });
});
