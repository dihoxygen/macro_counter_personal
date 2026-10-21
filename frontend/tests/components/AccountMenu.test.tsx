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

  describe('change password (ASVS 2.1.5, 2.1.6)', () => {
    async function change(
      user: ReturnType<typeof userEvent.setup>,
      { confirm = 'a new and private passphrase' } = {},
    ) {
      await user.type(screen.getByLabelText(/^current password$/i), 'the old passphrase');
      await user.type(screen.getByLabelText(/authenticator code/i), '123456');
      await user.type(screen.getByLabelText(/^new password$/i), 'a new and private passphrase');
      await user.type(screen.getByLabelText(/confirm new password/i), confirm);
      await user.click(screen.getByRole('button', { name: /change password/i }));
    }

    it('sends the current password, a code and the new password, then confirms and clears the form', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth();
      const reload = vi.fn();
      await renderMenu({ auth, reload });

      expect(screen.getByLabelText(/^current password$/i)).toHaveAttribute(
        'autocomplete',
        'current-password',
      );
      expect(screen.getByLabelText(/^new password$/i)).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      await change(user);

      expect(auth.changePassword).toHaveBeenCalledWith(
        'the old passphrase',
        '123456',
        'a new and private passphrase',
      );
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Password changed. Your other devices have been signed out.',
      );
      expect(screen.getByLabelText(/^current password$/i)).toHaveValue('');
      expect(reload).not.toHaveBeenCalled();
    });

    it('catches a mistyped confirmation before sending', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth();
      await renderMenu({ auth });

      await change(user, { confirm: 'something else entirely' });

      expect(auth.changePassword).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent("The new passwords don't match.");
    });

    it.each([
      [
        new AuthError('invalid_credentials'),
        "Your current password or authenticator code didn't match.",
      ],
      [
        new AuthError('password_rejected', { reasons: ['breached'] }),
        'This password has appeared in a data breach. Choose a different one.',
      ],
      [
        new AuthError('breach_check_unavailable'),
        "We couldn't check this password right now. Please try again in a minute.",
      ],
      [new AuthError('rate_limited'), 'Too many attempts. Try again later.'],
    ])('explains a refusal (%s)', async (error, message) => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        changePassword: vi.fn(async () => {
          throw error;
        }),
      });
      await renderMenu({ auth });

      await change(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
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
