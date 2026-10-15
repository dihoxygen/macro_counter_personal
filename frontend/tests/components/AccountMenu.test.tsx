import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '../../src/api/auth';
import { AccountMenu } from '../../src/auth/AccountMenu';
import { CurrentUserContext } from '../../src/auth/currentUser';
import { fakeAuth, fakeDevice, renderWithServices } from './testServices';

const alice = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user' as const,
};

function renderMenu(overrides: Parameters<typeof renderWithServices>[1]) {
  return renderWithServices(
    <CurrentUserContext.Provider value={alice}>
      <AccountMenu />
    </CurrentUserContext.Provider>,
    overrides,
  );
}

describe('AccountMenu', () => {
  it('shows who is signed in', async () => {
    await renderMenu({});
    expect(screen.getByText(/signed in as/i)).toHaveTextContent('alice');
  });

  it('signs out, forgets the account on this device, then reloads', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    const reload = vi.fn();
    const device = fakeDevice();
    await renderMenu({ auth, reload, device });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(auth.signOut).toHaveBeenCalled();
    // Their data stays on the device, locked to their account (FR-017); only the marker goes.
    expect(device.clearActiveAccount).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('signs out everywhere, then reloads', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    const reload = vi.fn();
    await renderMenu({ auth, reload });

    await user.click(screen.getByRole('button', { name: /sign out everywhere/i }));

    expect(auth.signOutEverywhere).toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('stays put and explains when signing out fails', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      signOut: vi.fn(async () => {
        throw new AuthError('network');
      }),
    });
    const reload = vi.fn();
    await renderMenu({ auth, reload });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't sign out. Check your connection and try again.",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('treats an already-ended session as signed out', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      signOut: vi.fn(async () => {
        throw new AuthError('unauthenticated');
      }),
    });
    const reload = vi.fn();
    await renderMenu({ auth, reload });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(reload).toHaveBeenCalled();
  });
});
