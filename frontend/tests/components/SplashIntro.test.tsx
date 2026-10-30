import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SplashIntro } from '../../src/features/splash/SplashIntro';
import {
  FLICKER_KEYFRAMES,
  TYPEFACES,
  buildIntroTimeline,
} from '../../src/features/splash/timeline';
import { seeded } from '../unit/splash/seeded';

const letters = () => screen.getAllByTestId('splash-letter');
const visibleIndices = () =>
  letters()
    .filter((l) => l.dataset.visible === 'true')
    .map((l) => Number(l.dataset.index));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate'];
});

afterEach(() => {
  vi.useRealTimers();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

function renderIntro(onDone = vi.fn()) {
  render(
    <SplashIntro frames={buildIntroTimeline(seeded(7))} reducedMotion={false} onDone={onDone} />,
  );
  return onDone;
}

describe('SplashIntro', () => {
  it('names the logo once for assistive tech; letters are hidden from it (FR-013)', () => {
    renderIntro();
    expect(screen.getByTestId('splash-intro')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Macro Counter' })).toBeInTheDocument();
    expect(letters()).toHaveLength(13);
    for (const l of letters()) expect(l).toHaveAttribute('aria-hidden', 'true');
  });

  it('plays the M and Cs, then the vowels, then lands on the logo (FR-003, FR-004, FR-006)', () => {
    renderIntro();
    expect(visibleIndices()).toEqual([]);
    advance(500);
    expect(visibleIndices()).toEqual([0, 2, 6]);
    advance(1_200);
    expect(visibleIndices()).toEqual([1, 4, 7, 8, 11]);
    advance(5_500);
    expect(visibleIndices()).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    const shaped = letters().filter((l) => l.dataset.shape);
    expect(shaped.map((l) => Number(l.dataset.index))).toEqual([0, 4, 7]);
    const faces = letters()
      .filter((l) => l.dataset.index !== '5')
      .map((l) => l.dataset.typeface);
    expect(new Set(faces).size).toBe(12);
    expect(faces.every((id) => TYPEFACES.some((t) => t.id === id))).toBe(true);
  });

  it('flickers the M and O shapes on the final frame (FR-008)', () => {
    renderIntro();
    advance(7_200);
    const flickering = document.querySelectorAll('[data-flicker="true"]');
    expect(flickering.length).toBeGreaterThanOrEqual(3);
    expect(animate).toHaveBeenCalledTimes(flickering.length);
    for (const call of animate.mock.calls) {
      expect(call[0]).toEqual(FLICKER_KEYFRAMES);
      expect(call[1]).toMatchObject({ duration: 2_800, fill: 'forwards' });
    }
  });

  it('hands over at 10 seconds, exactly once (FR-002)', () => {
    const onDone = renderIntro();
    advance(9_999);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    advance(5_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops its timers when unmounted early', () => {
    const onDone = vi.fn();
    const { unmount } = render(
      <SplashIntro frames={buildIntroTimeline(seeded(1))} reducedMotion={false} onDone={onDone} />,
    );
    advance(3_000);
    unmount();
    advance(10_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('ends at once when the tab is hidden', () => {
    const onDone = renderIntro();
    advance(2_000);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(onDone).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it('renders the final frame where the browser has no Web Animations (jsdom)', () => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    renderIntro();
    expect(() => advance(7_200)).not.toThrow();
    expect(letters().filter((l) => l.dataset.shape)).toHaveLength(3);
  });
});

describe('SplashIntro skip (US2)', () => {
  it('offers a focused, labelled Skip intro button (FR-011)', () => {
    const onDone = renderIntro();
    const skip = screen.getByRole('button', { name: 'Skip intro' });
    expect(skip).toHaveFocus();
    fireEvent.click(skip);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ends on a tap or click anywhere on the intro', () => {
    const onDone = renderIntro();
    fireEvent.pointerDown(screen.getByTestId('splash-intro'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' ', 'Escape'])('ends on the %j key', (key) => {
    const onDone = renderIntro();
    fireEvent.keyDown(window, { key });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onDone = renderIntro();
    fireEvent.keyDown(window, { key: 'a' });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stops listening for keys once it is gone', () => {
    const onDone = vi.fn();
    const { unmount } = render(
      <SplashIntro frames={buildIntroTimeline(seeded(2))} reducedMotion={false} onDone={onDone} />,
    );
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps the skip button outside the logo image, so it stays reachable', () => {
    renderIntro();
    const img = screen.getByRole('img', { name: 'Macro Counter' });
    expect(img).not.toContainElement(screen.getByRole('button', { name: 'Skip intro' }));
  });
});
