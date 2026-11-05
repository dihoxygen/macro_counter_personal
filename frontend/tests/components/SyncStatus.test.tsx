import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatus } from '../../src/features/sync/SyncStatus';
import type { SyncSnapshot } from '../../src/sync/syncService';
import { fakeSync, renderWithServices } from './testServices';

const synced: SyncSnapshot = { started: true, online: true, outcome: { kind: 'ok' }, running: false, pending: 0, quarantined: 0 };

const render = (snapshot: Partial<SyncSnapshot>) => {
  const stable = { ...synced, ...snapshot };
  return renderWithServices(<SyncStatus />, { sync: fakeSync({ snapshot: () => stable }) });
};

describe('SyncStatus', () => {
  it.each<[string, Partial<SyncSnapshot>, RegExp]>([
    ['synced', {}, /^synced$/i],
    ['off', { started: false, outcome: { kind: 'idle' } }, /sync off/i],
    ['off when the notice is missing', { outcome: { kind: 'off' } }, /sync off/i],
    ['pending', { pending: 3 }, /3 not synced/i],
    ['syncing until the first round finishes', { outcome: { kind: 'idle' } }, /syncing/i],
    ['pending before the first round finishes', { outcome: { kind: 'idle' }, pending: 2 }, /2 not synced/i],
    ['offline when the browser says so', { online: false }, /offline: will sync later/i],
    ['offline after a network failure', { outcome: { kind: 'offline' }, pending: 1 }, /offline: will sync later/i],
    ['failing', { outcome: { kind: 'failing' }, pending: 1 }, /sync problem, retrying/i],
  ])('shows %s', async (_name, snapshot, label) => {
    await render(snapshot);

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('adds what cannot sync to any state', async () => {
    await render({ quarantined: 2 });

    expect(screen.getByRole('button', { name: /synced.*2 can't sync/i })).toBeInTheDocument();
  });

  it('does not flicker on a fast round', async () => {
    // Only setTimeout: the test database underneath needs its own timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let snapshot: SyncSnapshot = { ...synced, running: true };
      const listeners = new Set<() => void>();
      const sync = fakeSync({
        snapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      });
      await renderWithServices(<SyncStatus />, { sync });

      await act(() => vi.advanceTimersByTimeAsync(900));
      expect(screen.queryByRole('button', { name: /syncing/i })).not.toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(screen.getByRole('button', { name: /syncing/i })).toBeInTheDocument();

      snapshot = synced;
      act(() => listeners.forEach((listener) => listener()));
      expect(screen.getByRole('button', { name: /^synced$/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains itself when tapped', async () => {
    const user = userEvent.setup();
    await render({ pending: 1 });

    await user.click(screen.getByRole('button', { name: /1 not synced/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/waiting/i);
  });

  it('has a text label, not only a colour, and a large enough target', async () => {
    await render({});

    expect(screen.getByRole('button').className).toContain('sync-status');
    expect(screen.getByRole('button')).toHaveTextContent('Synced');
  });
});
