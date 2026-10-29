import { describe, expect, it } from 'vitest';
import { proteinSegments } from '../../../../src/domain/nutrition/proteinProgress';

// Feature 004: the protein bar's logged and pending segments (data-model.md, Pending projection).
describe('proteinSegments', () => {
  it('returns 0 / 0 when there is no goal', () => {
    expect(proteinSegments(96, 54, null)).toEqual({ loggedPct: 0, pendingPct: 0 });
  });

  it('96 logged + 54 pending of 150 → 64 % + 36 % (hand-checked)', () => {
    expect(proteinSegments(96, 54, 150)).toEqual({ loggedPct: 64, pendingPct: 36 });
  });

  it('no pending → only the logged segment', () => {
    expect(proteinSegments(96, 0, 150)).toEqual({ loggedPct: 64, pendingPct: 0 });
  });

  it('keeps full precision', () => {
    const { loggedPct, pendingPct } = proteinSegments(140, 30, 150);
    expect(loggedPct).toBeCloseTo(93.3333333333, 8);
    expect(pendingPct).toBeCloseTo(6.6666666667, 8);
  });

  it('logged over the goal fills the bar and leaves no room for pending', () => {
    expect(proteinSegments(160, 10, 150)).toEqual({ loggedPct: 100, pendingPct: 0 });
  });

  it('nothing logged or pending → empty bar', () => {
    expect(proteinSegments(0, 0, 150)).toEqual({ loggedPct: 0, pendingPct: 0 });
  });

  it('the two segments never add up to more than 100', () => {
    for (const logged of [0, 1, 75, 149.9, 150, 300]) {
      for (const pending of [0, 0.1, 50, 150, 1000]) {
        const { loggedPct, pendingPct } = proteinSegments(logged, pending, 150);
        expect(loggedPct + pendingPct).toBeLessThanOrEqual(100);
        expect(pendingPct).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for logged %s', (bad) => {
    expect(() => proteinSegments(bad, 0, 150)).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for pending %s', (bad) => {
    expect(() => proteinSegments(0, bad, 150)).toThrow(RangeError);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for goal %s', (bad) => {
    expect(() => proteinSegments(0, 0, bad)).toThrow(RangeError);
  });
});
