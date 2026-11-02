import { describe, expect, it } from 'vitest';
import {
  BULB_INDICES,
  INTRO_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
  SPACE_INDEX,
  TYPEFACES,
  WORD,
  buildIntroTimeline,
  finalFrame,
  type IntroFrame,
} from '../../../src/features/splash/timeline';
import { seeded } from './seeded';

const VOWELS = [1, 4, 7, 8, 11];
const LETTERS = [...Array(13).keys()].filter((i) => i !== SPACE_INDEX);
const SEEDS = [...Array(1000).keys()];

const visible = (f: IntroFrame) =>
  f.letters.flatMap((l, i) => (l.visible && i !== SPACE_INDEX ? [i] : []));
const boxed = (f: IntroFrame) => f.letters.flatMap((l, i) => (l.shape ? [i] : []));

function assertFinal(f: IntroFrame) {
  expect(f.final).toBe(true);
  expect(visible(f)).toEqual(LETTERS);
  const faces = LETTERS.map((i) => f.letters[i]!.typeface);
  expect(new Set(faces).size).toBe(12);
  expect(boxed(f)).toEqual([...BULB_INDICES]);
  expect(BULB_INDICES.map((i) => f.letters[i]!.shape).sort()).toEqual([
    'circle',
    'diamond',
    'square',
  ]);
}

describe('constants', () => {
  it('match the spec', () => {
    expect(WORD).toBe('Macro Counter');
    expect(WORD[SPACE_INDEX]).toBe(' ');
    expect(BULB_INDICES.map((i) => WORD[i])).toEqual(['M', 'o', 'o']);
    expect(INTRO_DURATION_MS).toBe(10_000);
    expect(REDUCED_MOTION_DURATION_MS).toBe(2_000);
    expect(TYPEFACES).toHaveLength(13);
    expect(TYPEFACES[0]).toMatchObject({ id: 'inter-800', weight: 800, style: 'normal' });
    expect(TYPEFACES[1]).toMatchObject({ id: 'playfair-700i', weight: 700, style: 'italic' });
    expect(new Set(TYPEFACES.map((t) => t.id)).size).toBe(13);
  });
});

describe('buildIntroTimeline', () => {
  it.each(SEEDS.filter((s) => s % 100 === 0))('frame structure holds (seed %i)', (seed) => {
    const frames = buildIntroTimeline(seeded(seed));
    expect(frames[0]!.at).toBe(0);
    for (let i = 1; i < frames.length; i++)
      expect(frames[i]!.at).toBeGreaterThan(frames[i - 1]!.at);
    for (const f of frames) expect(f.letters).toHaveLength(13);
    expect(frames.filter((f) => f.final)).toEqual([frames.at(-1)]);
    expect(frames.at(-1)!.at).toBeLessThanOrEqual(7_500);
    expect(frames.at(-1)!.at).toBeLessThan(INTRO_DURATION_MS);
  });

  it('opens on black, then the M and both Cs, then only the vowels (FR-003, FR-004)', () => {
    for (const seed of SEEDS) {
      const [blank, mc, vowels] = buildIntroTimeline(seeded(seed)) as [
        IntroFrame,
        IntroFrame,
        IntroFrame,
      ];
      expect(visible(blank)).toEqual([]);
      expect(mc.at).toBe(500);
      expect(visible(mc)).toEqual([0, 2, 6]);
      expect(mc.letters[0]!.typeface).toBe(0);
      expect(mc.letters[2]!.typeface).toBe(1);
      expect(mc.letters[6]!.typeface).toBe(1);
      expect(boxed(mc)).toEqual([]);
      expect(vowels.at).toBe(1_700);
      expect(visible(vowels)).toEqual(VOWELS);
      expect(boxed(vowels)).toEqual([]);
    }
  });

  it('shuffles at least five times, with shapes only on visible letters (FR-005)', () => {
    let shapesSeen = 0;
    for (const seed of SEEDS) {
      const frames = buildIntroTimeline(seeded(seed));
      const shifts = frames.slice(3, -1);
      expect(shifts.length).toBeGreaterThanOrEqual(5);
      for (const f of shifts) {
        expect(f.letters[SPACE_INDEX]!.shape).toBeNull();
        for (const i of boxed(f)) expect(f.letters[i]!.visible).toBe(true);
        shapesSeen += boxed(f).length;
      }
    }
    expect(shapesSeen).toBeGreaterThan(0);
  });

  it('lands on the full logo with shapes on the M and both Os (FR-006, SC-003)', () => {
    for (const seed of SEEDS) assertFinal(buildIntroTimeline(seeded(seed)).at(-1)!);
  });

  it('never puts a shape on the space', () => {
    for (const seed of SEEDS)
      for (const f of buildIntroTimeline(seeded(seed)))
        expect(f.letters[SPACE_INDEX]!.shape).toBeNull();
  });

  it('differs between plays with real randomness (FR-009)', () => {
    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(buildIntroTimeline(Math.random).map((f) => f.letters.map((l) => l.typeface))),
    );
    expect(new Set(runs).size).toBeGreaterThan(1);
  });
});

describe('finalFrame', () => {
  it('satisfies the final-frame rules', () => {
    for (const seed of SEEDS) assertFinal(finalFrame(seeded(seed)));
  });
});
