import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ServicesProvider } from '../../src/app/services';
import { useCurrentDayKey } from '../../src/features/today/useCurrentDayKey';
import { createTestServices } from './testServices';

let current: Date;

async function setup() {
  const services = await createTestServices({ now: () => current });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  return renderHook(() => useCurrentDayKey(), { wrapper });
}

beforeEach(() => {
  // Only fake the interval timer; IndexedDB and React still use real timers.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  current = new Date(2026, 9, 8, 23, 59, 30);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCurrentDayKey', () => {
  it("returns today's day key", async () => {
    const { result } = await setup();
    expect(result.current).toBe('2026-10-08');
  });

  it('updates within 60 s of local midnight', async () => {
    const { result } = await setup();
    current = new Date(2026, 9, 9, 0, 0, 5);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-09');
  });

  it('does not change before midnight', async () => {
    const { result } = await setup();
    current = new Date(2026, 9, 8, 23, 59, 59);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-08');
  });

  it('re-checks when the page becomes visible again', async () => {
    const { result } = await setup();
    current = new Date(2026, 9, 10, 8, 0, 0);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-10-10');
  });

  it('stops checking after unmount', async () => {
    const { unmount } = await setup();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
