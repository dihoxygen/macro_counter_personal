// The splash intro's sequence as pure data (feature 005). Every random choice comes from the injected rng,
// so the rules in data-model.md can be checked over many seeded runs; the component only plays the frames.

export const WORD = 'Macro Counter';
export const SPACE_INDEX = 5;
/** The "M" and both "o"s: the letters that end inside lit shapes (FR-006). */
export const BULB_INDICES = [0, 4, 7] as const;
export const INTRO_DURATION_MS = 10_000;
export const REDUCED_MOTION_DURATION_MS = 2_000;
export const FLICKER_DURATION_MS = 2_800;

export type Shape = 'circle' | 'square' | 'diamond';

export interface Typeface {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

export interface LetterState {
  /** Index into TYPEFACES. */
  typeface: number;
  visible: boolean;
  shape: Shape | null;
}

export interface IntroFrame {
  /** ms from when the intro appears. */
  at: number;
  letters: LetterState[];
  final: boolean;
}

// Family names are the renamed subsets in public/fonts/intro (no Reserved Font Names; see its README).
const face = (
  id: string,
  weight = 400,
  style: Typeface['style'] = 'normal',
  fallback = 'serif',
): Typeface => ({
  id,
  family: `'MC Intro ${id}', ${fallback}`,
  weight,
  style,
});

export const TYPEFACES: readonly Typeface[] = [
  face('inter-800', 800, 'normal', 'sans-serif'),
  face('playfair-700i', 700, 'italic'),
  face('bungee', 400, 'normal', 'sans-serif'),
  face('kaushan', 400, 'normal', 'cursive'),
  face('spacemono-700', 700, 'normal', 'monospace'),
  face('abril'),
  face('pacifico', 400, 'normal', 'cursive'),
  face('monoton', 400, 'normal', 'sans-serif'),
  face('unifraktur'),
  face('bebas', 400, 'normal', 'sans-serif'),
  face('cinzel-700', 700),
  face('rubikmono', 400, 'normal', 'sans-serif'),
  face('lobster', 400, 'normal', 'cursive'),
];

const SHAPES: readonly Shape[] = ['circle', 'square', 'diamond'];
const POSITIONS = [...WORD].map((_, i) => i);
const LETTERS = POSITIONS.filter((i) => i !== SPACE_INDEX);
const VOWELS = [1, 4, 7, 8, 11];
const CONSONANTS = [0, 2, 3, 6, 9, 10, 12];

type Rng = () => number;

const pick = (rng: Rng, n: number) => Math.min(n - 1, Math.floor(rng() * n));

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

function frame(
  at: number,
  visible: (i: number) => boolean,
  typeface: (i: number) => number,
): IntroFrame {
  return {
    at,
    final: false,
    letters: POSITIONS.map((i) => ({
      typeface: typeface(i),
      visible: i !== SPACE_INDEX && visible(i),
      shape: null,
    })),
  };
}

const only = (indices: readonly number[]) => (i: number) => indices.includes(i);

/** A shuffle step: random typefaces, and `shapes` lit shapes on random visible letters (FR-005). */
function shift(rng: Rng, at: number, visible: (i: number) => boolean, shapes: number): IntroFrame {
  const f = frame(at, visible, () => pick(rng, TYPEFACES.length));
  const candidates = shuffle(
    rng,
    LETTERS.filter((i) => f.letters[i]!.visible),
  ).slice(0, shapes);
  for (const i of candidates) f.letters[i]!.shape = SHAPES[pick(rng, SHAPES.length)]!;
  return f;
}

/** The logo: 12 distinct typefaces, and one each of circle, square and diamond on the M and both Os (FR-006). */
export function finalFrame(rng: Rng, at = 7_200): IntroFrame {
  const faces = shuffle(
    rng,
    TYPEFACES.map((_, i) => i),
  );
  const f = frame(
    at,
    () => true,
    (i) => (i === SPACE_INDEX ? 0 : faces[LETTERS.indexOf(i)]!),
  );
  const shapes = shuffle(rng, SHAPES);
  BULB_INDICES.forEach((i, k) => (f.letters[i]!.shape = shapes[k]!));
  f.final = true;
  return f;
}

/** Frame times follow the approved design canvas (research R3). */
export function buildIntroTimeline(rng: Rng): IntroFrame[] {
  const some = () => {
    const shown = new Set(LETTERS.filter(() => rng() < 0.65));
    return (i: number) => shown.has(i);
  };
  const all = () => true;
  return [
    frame(
      0,
      () => false,
      () => 0,
    ),
    frame(500, only([0, 2, 6]), (i) => (i === 0 ? 0 : 1)),
    frame(1_700, only(VOWELS), () => pick(rng, TYPEFACES.length)),
    shift(rng, 2_900, all, 1),
    shift(rng, 3_500, some(), 2),
    shift(rng, 4_100, only(CONSONANTS), 2),
    shift(rng, 4_700, all, 3),
    shift(rng, 5_300, only([0, ...VOWELS]), 2),
    shift(rng, 5_900, all, 3),
    shift(rng, 6_500, all, 3),
    shift(rng, 6_900, all, 2),
    finalFrame(rng),
  ];
}

// A failing bulb: dips at least 340 ms apart, so no 1-second window holds more than 3 flashes (FR-008, research
// R4). Each recovery is a little weaker than the last, and the bulb comes to rest dim.
const DIPS: readonly [atMs: number, low: number, recover: number][] = [
  [150, 0.2, 1],
  [500, 0.3, 1],
  [900, 0.15, 0.95],
  [1_300, 0.1, 0.9],
  [1_650, 0.2, 0.85],
  [2_050, 0.1, 0.8],
  [2_450, 0.05, 0.75],
];

export const FLICKER_KEYFRAMES: readonly { offset: number; opacity: number }[] = [
  { offset: 0, opacity: 1 },
  ...DIPS.flatMap(([at, low, recover]) => [
    { offset: (at - 40) / FLICKER_DURATION_MS, opacity: recover },
    { offset: at / FLICKER_DURATION_MS, opacity: low },
    { offset: (at + 60) / FLICKER_DURATION_MS, opacity: recover },
  ]),
  { offset: 2_650 / FLICKER_DURATION_MS, opacity: 0.6 },
  { offset: 1, opacity: 0.55 },
];

const FLASH_LOW = 0.4;
const FLASH_HIGH = 0.7;

/** The most flashes (a dip below 0.4 that recovers above 0.7) in any `windowMs` stretch of the curve. */
export function countFlashes(
  keyframes: readonly { offset: number; opacity: number }[],
  durationMs: number,
  windowMs: number,
): number {
  const flashes: number[] = [];
  let dipAt: number | null = null;
  for (const k of keyframes) {
    if (k.opacity < FLASH_LOW && dipAt === null) dipAt = k.offset * durationMs;
    else if (k.opacity > FLASH_HIGH && dipAt !== null) {
      flashes.push(dipAt);
      dipAt = null;
    }
  }
  let most = 0;
  for (let i = 0; i < flashes.length; i++) {
    let j = i;
    while (j < flashes.length && flashes[j]! - flashes[i]! < windowMs) j++;
    most = Math.max(most, j - i);
  }
  return most;
}
