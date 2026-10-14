import { z } from 'zod';
import { MacrosSchema, QuantitySchema } from '../domain/types';
import { ApiError, apiFetch, isAbort } from './http';

// The only frontend module that calls /api/estimates (Principle VI). Responses are
// validated against the contract in estimates-api.yaml before the UI sees them.

export const FlagSchema = z.enum(['calorie_macro_mismatch', 'large_portion']);
export type Flag = z.infer<typeof FlagSchema>;

export const EstimateItemSchema = z.object({
  name: z.string().min(1),
  portion: QuantitySchema,
  portionDescription: z.string(),
  macros: MacrosSchema,
  flags: z.array(FlagSchema),
});
export type EstimateItem = z.infer<typeof EstimateItemSchema>;

export const EstimateSchema = z.object({
  recognized: z.boolean(),
  items: z.array(EstimateItemSchema),
  total: MacrosSchema,
  flags: z.array(FlagSchema),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export type EstimateErrorCode =
  | 'invalid_request'
  | 'image_too_large'
  | 'unsupported_media_type'
  | 'invalid_ai_response'
  | 'ai_unavailable'
  | 'ai_timeout'
  | 'unauthenticated'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'network';

const messages: Record<EstimateErrorCode, string> = {
  invalid_request: 'That request could not be processed. Check what you entered and try again.',
  image_too_large: 'This image couldn’t be used because it is too large.',
  unsupported_media_type: 'This image couldn’t be used because its format is not supported.',
  invalid_ai_response:
    'The AI could not produce a usable estimate. Try again or enter it manually.',
  ai_unavailable: 'AI lookup is unavailable right now. You can still enter the food manually.',
  ai_timeout: 'The AI took too long to answer. Try again or enter it manually.',
  unauthenticated: 'Sign in again to use AI lookup. Your entries are safe.',
  quota_exceeded: "You've reached the AI lookup limit for now. You can still add food manually.",
  rate_limited: 'Too many lookups in a short time. Wait a minute and try again.',
  network: 'Could not reach the server. Check your connection, or enter the food manually.',
};

/** For quota_exceeded: which limit was reached and when it resets (contracts/auth-api.yaml). */
export interface QuotaDetails {
  scope?: string;
  resetAt?: string;
}

export class EstimateError extends Error {
  readonly code: EstimateErrorCode;

  constructor(code: EstimateErrorCode, quota: QuotaDetails = {}) {
    super(code === 'quota_exceeded' ? quotaMessage(quota) : messages[code]);
    this.name = 'EstimateError';
    this.code = code;
  }
}

/** Says which limit was reached and when it resets, in the person's own time zone (FR-021). */
function quotaMessage({ scope, resetAt }: QuotaDetails): string {
  const reset = resetAt ? new Date(resetAt) : undefined;
  if (!reset || Number.isNaN(reset.getTime())) return messages.quota_exceeded;
  if (scope === 'user_daily') {
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      reset,
    );
    return `You've reached today's AI lookup limit. It resets at ${time}. You can still add food manually.`;
  }
  const when = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(reset);
  return `AI lookup has reached its overall limit for now. It resets at ${when}. You can still add food manually.`;
}

const statusCodes: Record<number, EstimateErrorCode> = {
  400: 'invalid_request',
  401: 'unauthenticated',
  413: 'image_too_large',
  415: 'unsupported_media_type',
  502: 'invalid_ai_response',
  503: 'ai_unavailable',
  504: 'ai_timeout',
};

export function estimateFromText(description: string, signal: AbortSignal): Promise<Estimate> {
  return post(
    '/api/estimates/text',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ description }),
    },
    signal,
  );
}

/** Sends only the (already re-encoded) photo and an optional note (FR-015). */
export function estimateFromPhoto(
  jpeg: Blob,
  note: string | undefined,
  signal: AbortSignal,
): Promise<Estimate> {
  const form = new FormData();
  form.append('photo', jpeg, 'meal.jpg');
  const trimmed = note?.trim();
  if (trimmed) form.append('note', trimmed);
  // No Content-Type header: the browser adds multipart/form-data with its boundary.
  return post(
    '/api/estimates/photo',
    { method: 'POST', headers: { Accept: 'application/json' }, body: form },
    signal,
  );
}

async function post(url: string, init: RequestInit, signal: AbortSignal): Promise<Estimate> {
  let response: Response;
  try {
    response = await apiFetch(url, { ...init, signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new EstimateError(estimateCode(error), quotaDetails(error));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new EstimateError('invalid_ai_response');
  }
  const parsed = EstimateSchema.safeParse(body);
  if (!parsed.success) throw new EstimateError('invalid_ai_response');
  return parsed.data;
}

function estimateCode(error: unknown): EstimateErrorCode {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code in messages) return error.code as EstimateErrorCode;
  return (error.status !== undefined ? statusCodes[error.status] : undefined) ?? 'network';
}

const QuotaDetailsSchema = z.object({
  scope: z.string().optional(),
  resetAt: z.string().optional(),
});

function quotaDetails(error: unknown): QuotaDetails {
  if (!(error instanceof ApiError)) return {};
  const parsed = QuotaDetailsSchema.safeParse(error.problem ?? {});
  return parsed.success ? parsed.data : {};
}
