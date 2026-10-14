import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  acknowledgeNotice,
  getSession,
  setupPassword,
  setupTotpConfirm,
  setupTotpStart,
  signIn,
  signOut,
  signOutEverywhere,
} from '../../../src/api/auth';
import { setCsrfToken } from '../../../src/api/http';

const user = { id: '6f1c2a4e-0000-4000-8000-000000000001', username: 'alice', role: 'user' };

const problem = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ title: 'x', status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function caught(promise: Promise<unknown>): Promise<AuthError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AuthError);
  return error as AuthError;
}

beforeEach(() => setCsrfToken(undefined));
afterEach(() => vi.unstubAllGlobals());

describe('auth client', () => {
  it('getSession GETs the session state and adopts its CSRF token', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ state: 'signed_out', csrfToken: 'csrf-1' }),
    );

    expect(await getSession()).toEqual({ state: 'signed_out', csrfToken: 'csrf-1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/session');

    const next = stubFetch(async () => new Response(null, { status: 204 }));
    await signOut();
    expect(new Headers(next.mock.calls[0]![1]?.headers).get('X-CSRF-Token')).toBe('csrf-1');
  });

  it('signIn POSTs exactly username, password and code, and adopts the new token', async () => {
    setCsrfToken('csrf-0');
    const fetchMock = stubFetch(async () =>
      Response.json({ state: 'signed_in', csrfToken: 'csrf-9', user }),
    );

    const state = await signIn('alice', 'secret passphrase', '123456');

    expect(state).toEqual({ state: 'signed_in', csrfToken: 'csrf-9', user });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/sign-in');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      username: 'alice',
      password: 'secret passphrase',
      code: '123456',
    });
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-0');

    const after = stubFetch(async () => new Response(null, { status: 204 }));
    await signOut();
    expect(new Headers(after.mock.calls[0]![1]?.headers).get('X-CSRF-Token')).toBe('csrf-9');
  });

  it('signIn leaves out a blank code', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ state: 'setup', csrfToken: 'c', setupStep: 'password' }),
    );
    await signIn('alice', 'TEMP-CODE', '   ');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      username: 'alice',
      password: 'TEMP-CODE',
    });
  });

  it('rejects a malformed session state', async () => {
    stubFetch(async () =>
      Response.json({ state: 'signed_in', csrfToken: 'c', user: { id: 'not-a-uuid' } }),
    );
    expect((await caught(getSession())).code).toBe('unknown');
  });

  it.each([
    [
      'setupPassword',
      () => setupPassword('new passphrase here'),
      '/api/auth/setup/password',
      { newPassword: 'new passphrase here' },
    ],
    [
      'setupTotpConfirm',
      () => setupTotpConfirm('654321'),
      '/api/auth/setup/totp/confirm',
      { code: '654321' },
    ],
    [
      'acknowledgeNotice',
      () => acknowledgeNotice(),
      '/api/auth/setup/notice',
      { acknowledged: true },
    ],
  ] as const)('%s POSTs to the contract path', async (_name, call, path, body) => {
    const fetchMock = stubFetch(async () =>
      Response.json({ state: 'setup', csrfToken: 'c', setupStep: 'totp' }),
    );
    await call();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(path);
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it('setupTotpStart returns the setup key and otpauth URI', async () => {
    const enrollment = {
      setupKey: 'ABCD EFGH',
      otpauthUri: 'otpauth://totp/Macro%20Counter:alice?secret=ABCDEFGH',
    };
    const fetchMock = stubFetch(async () => Response.json(enrollment));
    expect(await setupTotpStart()).toEqual(enrollment);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/setup/totp');
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('POST');
  });

  it('signOut and signOutEverywhere POST and expect 204', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));
    await signOut();
    await signOutEverywhere();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/auth/sign-out',
      '/api/auth/sign-out-everywhere',
    ]);
  });

  it('surfaces password_rejected reasons', async () => {
    stubFetch(async () =>
      problem(400, { code: 'password_rejected', reasons: ['too_short', 'breached'] }),
    );
    const error = await caught(setupPassword('short'));
    expect(error.code).toBe('password_rejected');
    expect(error.reasons).toEqual(['too_short', 'breached']);
  });

  it('surfaces invalid_code attempts left', async () => {
    stubFetch(async () => problem(400, { code: 'invalid_code', attemptsLeft: 3 }));
    const error = await caught(setupTotpConfirm('000000'));
    expect(error.code).toBe('invalid_code');
    expect(error.attemptsLeft).toBe(3);
  });

  it('surfaces rate limiting with Retry-After seconds', async () => {
    stubFetch(async () => problem(429, { code: 'rate_limited' }, { 'Retry-After': '120' }));
    const error = await caught(signIn('alice', 'x', undefined));
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(120);
  });

  it.each([
    ['sign_in_failed', 401],
    ['service_unavailable', 503],
    ['breach_check_unavailable', 503],
    ['wrong_setup_step', 409],
  ])('surfaces %s', async (code, status) => {
    stubFetch(async () => problem(status, { code }));
    expect((await caught(signIn('alice', 'x', undefined))).code).toBe(code);
  });

  it('maps a network failure to network', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await caught(getSession())).code).toBe('network');
  });
});
