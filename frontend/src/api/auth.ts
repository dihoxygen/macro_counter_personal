import { z } from 'zod';
import { ApiError, apiFetch, isAbort, setCsrfToken } from './http';

// The frontend's only caller of /api/auth/* (contracts/auth-api.yaml). Every session-state response is
// validated, and its CSRF token becomes the one sent on later unsafe requests.

export const SetupStepSchema = z.enum(['password', 'totp', 'notice']);
export type SetupStep = z.infer<typeof SetupStepSchema>;

export const SessionUserSchema = z.object({
  id: z.uuid(),
  username: z.string().min(1),
  role: z.enum(['owner', 'user']),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionStateSchema = z.object({
  state: z.enum(['signed_out', 'setup', 'signed_in']),
  csrfToken: z.string().min(1),
  setupStep: SetupStepSchema.optional(),
  user: SessionUserSchema.optional(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

const EnrollmentSchema = z.object({
  setupKey: z.string().min(1),
  otpauthUri: z.string().startsWith('otpauth://'),
});
export type Enrollment = z.infer<typeof EnrollmentSchema>;

export type AuthErrorCode =
  | 'sign_in_failed'
  | 'rate_limited'
  | 'service_unavailable'
  | 'password_rejected'
  | 'breach_check_unavailable'
  | 'invalid_code'
  | 'wrong_setup_step'
  | 'invalid_credentials'
  | 'unauthenticated'
  | 'csrf_failed'
  | 'invalid_request'
  | 'network'
  | 'unknown';

const knownCodes = new Set<string>([
  'sign_in_failed',
  'rate_limited',
  'service_unavailable',
  'password_rejected',
  'breach_check_unavailable',
  'invalid_code',
  'wrong_setup_step',
  'invalid_credentials',
  'unauthenticated',
  'csrf_failed',
  'invalid_request',
  'network',
]);

export interface AuthErrorDetails {
  reasons?: string[];
  attemptsLeft?: number;
  retryAfterSeconds?: number;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly reasons: string[] | undefined;
  readonly attemptsLeft: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: AuthErrorCode, details: AuthErrorDetails = {}) {
    super(`Auth request failed: ${code}`);
    this.name = 'AuthError';
    this.code = code;
    this.reasons = details.reasons;
    this.attemptsLeft = details.attemptsLeft;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const ProblemDetailsSchema = z
  .object({ reasons: z.array(z.string()).optional(), attemptsLeft: z.number().int().optional() })
  .loose();

export function getSession(): Promise<SessionState> {
  return sessionRequest('/api/auth/session', { method: 'GET' });
}

export async function signIn(
  username: string,
  password: string,
  code: string | undefined,
): Promise<SessionState> {
  const trimmed = code?.trim();
  const request = () =>
    sessionRequest(
      '/api/auth/sign-in',
      json(trimmed ? { username, password, code: trimmed } : { username, password }),
    );
  try {
    return await request();
  } catch (error) {
    // The page may hold a CSRF token bound to a session that has since ended (signed out elsewhere,
    // expired, disabled). Fetch a fresh anonymous token and try exactly once more.
    if (!(error instanceof AuthError) || error.code !== 'csrf_failed') throw error;
    await getSession();
    return request();
  }
}

export function setupPassword(newPassword: string): Promise<SessionState> {
  return sessionRequest('/api/auth/setup/password', json({ newPassword }));
}

export async function setupTotpStart(): Promise<Enrollment> {
  const response = await call('/api/auth/setup/totp', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  return parse(EnrollmentSchema, response);
}

export function setupTotpConfirm(code: string): Promise<SessionState> {
  return sessionRequest('/api/auth/setup/totp/confirm', json({ code }));
}

export function acknowledgeNotice(): Promise<SessionState> {
  return sessionRequest('/api/auth/setup/notice', json({ acknowledged: true }));
}

export async function signOut(): Promise<void> {
  await call('/api/auth/sign-out', { method: 'POST' });
  setCsrfToken(undefined);
}

export async function signOutEverywhere(): Promise<void> {
  await call('/api/auth/sign-out-everywhere', { method: 'POST' });
  setCsrfToken(undefined);
}

/** Other sessions end; this one stays signed in with the same CSRF token. */
export async function changePassword(
  currentPassword: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await call('/api/auth/password', json({ currentPassword, code: code.trim(), newPassword }));
}

/** Everything the UI needs from the auth endpoints, injected through Services so tests can swap it. */
export const authApi = {
  getSession,
  signIn,
  setupPassword,
  setupTotpStart,
  setupTotpConfirm,
  acknowledgeNotice,
  signOut,
  signOutEverywhere,
  changePassword,
};
export type AuthApi = typeof authApi;

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  };
}

async function sessionRequest(url: string, init: RequestInit): Promise<SessionState> {
  const state = await parse(
    SessionStateSchema,
    await call(url, { ...init, headers: { Accept: 'application/json', ...init.headers } }),
  );
  setCsrfToken(state.csrfToken);
  return state;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await apiFetch(url, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw toAuthError(error);
  }
}

async function parse<T>(schema: z.ZodType<T>, response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthError('unknown');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AuthError('unknown');
  return parsed.data;
}

function toAuthError(error: unknown): AuthError {
  if (!(error instanceof ApiError)) return new AuthError('network');
  const code = knownCodes.has(error.code) ? (error.code as AuthErrorCode) : 'unknown';
  const details = ProblemDetailsSchema.safeParse(error.problem ?? {});
  return new AuthError(code, {
    reasons: details.success ? details.data.reasons : undefined,
    attemptsLeft: details.success ? details.data.attemptsLeft : undefined,
    retryAfterSeconds: error.retryAfterSeconds,
  });
}
