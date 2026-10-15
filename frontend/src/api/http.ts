import { z } from 'zod';

// The one place the frontend talks HTTP to /api. It adds the CSRF token to unsafe requests,
// turns problem+json errors into ApiError, and announces an expired session so the UI can ask
// the person to sign in again without losing what they were doing (contracts/auth-api.yaml).

export const API_ERROR_CODES = [
  // 001
  'invalid_request',
  'image_too_large',
  'unsupported_media_type',
  'invalid_ai_response',
  'ai_unavailable',
  'ai_timeout',
  // 003
  'unauthenticated',
  'csrf_failed',
  'sign_in_failed',
  'rate_limited',
  'quota_exceeded',
  'password_rejected',
  'breach_check_unavailable',
  'invalid_code',
  'wrong_setup_step',
  'service_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number] | 'network' | 'unknown';

const ProblemSchema = z.object({ code: z.enum(API_ERROR_CODES) }).loose();

const statusFallback: Record<number, ApiErrorCode> = {
  401: 'unauthenticated',
  403: 'csrf_failed',
  429: 'rate_limited',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** HTTP status, when the server answered. */
  readonly status: number | undefined;
  /** The parsed problem body, for code-specific fields such as resetAt or reasons. */
  readonly problem: Record<string, unknown> | undefined;
  /** From the Retry-After header, when the server sent one. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ApiErrorCode,
    status?: number,
    problem?: Record<string, unknown>,
    retryAfterSeconds?: number,
  ) {
    super(`API request failed: ${code}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.problem = problem;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Fires `session-expired` when a request is refused because the session is no longer valid. */
export const authEvents = new EventTarget();

let csrfToken: string | undefined;

/** Kept in memory only, never in storage (data-model.md: client session state). */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!safeMethods.has(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError('network');
  }

  if (response.ok) return response;

  const problem = await readProblem(response);
  const parsed = ProblemSchema.safeParse(problem);
  const code: ApiErrorCode = parsed.success
    ? parsed.data.code
    : (statusFallback[response.status] ?? 'unknown');
  if (code === 'unauthenticated') authEvents.dispatchEvent(new Event('session-expired'));
  const retryAfter = Number(response.headers.get('Retry-After'));
  throw new ApiError(
    code,
    response.status,
    problem,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readProblem(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
