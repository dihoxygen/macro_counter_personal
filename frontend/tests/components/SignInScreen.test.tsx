import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '../../src/api/auth';
import { SignInScreen } from '../../src/auth/SignInScreen';
import { fakeAuth, renderWithServices } from './testServices';

const pending = { state: 'mfa' as const, csrfToken: 't', deviceRemembered: false };

const PASSWORD_LABEL = 'Password (or Invite Code)';

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/username/i), 'alice');
  await user.type(screen.getByLabelText(PASSWORD_LABEL), 'my long passphrase');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('SignInScreen', () => {
  it('asks only for the username and the password (or invite code), with the right input hints', async () => {
    await renderWithServices(<SignInScreen onSession={vi.fn()} />);

    const username = screen.getByLabelText(/username/i);
    expect(username).toHaveAttribute('autocomplete', 'username');
    const password = screen.getByLabelText(PASSWORD_LABEL);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    // 004 FR-002: the authenticator code has its own screen.
    expect(screen.queryByLabelText(/authenticator/i)).toBeNull();
    expect(screen.queryByText(/temporary code/i)).toBeNull();
  });

  it('can show the password while typing and hide it again (ASVS 2.1.12)', async () => {
    const user = userEvent.setup();
    await renderWithServices(<SignInScreen onSession={vi.fn()} />);
    const password = screen.getByLabelText(PASSWORD_LABEL);

    const toggle = screen.getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-controls', password.id);

    await user.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('offers no way to sign up, register or request access', async () => {
    const { container } = await renderWithServices(<SignInScreen onSession={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const forbidden of [/sign\s*up/i, /register/i, /create (an )?account/i, /request/i]) {
      expect(text).not.toMatch(forbidden);
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Show', 'Sign in']);
  });

  it('sends the username and password and reports the session state', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({ signIn: vi.fn(async () => pending) });
    const onSession = vi.fn();
    await renderWithServices(<SignInScreen onSession={onSession} />, { auth });

    await fill(user);

    expect(auth.signIn).toHaveBeenCalledWith('alice', 'my long passphrase', undefined);
    expect(onSession).toHaveBeenCalledWith(pending);
  });

  it.each([
    ['sign_in_failed', 'Username or password is incorrect.'],
    ['rate_limited', 'Too many attempts. Try again later.'],
    ['service_unavailable', 'Sign-in is temporarily unavailable.'],
    ['network', 'Sign-in is temporarily unavailable.'],
  ] as const)('shows the message for %s', async (code, message) => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      signIn: vi.fn(async () => {
        throw new AuthError(code);
      }),
    });
    const onSession = vi.fn();
    await renderWithServices(<SignInScreen onSession={onSession} />, { auth });

    await fill(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onSession).not.toHaveBeenCalled();
  });

  it('clears the password after a failure, keeping the username', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({
      signIn: vi.fn(async () => {
        throw new AuthError('sign_in_failed');
      }),
    });
    await renderWithServices(<SignInScreen onSession={vi.fn()} />, { auth });

    await fill(user);
    await screen.findByRole('alert');

    expect(screen.getByLabelText(/username/i)).toHaveValue('alice');
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveValue('');
  });

  describe('Remember User (004 US3)', () => {
    it('sits after the password field, unticked unless this browser is remembered', async () => {
      const user = userEvent.setup();
      await renderWithServices(<SignInScreen onSession={vi.fn()} />);

      const box = screen.getByRole('checkbox', { name: 'Remember User' });
      expect(box).not.toBeChecked();
      await user.click(screen.getByLabelText(/username/i));
      await user.tab(); // password
      await user.tab(); // Show
      await user.tab();
      expect(box).toHaveFocus();
    });

    it('shows ticked when this browser is already remembered', async () => {
      await renderWithServices(<SignInScreen onSession={vi.fn()} deviceRemembered />);
      expect(screen.getByRole('checkbox', { name: 'Remember User' })).toBeChecked();
    });

    it.each([false, true])(
      'sends no choice when the box is left alone (remembered: %s)',
      async (deviceRemembered) => {
        const user = userEvent.setup();
        const auth = fakeAuth({ signIn: vi.fn(async () => pending) });
        await renderWithServices(
          <SignInScreen onSession={vi.fn()} deviceRemembered={deviceRemembered} />,
          { auth },
        );

        await fill(user);

        expect(auth.signIn).toHaveBeenCalledWith('alice', 'my long passphrase', undefined);
      },
    );

    it.each([
      ['ticking it', false, 1, true],
      ['ticking then unticking it', false, 2, false],
      ['unticking a remembered browser', true, 1, false],
      ['unticking then re-ticking a remembered browser', true, 2, true],
    ] as const)(
      'sends the final choice after %s',
      async (_name, deviceRemembered, clicks, expected) => {
        const user = userEvent.setup();
        const auth = fakeAuth({ signIn: vi.fn(async () => pending) });
        await renderWithServices(
          <SignInScreen onSession={vi.fn()} deviceRemembered={deviceRemembered} />,
          { auth },
        );

        for (let i = 0; i < clicks; i++) {
          await user.click(screen.getByRole('checkbox', { name: 'Remember User' }));
        }
        await fill(user);

        expect(auth.signIn).toHaveBeenCalledWith('alice', 'my long passphrase', expected);
      },
    );

    it('a remembered browser signs straight in, with no code screen', async () => {
      const user = userEvent.setup();
      const signedIn = {
        state: 'signed_in' as const,
        csrfToken: 't',
        deviceRemembered: true,
        user: {
          id: '6f1c2a4e-0000-4000-8000-000000000001',
          username: 'alice',
          role: 'user' as const,
        },
      };
      const auth = fakeAuth({ signIn: vi.fn(async () => signedIn) });
      const onSession = vi.fn();
      await renderWithServices(<SignInScreen onSession={onSession} deviceRemembered />, { auth });

      await fill(user);

      expect(onSession).toHaveBeenCalledWith(signedIn);
    });
  });

  it.each([
    ['expired', /your session ended/i],
    ['unavailable', /^Sign-in is temporarily unavailable\.$/],
    ['mfa_expired', /^Your sign-in timed out\. Enter your password again\.$/],
    ['mfa_attempts', /^Too many incorrect codes\. Enter your password again\.$/],
  ] as const)('explains why sign-in is shown (%s)', async (notice, text) => {
    await renderWithServices(<SignInScreen onSession={vi.fn()} notice={notice} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
