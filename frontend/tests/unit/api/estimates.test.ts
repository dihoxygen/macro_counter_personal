import { afterEach, describe, expect, it, vi } from 'vitest';
import { EstimateError, estimateFromPhoto, estimateFromText } from '../../../src/api/estimates';

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
    await expectError(estimateFromText('banana', new AbortController().signal), 'invalid_ai_response');
    stubFetch(async () => new Response('<html>', { status: 200 }));
    await expectError(estimateFromText('banana', new AbortController().signal), 'invalid_ai_response');
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
    expect(await estimateFromPhoto(jpeg, undefined, new AbortController().signal)).toEqual(bananaEstimate);
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
    await expectError(estimateFromPhoto(jpeg, undefined, new AbortController().signal), 'invalid_ai_response');
  });
});
