import { afterEach, describe, expect, it, vi } from 'vitest';
import { EstimateError, estimateFromPhoto, estimateFromText } from '../../../src/api/estimates';
import { setCsrfToken } from '../../../src/api/http';

export const bananaEstimate = {
  recognized: true,
  items: [
    {
      name: 'Banana',
      portion: { amount: 118, unit: 'g' },
      portionDescription: '1 medium banana (~118 g)',
      macros: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
      flags: [],
    },
  ],
  total: { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4 },
  flags: [],
};

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ title: 'x', status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EstimateError);
  expect((error as EstimateError).code).toBe(code);
}

describe('estimateFromText', () => {
  it('POSTs only {description} as JSON to /api/estimates/text', async () => {
    const fetchMock = stubFetch(async () => Response.json(bananaEstimate));
    await estimateFromText('1 medium banana', new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/estimates/text');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ description: '1 medium banana' });
  });

  it('parses and returns the estimate', async () => {
    stubFetch(async () => Response.json(bananaEstimate));
    expect(await estimateFromText('banana', new AbortController().signal)).toEqual(bananaEstimate);
  });

  it.each([
    [400, 'invalid_request'],
    [502, 'invalid_ai_response'],
    [503, 'ai_unavailable'],
    [504, 'ai_timeout'],
    [413, 'image_too_large'],
    [415, 'unsupported_media_type'],
  ])('maps a %s problem to %s', async (status, code) => {
    stubFetch(async () => problem(status, code));
    await expectError(estimateFromText('banana', new AbortController().signal), code);
  });

  it('maps an unknown problem body by status (503 → ai_unavailable)', async () => {
    stubFetch(async () => new Response('Service Unavailable', { status: 503 }));
    await expectError(estimateFromText('banana', new AbortController().signal), 'ai_unavailable');
  });

  it('maps an unexpected error status to network', async () => {
    stubFetch(async () => new Response('teapot', { status: 418 }));
    await expectError(estimateFromText('banana', new AbortController().signal), 'network');
  });

  it('turns a malformed 200 body into invalid_ai_response', async () => {
    stubFetch(async () => Response.json({ ...bananaEstimate, total: { kcal: -1 } }));
    await expectError(
      estimateFromText('banana', new AbortController().signal),
      'invalid_ai_response',
    );
    stubFetch(async () => new Response('<html>', { status: 200 }));
    await expectError(
      estimateFromText('banana', new AbortController().signal),
      'invalid_ai_response',
    );
  });

  it('maps a network failure to network', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expectError(estimateFromText('banana', new AbortController().signal), 'network');
  });

  it('rejects with AbortError when the signal aborts', async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const controller = new AbortController();
    const promise = estimateFromText('banana', controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps a 401 to unauthenticated with a sign-in-again message', async () => {
    stubFetch(async () => problem(401, 'unauthenticated'));
    const error = await estimateFromText('banana', new AbortController().signal).catch((e) => e);
    expect((error as EstimateError).code).toBe('unauthenticated');
    expect((error as EstimateError).message).toBe(
      'Sign in again to use AI lookup. Your entries are safe.',
    );
  });

  it('sends the CSRF token and same-origin credentials', async () => {
    const fetchMock = stubFetch(async () => Response.json(bananaEstimate));
    setCsrfToken('csrf-1');
    try {
      await estimateFromText('banana', new AbortController().signal);
    } finally {
      setCsrfToken(undefined);
    }
    const init = fetchMock.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-1');
    expect(init?.credentials).toBe('same-origin');
  });

  describe('AI limits (FR-021)', () => {
    const resetAt = '2026-10-15T00:00:00Z';
    const quota = (scope: string) =>
      new Response(
        JSON.stringify({ title: 'x', status: 429, code: 'quota_exceeded', scope, resetAt }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '3600' },
        },
      );

    it('the daily personal limit says when it resets, in local time, and that manual entry still works', async () => {
      stubFetch(async () => quota('user_daily'));
      const error = (await estimateFromText('banana', new AbortController().signal).catch(
        (e) => e,
      )) as EstimateError;

      const time = new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(resetAt));
      expect(error.code).toBe('quota_exceeded');
      expect(error.message).toBe(
        `You've reached today's AI lookup limit. It resets at ${time}. You can still add food manually.`,
      );
    });

    it.each(['global_daily', 'global_monthly'])(
      'the overall %s limit says so, with the date and time',
      async (scope) => {
        stubFetch(async () => quota(scope));
        const error = (await estimateFromText('banana', new AbortController().signal).catch(
          (e) => e,
        )) as EstimateError;

        const when = new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(resetAt));
        expect(error.message).toBe(
          `AI lookup has reached its overall limit for now. It resets at ${when}. You can still add food manually.`,
        );
      },
    );

    it('a quota problem without a usable reset time still explains itself', async () => {
      stubFetch(async () => problem(429, 'quota_exceeded'));
      const error = (await estimateFromText('banana', new AbortController().signal).catch(
        (e) => e,
      )) as EstimateError;
      expect(error.message).toBe(
        "You've reached the AI lookup limit for now. You can still add food manually.",
      );
    });

    it('the per-minute limit asks to wait a minute', async () => {
      stubFetch(async () => problem(429, 'rate_limited'));
      await expectError(estimateFromText('banana', new AbortController().signal), 'rate_limited');
      const error = (await estimateFromText('banana', new AbortController().signal).catch(
        (e) => e,
      )) as EstimateError;
      expect(error.message).toBe('Too many lookups in a short time. Wait a minute and try again.');
    });
  });

  it('gives every error a human-readable message', async () => {
    stubFetch(async () => problem(503, 'ai_unavailable'));
    const error = await estimateFromText('banana', new AbortController().signal).catch((e) => e);
    expect((error as EstimateError).message.length).toBeGreaterThan(10);
  });
});

