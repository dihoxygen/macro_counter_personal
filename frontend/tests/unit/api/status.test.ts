import { afterEach, describe, expect, it, vi } from 'vitest';
import { authEvents } from '../../../src/api/http';
import { getStatus } from '../../../src/api/status';

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getStatus', () => {
  it('GETs /api/status and returns aiAvailable', async () => {
    const fetchMock = stubFetch(async () => Response.json({ aiAvailable: true }));
    expect(await getStatus()).toEqual({ aiAvailable: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.anything());
  });

  it('returns aiAvailable:false when the server says so', async () => {
    stubFetch(async () => Response.json({ aiAvailable: false }));
    expect(await getStatus()).toEqual({ aiAvailable: false });
  });

  it('returns false on a network error', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await getStatus()).toEqual({ aiAvailable: false });
  });

  it('treats a 401 (signed out) as not available, and asks for sign-in', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ title: 'x', status: 401, code: 'unauthenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    );
    const expired = vi.fn();
    authEvents.addEventListener('session-expired', expired);
    try {
      expect(await getStatus()).toEqual({ aiAvailable: false });
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      authEvents.removeEventListener('session-expired', expired);
    }
  });

  it('returns false on a non-2xx response', async () => {
    stubFetch(async () => new Response('down', { status: 502 }));
    expect(await getStatus()).toEqual({ aiAvailable: false });
  });

  it('returns false on a malformed body', async () => {
    stubFetch(async () => Response.json({ aiAvailable: 'yes' }));
    expect(await getStatus()).toEqual({ aiAvailable: false });
    stubFetch(async () => new Response('<html>', { status: 200 }));
    expect(await getStatus()).toEqual({ aiAvailable: false });
  });
});
