import { describe, expect, it } from 'vitest';
import { proteinProgress } from '../../../../src/domain/nutrition/proteinProgress';

describe('proteinProgress', () => {
  it('returns null when there is no goal', () => {
    expect(proteinProgress(90, null)).toBeNull();
  });

  it('90 of 150 → 60 remaining, not met', () => {
    expect(proteinProgress(90, 150)).toEqual({ loggedG: 90, goalG: 150, remainingG: 60, exceededG: 0, met: false });
  });

  it('exactly 150 of 150 → met with 0 remaining', () => {
    expect(proteinProgress(150, 150)).toEqual({ loggedG: 150, goalG: 150, remainingG: 0, exceededG: 0, met: true });
  });

  it('170 of 150 → exceeded by 20', () => {
    expect(proteinProgress(170, 150)).toEqual({ loggedG: 170, goalG: 150, remainingG: 0, exceededG: 20, met: true });
  });

  it('0 logged → the whole goal remains', () => {
    expect(proteinProgress(0, 150)).toMatchObject({ remainingG: 150, met: false });
  });

  it('keeps full precision', () => {
    expect(proteinProgress(9.94, 150)!.remainingG).toBeCloseTo(140.06, 10);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for logged %s', (bad) => {
    expect(() => proteinProgress(bad, 150)).toThrow(RangeError);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for goal %s', (bad) => {
    expect(() => proteinProgress(10, bad)).toThrow(RangeError);
  });
});
