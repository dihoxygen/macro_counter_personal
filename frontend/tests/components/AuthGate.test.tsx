import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError, type SessionState } from '../../src/api/auth';
import { authEvents } from '../../src/api/http';
import { AuthGate } from '../../src/auth/AuthGate';
import { useServices } from '../../src/app/services';
import { fakeDevice } from './testServices';
import { fakeAuth, renderWithServices } from './testServices';

const alice = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user' as const,
};
const bob = { id: '6f1c2a4e-0000-4000-8000-000000000002', username: 'bob', role: 'user' as const };
const signedIn = (user = alice): SessionState => ({
  state: 'signed_in',
  csrfToken: 't',
  deviceRemembered: false,
  user,
});
const signedOut: SessionState = { state: 'signed_out', csrfToken: 't', deviceRemembered: false };
const pending: SessionState = { state: 'mfa', csrfToken: 't', deviceRemembered: false };

/** Stands in for the app: a half-typed draft that must survive the sign-in overlay. */
function Draft() {
  return (
    <label>
      Draft
      <input aria-label="Draft" />
    </label>
  );
}

describe('AuthGate', () => {
  it('renders nothing from the app while the session is loading', async () => {
    let resolve: (s: SessionState) => void = () => undefined;
    const auth = fakeAuth({
      getSession: vi.fn(() => new Promise<SessionState>((r) => (resolve = r))),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    expect(screen.queryByLabelText('Draft')).toBeNull();
    await act(async () => resolve(signedIn()));
    expect(await screen.findByLabelText('Draft')).toBeInTheDocument();
  });

  it('shows sign-in when signed out', async () => {
    const auth = fakeAuth({ getSession: vi.fn(async () => signedOut) });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft')).toBeNull();
  });

  it('shows the setup step during first-time setup', async () => {
    const auth = fakeAuth({
      getSession: vi.fn(async (): Promise<SessionState> => ({
        state: 'setup',
        csrfToken: 't',
        deviceRemembered: false,
        setupStep: 'password',
      })),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    expect(await screen.findByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft')).toBeNull();
  });

  it('goes from sign-in to the app', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => pending),
      verifyMfa: vi.fn(async () => signedIn()),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText('Password (or Invite Code)'), 'my long passphrase');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByLabelText('Draft')).toBeInTheDocument();
  });

  it('a pending sign-in at launch (page reloaded on the code screen) shows the authenticator screen', async () => {
    const auth = fakeAuth({ getSession: vi.fn(async () => pending) });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    expect(
      await screen.findByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft')).toBeNull();
  });

  it('a wrong password stays on the sign-in screen; the code screen never appears', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => {
        throw new AuthError('sign_in_failed');
      }),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText('Password (or Invite Code)'), 'not the password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username or password is incorrect.',
    );
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
    expect(auth.verifyMfa).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthError('unauthenticated'), 'Your sign-in timed out. Enter your password again.'],
    [
      new AuthError('invalid_code', { attemptsLeft: 0 }),
      'Too many incorrect codes. Enter your password again.',
    ],
  ])(
    'when the pending sign-in ends, returns to the password screen and says why (%s)',
    async (error, notice) => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        getSession: vi.fn(async () => signedOut),
        signIn: vi.fn(async () => pending),
        verifyMfa: vi.fn(async () => {
          throw error;
        }),
      });
      await renderWithServices(
        <AuthGate>
          <Draft />
        </AuthGate>,
        { auth },
      );

      await user.type(await screen.findByLabelText(/username/i), 'alice');
      await user.type(screen.getByLabelText('Password (or Invite Code)'), 'my long passphrase');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));

      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(screen.getByLabelText('Password (or Invite Code)')).toBeInTheDocument();
    },
  );

  it('"Use a different account" goes back to the password screen', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => pending),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText('Password (or Invite Code)'), 'my long passphrase');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await user.click(await screen.findByRole('button', { name: 'Use a different account' }));

    expect(await screen.findByLabelText('Password (or Invite Code)')).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('on session expiry shows sign-in over the app and keeps the draft', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedIn()),
      signIn: vi.fn(async () => pending),
      verifyMfa: vi.fn(async () => signedIn()),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );
    await user.type(await screen.findByLabelText('Draft'), '2 eggs on toast');

    act(() => {
      authEvents.dispatchEvent(new Event('session-expired'));
    });

    const dialog = await screen.findByRole('dialog', { name: /sign in again/i });
    expect(dialog).toHaveTextContent(/your entries are safe/i);
    expect(screen.getByLabelText('Draft')).toHaveValue('2 eggs on toast');

    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText('Password (or Invite Code)'), 'my long passphrase');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Draft')).toHaveValue('2 eggs on toast');
  });

  it('reloads when a different person signs in over an expired session', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedIn()),
      signIn: vi.fn(async () => pending),
      verifyMfa: vi.fn(async () => signedIn(bob)),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth, reload },
    );
    await screen.findByLabelText('Draft');

    act(() => {
      authEvents.dispatchEvent(new Event('session-expired'));
    });
    await user.type(await screen.findByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText('Password (or Invite Code)'), 'my long passphrase');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('re-checks the session when a page comes back from the back/forward cache', async () => {
    const getSession = vi
      .fn<() => Promise<SessionState>>()
      .mockResolvedValueOnce(signedIn())
      .mockResolvedValueOnce(signedOut);
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth: fakeAuth({ getSession }) },
    );
    await screen.findByLabelText('Draft');

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });

    expect(await screen.findByRole('dialog', { name: /sign in again/i })).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('a normal pageshow does not re-check', async () => {
    const getSession = vi.fn(async () => signedIn());
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth: fakeAuth({ getSession }) },
    );
    await screen.findByLabelText('Draft');

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('says sign-in is unavailable when the server cannot be reached at launch', async () => {
    const auth = fakeAuth({
      getSession: vi.fn(async () => {
        throw new AuthError('network');
      }),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    expect(await screen.findByText('Sign-in is temporarily unavailable.')).toBeInTheDocument();
  });

  describe('per-account local data (US4)', () => {
    /** Shows which account's data the app was given, and whether AI is blocked. */
    function WhoseData() {
      const services = useServices();
      return (
        <p>
          data for {(services.entries as unknown as { owner: string }).owner} / ai{' '}
          {services.aiBlockedReason ?? 'allowed'}
        </p>
      );
    }

    function userData(owner: string) {
      return {
        entries: { owner },
        savedFoods: {},
        goals: {},
        log: {},
        devicePreferences: {},
        close: vi.fn(),
      } as never;
    }

    it('signed in: remembers the account, offers adoption, and opens that account’s data', async () => {
      const device = fakeDevice();
      const openUserData = vi.fn(async (id: string) => userData(id));
      const adoptLegacyData = vi.fn(async () => 'not-owner' as const);
      await renderWithServices(
        <AuthGate>
          <WhoseData />
        </AuthGate>,
        {
          auth: fakeAuth({ getSession: vi.fn(async () => signedIn()) }),
          device,
          openUserData,
          adoptLegacyData,
        },
      );

      expect(await screen.findByText(`data for ${alice.id} / ai allowed`)).toBeInTheDocument();
      expect(device.setActiveAccount).toHaveBeenCalledWith({
        userId: alice.id,
        username: 'alice',
        role: 'user',
      });
      expect(adoptLegacyData).toHaveBeenCalledWith(alice);
      expect(openUserData).toHaveBeenCalledWith(alice.id);
    });

    it('gives the app a stable services object, so effects do not re-run on every gate render', async () => {
      const seen: unknown[] = [];
      function Probe() {
        const services = useServices();
        useEffect(() => {
          seen.push(services);
        }, [services]);
        return <p>probe</p>;
      }
      await renderWithServices(
        <AuthGate>
          <Probe />
        </AuthGate>,
        { openUserData: vi.fn(async (id: string) => userData(id)) },
      );
      await screen.findByText('probe');

      act(() => {
        authEvents.dispatchEvent(new Event('session-expired'));
      });
      await screen.findByRole('dialog', { name: /sign in again/i });
      act(() => {
        authEvents.dispatchEvent(new Event('session-expired'));
      });

      expect(seen).toHaveLength(1);
    });

    it('signed out: no account data is opened', async () => {
      const openUserData = vi.fn(async (id: string) => userData(id));
      await renderWithServices(
        <AuthGate>
          <WhoseData />
        </AuthGate>,
        { auth: fakeAuth({ getSession: vi.fn(async () => signedOut) }), openUserData },
      );

      await screen.findByRole('button', { name: /^sign in$/i });
      expect(openUserData).not.toHaveBeenCalled();
    });

    it.each([['network'], ['service_unavailable']] as const)(
      'unreachable (%s) with a remembered account: opens it offline with AI blocked',
      async (code) => {
        const device = fakeDevice({
          userId: bob.id,
          username: 'bob',
          role: 'user',
          updatedAt: '2026-10-14T00:00:00.000Z',
        });
        const openUserData = vi.fn(async (id: string) => userData(id));
        await renderWithServices(
          <AuthGate>
            <WhoseData />
          </AuthGate>,
          {
            auth: fakeAuth({
              getSession: vi.fn(async () => {
                throw new AuthError(code);
              }),
            }),
            device,
            openUserData,
          },
        );

        expect(await screen.findByText(`data for ${bob.id} / ai offline`)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(
          'Offline – sign in or reconnect to use AI lookup',
        );
      },
    );

    it('unreachable with no remembered account: sign-in says it is unavailable', async () => {
      const openUserData = vi.fn(async (id: string) => userData(id));
      await renderWithServices(
        <AuthGate>
          <WhoseData />
        </AuthGate>,
        {
          auth: fakeAuth({
            getSession: vi.fn(async () => {
              throw new AuthError('network');
            }),
          }),
          device: fakeDevice(),
          openUserData,
        },
      );

      expect(await screen.findByText('Sign-in is temporarily unavailable.')).toBeInTheDocument();
      expect(openUserData).not.toHaveBeenCalled();
    });

    it('rechecks when the connection comes back', async () => {
      const device = fakeDevice({
        userId: alice.id,
        username: 'alice',
        role: 'user',
        updatedAt: '2026-10-14T00:00:00.000Z',
      });
      const getSession = vi
        .fn<() => Promise<SessionState>>()
        .mockRejectedValueOnce(new AuthError('network'))
        .mockResolvedValueOnce(signedIn());
      await renderWithServices(
        <AuthGate>
          <WhoseData />
        </AuthGate>,
        {
          auth: fakeAuth({ getSession }),
          device,
          openUserData: vi.fn(async (id: string) => userData(id)),
        },
      );
      await screen.findByText(`data for ${alice.id} / ai offline`);

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(await screen.findByText(`data for ${alice.id} / ai allowed`)).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
});
