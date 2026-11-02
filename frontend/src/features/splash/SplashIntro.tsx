import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BULB_INDICES,
  FLICKER_DURATION_MS,
  FLICKER_KEYFRAMES,
  INTRO_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
  SPACE_INDEX,
  TYPEFACES,
  WORD,
  type IntroFrame,
} from './timeline';
import './splash.css';

interface Props {
  frames: IntroFrame[];
  reducedMotion: boolean;
  onDone: () => void;
}

/**
 * Plays the intro frames on timers (feature 005). Styles that change per frame go through React `style`
 * objects and the flicker through element.animate: both are CSSOM writes, which the strict CSP allows.
 */
export function SplashIntro({ frames, reducedMotion, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const logo = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const finish = useRef(onDone);
  const skip = useRef<HTMLButtonElement>(null);
  const frame = frames[index]!;

  useEffect(() => {
    finish.current = onDone;
  });

  /** Ends the intro once, however many ways it is asked to (timer, skip, hidden tab). */
  const end = useCallback(() => {
    if (done.current) return;
    done.current = true;
    finish.current();
  }, []);

  useEffect(() => {
    done.current = false;
    skip.current?.focus();
    const timers = frames.slice(1).map((f, i) => setTimeout(() => setIndex(i + 1), f.at));
    timers.push(setTimeout(end, reducedMotion ? REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS));
    // A hidden tab throttles timers; don't make the person wait for the rest when they come back.
    const onVisibility = () => {
      if (document.hidden) end();
    };
    // Skip with Enter, Space or Escape (FR-011). Only listening while the intro is up.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      e.preventDefault();
      end();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
    };
  }, [frames, reducedMotion, end]);

  useEffect(() => {
    if (!frame.final || reducedMotion || !logo.current) return;
    const animations = [
      ...logo.current.querySelectorAll<HTMLElement>('[data-flicker="true"]'),
    ].flatMap((el) => {
      if (typeof el.animate !== 'function') return [];
      const bulb = BULB_INDICES.indexOf(Number(el.dataset.bulb) as (typeof BULB_INDICES)[number]);
      return [
        el.animate([...FLICKER_KEYFRAMES], {
          duration: FLICKER_DURATION_MS,
          fill: 'forwards',
          delay: bulb * 170,
        }),
      ];
    });
    return () => animations.forEach((a) => a.cancel?.());
  }, [frame, reducedMotion]);

  const pop = reducedMotion ? '' : index % 2 ? 'splash-pop-a' : 'splash-pop-b';

  return (
    // A tap or click anywhere skips (FR-011); the button below is the labelled way for keyboard and screen readers.
    <div className="splash" data-testid="splash-intro" onPointerDown={end}>
      <div className="splash-logo" role="img" aria-label={WORD} ref={logo}>
        {frame.letters.map((letter, i) => {
          const face = TYPEFACES[letter.typeface]!;
          const font: CSSProperties = {
            fontFamily: face.family,
            fontWeight: face.weight,
            fontStyle: face.style,
          };
          const flicker = frame.final && letter.shape ? 'true' : undefined;
          return (
            <span
              key={i}
              data-testid="splash-letter"
              aria-hidden="true"
              data-index={i}
              data-typeface={face.id}
              data-visible={String(letter.visible)}
              data-shape={letter.shape ?? undefined}
              className={`splash-letter ${i === SPACE_INDEX ? 'splash-space' : ''} ${letter.visible ? pop : ''}`}
              style={{ visibility: letter.visible ? 'visible' : 'hidden' }}
            >
              {letter.shape ? (
                <span className={`splash-box splash-box--${letter.shape}`}>
                  <span className="splash-pool" data-flicker={flicker} data-bulb={i} />
                  <span className="splash-shell" />
                  <span className="splash-light" data-flicker={flicker} data-bulb={i} />
                  <span
                    className="splash-glyph--lit"
                    data-flicker={flicker}
                    data-bulb={i}
                    style={font}
                  >
                    {WORD[i]}
                  </span>
                </span>
              ) : (
                <span style={font}>{i === SPACE_INDEX ? ' ' : WORD[i]}</span>
              )}
            </span>
          );
        })}
      </div>
      <button type="button" className="splash-skip" ref={skip} onClick={end}>
        Skip intro
      </button>
    </div>
  );
}
