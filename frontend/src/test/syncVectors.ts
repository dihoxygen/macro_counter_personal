// The validation and name-normalization vectors shared with the backend tests (007 T002, T003), so the
// device and the server cannot drift apart.
import bounds from '../../../backend/MacroCounter.Api.Tests/Sync/vectors/bounds.json';
import normalize from '../../../backend/MacroCounter.Api.Tests/Sync/vectors/normalize.json';

export type VectorType = keyof typeof bounds.base;

export interface BoundsCase {
  name: string;
  type: VectorType;
  /** Merged over the base record of this type. */
  patch: Record<string, unknown>;
  valid: boolean;
  reason?: 'invalid_record' | 'unknown_schema_version';
}

export const boundsCases = bounds.cases as BoundsCase[];

export function recordFor(vector: BoundsCase): Record<string, unknown> {
  return { ...bounds.base[vector.type], ...vector.patch };
}

export const normalizeCases = normalize.cases;
