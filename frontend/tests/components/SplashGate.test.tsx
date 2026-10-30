import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SplashGate } from '../../src/features/splash/SplashGate';
import { seeded } from '../unit/splash/seeded';

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      count {n}
    </button>
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const overlay = () => screen.queryByTestId('splash-intro');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SplashGate', () => {
  it('shows only the app when the intro already played this session', () => {
    render(
      <SplashGate play={false} rng={seeded(1)} reducedMotion={false}>
        <Counter />
      </SplashGate>,
    );
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'count 0' }).closest('[inert]')).toBeNull();
  });

  it('keeps the app loading underneath, unreachable, while the intro plays (FR-017)', () => {
    render(
      <SplashGate play rng={seeded(1)} reducedMotion={false}>
        <Counter />
      </SplashGate>,
    );
    expect(overlay()).toBeInTheDocument();
    expect(screen.getByText('count 0').closest('[inert]')).not.toBeNull();
  });

  it('hands over to the same, still-mounted app after 10 s (FR-012)', () => {
    render(
      <SplashGate play rng={seeded(1)} reducedMotion={false}>
        <Counter />
      </SplashGate>,
    );
    // State set before the handover must survive it: the app is never remounted.
    fireEvent.click(screen.getByText('count 0'));
    advance(10_000);
    expect(overlay()).not.toBeInTheDocument();
    const counter = screen.getByRole('button', { name: 'count 1' });
    expect(counter.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('still plays under StrictMode', () => {
    render(
      <StrictMode>
        <SplashGate play rng={seeded(1)} reducedMotion={false}>
          <Counter />
        </SplashGate>
      </StrictMode>,
    );
    expect(overlay()).toBeInTheDocument();
    advance(10_000);
    expect(overlay()).not.toBeInTheDocument();
  });
});

describe('SplashGate with reduced motion (US3)', () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate'];
  });
  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    vi.unstubAllGlobals();
  });

  const shaped = () =>
    screen
      .getAllByTestId('splash-letter')
      .filter((l) => l.dataset.shape)
      .map((l) => Number(l.dataset.index));

  it('shows the still logo at once, without flicker (FR-014)', () => {
    render(
      <SplashGate play rng={seeded(3)} reducedMotion>
        <Counter />
      </SplashGate>,
    );
    expect(
      screen.getAllByTestId('splash-letter').filter((l) => l.dataset.visible === 'true'),
    ).toHaveLength(12);
    expect(shaped()).toEqual([0, 4, 7]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('hands over within 2 seconds', () => {
    render(
      <SplashGate play rng={seeded(3)} reducedMotion>
        <Counter />
      </SplashGate>,
    );
    advance(1_999);
    expect(overlay()).toBeInTheDocument();
    advance(1);
    expect(overlay()).not.toBeInTheDocument();
  });

  it('can still be skipped', () => {
    render(
      <SplashGate play rng={seeded(3)} reducedMotion>
        <Counter />
      </SplashGate>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(overlay()).not.toBeInTheDocument();
  });

  it("follows the device's reduce-motion setting by default", () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    render(
      <SplashGate play rng={seeded(3)}>
        <Counter />
      </SplashGate>,
    );
    expect(shaped()).toEqual([0, 4, 7]);
    advance(2_000);
    expect(overlay()).not.toBeInTheDocument();
  });
});
