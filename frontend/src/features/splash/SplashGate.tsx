import { useState, type ReactNode } from 'react';
import { SplashIntro } from './SplashIntro';
import { buildIntroTimeline, finalFrame } from './timeline';
import './splash.css';

interface Props {
  /** Decided once in main.tsx, outside React: StrictMode runs state initializers twice. */
  play: boolean;
  rng?: () => number;
  reducedMotion?: boolean;
  children: ReactNode;
}

/**
 * Renders the app at once and, when the intro is due, the intro over it (feature 005). The app keeps loading
 * underneath (FR-017) and is inert until the handover, which never remounts it (FR-012).
 */
export function SplashGate({ play, rng = Math.random, reducedMotion, children }: Props) {
  const [showing, setShowing] = useState(play);
  const [reduced] = useState(
    () =>
      reducedMotion ??
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  // Reduced motion: only the still logo, no shuffle or flicker (FR-014).
  const [frames] = useState(() =>
    !play ? [] : reduced ? [{ ...finalFrame(rng), at: 0 }] : buildIntroTimeline(rng),
  );

  const handOver = () => {
    setShowing(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  return (
    <>
      <div className="splash-gate" inert={showing}>
        {children}
      </div>
      {showing && <SplashIntro frames={frames} reducedMotion={reduced} onDone={handOver} />}
    </>
  );
}