describe('estimateFromPhoto', () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

  it('POSTs multipart with only the photo when there is no note', async () => {
    const fetchMock = stubFetch(async () => Response.json(bananaEstimate));
    await estimateFromPhoto(jpeg, undefined, new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/estimates/photo');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(['photo']);
    const photo = form.get('photo') as File;
    expect(photo.type).toBe('image/jpeg');
    expect(photo.size).toBe(4);
    // The browser sets the multipart boundary; we must not set Content-Type ourselves.
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('adds the note when present, and nothing else', async () => {
    const fetchMock = stubFetch(async () => Response.json(bananaEstimate));
    await estimateFromPhoto(jpeg, 'cooked in olive oil', new AbortController().signal);

    const form = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect([...form.keys()]).toEqual(['photo', 'note']);
    expect(form.get('note')).toBe('cooked in olive oil');
  });

  it('leaves out a blank note', async () => {
    const fetchMock = stubFetch(async () => Response.json(bananaEstimate));
    await estimateFromPhoto(jpeg, '   ', new AbortController().signal);
    expect([...(fetchMock.mock.calls[0]![1]?.body as FormData).keys()]).toEqual(['photo']);
  });

  it('parses the estimate like the text path', async () => {
    stubFetch(async () => Response.json(bananaEstimate));
    expect(await estimateFromPhoto(jpeg, undefined, new AbortController().signal)).toEqual(
      bananaEstimate,
    );
  });

  it.each([
    [413, 'image_too_large'],
    [415, 'unsupported_media_type'],
    [503, 'ai_unavailable'],
  ])('maps a %s problem to %s', async (status, code) => {
    stubFetch(async () => problem(status, code));
    await expectError(estimateFromPhoto(jpeg, undefined, new AbortController().signal), code);
  });

  it('maps a malformed 200 body to invalid_ai_response', async () => {
    stubFetch(async () => Response.json({ nope: true }));
    await expectError(
      estimateFromPhoto(jpeg, undefined, new AbortController().signal),
      'invalid_ai_response',
    );
  });
});
