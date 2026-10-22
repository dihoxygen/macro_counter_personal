import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, authEvents, setCsrfToken } from '../../../src/api/http';

const problem = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ title: 'x', status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => setCsrfToken(undefined));
afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('sends same-origin credentials and returns the ok response', async () => {
    const fetchMock = stubFetch(async () => Response.json({ ok: true }));
    const response = await apiFetch('/api/health');
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe('same-origin');
  });

  it('adds X-CSRF-Token on non-GET requests only', async () => {
    const fetchMock = stubFetch(async () => Response.json({}));
    setCsrfToken('tok-123');

    await apiFetch('/api/x', { method: 'POST', headers: { Accept: 'application/json' } });
    await apiFetch('/api/x', { method: 'DELETE' });
    await apiFetch('/api/x');
    await apiFetch('/api/x', { method: 'GET' });

    const headers = fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers));
    expect(headers[0]!.get('X-CSRF-Token')).toBe('tok-123');
    expect(headers[0]!.get('Accept')).toBe('application/json');
    expect(headers[1]!.get('X-CSRF-Token')).toBe('tok-123');
    expect(headers[2]!.has('X-CSRF-Token')).toBe(false);
    expect(headers[3]!.has('X-CSRF-Token')).toBe(false);
  });

  it('sends no CSRF header before a token is known', async () => {
    const fetchMock = stubFetch(async () => Response.json({}));
    await apiFetch('/api/x', { method: 'POST' });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has('X-CSRF-Token')).toBe(false);
  });

  it('on 401 unauthenticated, dispatches session-expired and throws ApiError(unauthenticated)', async () => {
    stubFetch(async () => problem(401, { code: 'unauthenticated' }));
    const listener = vi.fn();
    authEvents.addEventListener('session-expired', listener);
    try {
      const error = await caught(apiFetch('/api/status'));
      expect(error.code).toBe('unauthenticated');
      expect(error.status).toBe(401);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      authEvents.removeEventListener('session-expired', listener);
    }
  });

  it('treats a 401 without a recognizable body as unauthenticated too', async () => {
    stubFetch(async () => new Response('nope', { status: 401 }));
    const listener = vi.fn();
    authEvents.addEventListener('session-expired', listener);
    try {
      expect((await caught(apiFetch('/api/status'))).code).toBe('unauthenticated');
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      authEvents.removeEventListener('session-expired', listener);
    }
  });

  it('does not signal session expiry for a failed sign-in (401 sign_in_failed)', async () => {
    stubFetch(async () => problem(401, { code: 'sign_in_failed' }));
    const listener = vi.fn();
    authEvents.addEventListener('session-expired', listener);
    try {
      expect((await caught(apiFetch('/api/auth/sign-in', { method: 'POST' }))).code).toBe(
        'sign_in_failed',
      );
      expect(listener).not.toHaveBeenCalled();
    } finally {
      authEvents.removeEventListener('session-expired', listener);
    }
  });

  it('throws ApiError(network) when fetch itself fails', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await caught(apiFetch('/api/x'))).code).toBe('network');
  });

  it('rethrows AbortError unchanged', async () => {
    stubFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('parses the problem code and keeps the problem body for extra fields', async () => {
    stubFetch(async () =>
      problem(429, {
        code: 'quota_exceeded',
        scope: 'user_daily',
        resetAt: '2026-10-15T00:00:00Z',
      }),
    );
    const error = await caught(apiFetch('/api/estimates/text', { method: 'POST' }));
    expect(error.code).toBe('quota_exceeded');
    expect(error.problem).toMatchObject({ scope: 'user_daily', resetAt: '2026-10-15T00:00:00Z' });
  });

  it.each([
    [403, 'csrf_failed'],
    [429, 'rate_limited'],
    [503, 'unknown'],
    [418, 'unknown'],
  ])(
    'falls back to the status code when the body has no known code (%s → %s)',
    async (status, code) => {
      stubFetch(async () => problem(status, { code: 'something_new' }));
      const error = await caught(apiFetch('/api/x'));
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
    },
  );

  it('falls back to the status code when the body is not JSON', async () => {
    stubFetch(async () => new Response('<html>', { status: 403 }));
    expect((await caught(apiFetch('/api/x'))).code).toBe('csrf_failed');
  });
});
