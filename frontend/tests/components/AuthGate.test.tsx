import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError, type SessionState } from '../../src/api/auth';
import { authEvents } from '../../src/api/http';
import { AuthGate } from '../../src/auth/AuthGate';
import { fakeAuth, renderWithServices } from './testServices';

const alice = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user' as const,
};
const bob = { id: '6f1c2a4e-0000-4000-8000-000000000002', username: 'bob', role: 'user' as const };
const signedIn = (user = alice): SessionState => ({ state: 'signed_in', csrfToken: 't', user });
const signedOut: SessionState = { state: 'signed_out', csrfToken: 't' };

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
      signIn: vi.fn(async () => signedIn()),
    });
    await renderWithServices(
      <AuthGate>
        <Draft />
      </AuthGate>,
      { auth },
    );

    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password or temporary code/i), 'my long passphrase');
    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByLabelText('Draft')).toBeInTheDocument();
  });

  it('on session expiry shows sign-in over the app and keeps the draft', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedIn()),
      signIn: vi.fn(async () => signedIn()),
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
    await user.type(screen.getByLabelText(/password or temporary code/i), 'my long passphrase');
    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Draft')).toHaveValue('2 eggs on toast');
  });

  it('reloads when a different person signs in over an expired session', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const auth = fakeAuth({
      getSession: vi.fn(async () => signedIn()),
      signIn: vi.fn(async () => signedIn(bob)),
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
    await user.type(screen.getByLabelText(/password or temporary code/i), 'my long passphrase');
    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

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
});
