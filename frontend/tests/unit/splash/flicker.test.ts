import { describe, expect, it } from 'vitest';
import {
  FLICKER_DURATION_MS,
  FLICKER_KEYFRAMES,
  countFlashes,
} from '../../../src/features/splash/timeline';

// The design canvas's original flicker: five dips between 1.6 s and 2.6 s of a 2.8 s run.
const canvasFlicker = [
  { offset: 0, opacity: 1 },
  { offset: 0.55, opacity: 1 },
  { offset: 0.57, opacity: 0.2 },
  { offset: 0.62, opacity: 0.75 },
  { offset: 0.64, opacity: 0.1 },
  { offset: 0.7, opacity: 0.8 },
  { offset: 0.72, opacity: 0.2 },
  { offset: 0.8, opacity: 0.75 },
  { offset: 0.82, opacity: 0.1 },
  { offset: 0.88, opacity: 0.75 },
  { offset: 0.92, opacity: 0.15 },
  { offset: 1, opacity: 0.75 },
];

describe('FLICKER_KEYFRAMES', () => {
  it('starts fully lit and rests dim', () => {
    expect(FLICKER_DURATION_MS).toBe(2_800);
    expect(FLICKER_KEYFRAMES[0]).toEqual({ offset: 0, opacity: 1 });
    expect(FLICKER_KEYFRAMES.at(-1)).toEqual({ offset: 1, opacity: 0.55 });
    for (let i = 1; i < FLICKER_KEYFRAMES.length; i++)
      expect(FLICKER_KEYFRAMES[i]!.offset).toBeGreaterThanOrEqual(FLICKER_KEYFRAMES[i - 1]!.offset);
  });

  it('never flashes more than three times in any second (FR-008)', () => {
    expect(countFlashes(FLICKER_KEYFRAMES, FLICKER_DURATION_MS, 1_000)).toBeLessThanOrEqual(3);
  });

  it('still reads as a failing bulb', () => {
    expect(
      countFlashes(FLICKER_KEYFRAMES, FLICKER_DURATION_MS, FLICKER_DURATION_MS),
    ).toBeGreaterThanOrEqual(5);
  });
});

describe('countFlashes', () => {
  it('catches the canvas flicker that breaks the limit', () => {
    expect(countFlashes(canvasFlicker, 2_800, 1_000)).toBe(5);
  });

  it('counts a dip only once it recovers', () => {
    const dipNoRecovery = [
      { offset: 0, opacity: 1 },
      { offset: 0.5, opacity: 0.1 },
      { offset: 1, opacity: 0.5 },
    ];
    expect(countFlashes(dipNoRecovery, 1_000, 1_000)).toBe(0);
  });
});
