import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '../../src/auth/AccountMenu';
import type { SyncSnapshot } from '../../src/sync/syncService';
import { fakeAuth, fakeSync, renderWithServices } from './testServices';

describe('signing out with unsynced changes', () => {
  async function menu(pending: number) {
    const auth = fakeAuth();
    const reload = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    await renderWithServices(<AccountMenu />, { auth, reload, sync: fakeSync({ pendingCount: vi.fn(async () => pending) }) });
    return { auth, reload, confirm, user: userEvent.setup() };
  }

  it('asks first, in the menu, and says what will happen', async () => {
    const { auth, confirm, user } = await menu(3);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByText(/3 changes haven't synced yet/i)).toHaveTextContent(/stay on this device/i);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says signing out needs a connection when offline', async () => {
    const offline: SyncSnapshot = { started: true, online: false, outcome: { kind: 'offline' }, running: false, pending: 1, quarantined: 0 };
    const sync = fakeSync({ pendingCount: vi.fn(async () => 1), snapshot: () => offline });
    await renderWithServices(<AccountMenu />, { auth: fakeAuth(), reload: vi.fn(), sync });

    await userEvent.setup().click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByText(/reconnect before you can sign out/i)).toBeInTheDocument();
  });

  it('does not mention a connection when online', async () => {
    const { user } = await menu(1);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await screen.findByText(/1 change hasn't synced yet/i);
    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
  });

  it('says it the singular way for one change', async () => {
    const { user } = await menu(1);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByText(/1 change hasn't synced yet/i)).toBeInTheDocument();
  });

  it('signs out anyway when asked', async () => {
    const { auth, reload, user } = await menu(3);
    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await user.click(await screen.findByRole('button', { name: /sign out anyway/i }));

    expect(auth.signOut).toHaveBeenCalled();
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('keeps which sign-out was asked for', async () => {
    const { auth, user } = await menu(2);
    await user.click(screen.getByRole('button', { name: /sign out everywhere/i }));

    await user.click(await screen.findByRole('button', { name: /sign out anyway/i }));

    expect(auth.signOutEverywhere).toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('can be cancelled', async () => {
    const { auth, user } = await menu(3);
    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(screen.queryByText(/haven't synced yet/i)).not.toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('stops syncing before signing out, so no poll trips over the ended session', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const sync = fakeSync({
      drain: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('drained');
      }),
    });
    const auth = fakeAuth({ signOut: vi.fn(async () => void order.push('sign-out')) });
    await renderWithServices(<AccountMenu />, { auth, sync });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(order).toEqual(['drained', 'sign-out']));
  });

  it('carries on syncing when signing out fails', async () => {
    const user = userEvent.setup();
    const sync = fakeSync();
    const auth = fakeAuth({
      signOut: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await renderWithServices(<AccountMenu />, { auth, sync });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(sync.resume).toHaveBeenCalled());
  });

  it('does not ask when everything is synced', async () => {
    const { auth, user } = await menu(0);

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });
});

describe('Export my data', () => {
  const file = { format: 'macro-counter-export' };

  it('downloads the file and says so', async () => {
    const user = userEvent.setup();
    const downloadFile = vi.fn();
    const exportData = vi.fn(async () => file as never);
    await renderWithServices(<AccountMenu />, {
      exportData,
      downloadFile,
      now: () => new Date(2026, 10, 4, 9, 0),
    });

    await user.click(await screen.findByRole('button', { name: /export my data/i }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const [name, content] = downloadFile.mock.calls[0]! as [string, string];
    expect(name).toBe('macro-counter-export-2026-11-04.json');
    expect(JSON.parse(content)).toEqual(file);
    expect(await screen.findByRole('status')).toHaveTextContent(/downloaded/i);
  });

  it('says the file holds the food log', async () => {
    await renderWithServices(<AccountMenu />, {});

    expect(await screen.findByText(/holds your food log/i)).toBeInTheDocument();
  });

  it('warns but still works when the device may be missing something', async () => {
    const user = userEvent.setup();
    const downloadFile = vi.fn();
    await renderWithServices(<AccountMenu />, {
      downloadFile,
      exportData: vi.fn(async () => file as never),
      sync: fakeSync({ isComplete: vi.fn(async () => false) }),
    });

    expect(await screen.findByText(/this export may be incomplete/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /export my data/i }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
  });

  it('shows no warning when the device has everything', async () => {
    await renderWithServices(<AccountMenu />, {});
    await screen.findByRole('button', { name: /export my data/i });

    await waitFor(() => expect(screen.queryByText(/may be incomplete/i)).not.toBeInTheDocument());
  });

  it('explains a failure', async () => {
    const user = userEvent.setup();
    await renderWithServices(<AccountMenu />, {
      exportData: vi.fn(async () => {
        throw new Error('quota');
      }),
    });

    await user.click(await screen.findByRole('button', { name: /export my data/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't export/i);
  });
});
