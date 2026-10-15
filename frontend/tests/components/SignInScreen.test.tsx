import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '../../src/api/auth';
import { SignInScreen } from '../../src/auth/SignInScreen';
import { fakeAuth, renderWithServices } from './testServices';

const signedIn = {
  state: 'signed_in' as const,
  csrfToken: 't',
  user: { id: '6f1c2a4e-0000-4000-8000-000000000001', username: 'alice', role: 'user' as const },
};

async function fill(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  await user.type(screen.getByLabelText(/username/i), 'alice');
  await user.type(screen.getByLabelText(/password or temporary code/i), 'my long passphrase');
  if (code) await user.type(screen.getByLabelText(/authenticator code/i), code);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('SignInScreen', () => {
  it('has the three fields with the right input hints', async () => {
    await renderWithServices(<SignInScreen onSession={vi.fn()} />);

    const username = screen.getByLabelText(/username/i);
    expect(username).toHaveAttribute('autocomplete', 'username');
    const password = screen.getByLabelText(/password or temporary code/i);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    const code = screen.getByLabelText(/authenticator code \(leave blank on first sign-in\)/i);
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('offers no way to sign up, register or request access', async () => {
    const { container } = await renderWithServices(<SignInScreen onSession={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const forbidden of [/sign\s*up/i, /register/i, /create (an )?account/i, /request/i]) {
      expect(text).not.toMatch(forbidden);
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
  });

  it('sends the details and reports the session state', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({ signIn: vi.fn(async () => signedIn) });
    const onSession = vi.fn();
    await renderWithServices(<SignInScreen onSession={onSession} />, { auth });

    await fill(user);

    expect(auth.signIn).toHaveBeenCalledWith('alice', 'my long passphrase', '123456');
    expect(onSession).toHaveBeenCalledWith(signedIn);
  });

  it('sends no code when the field is left blank (first sign-in)', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({ signIn: vi.fn(async () => signedIn) });
    await renderWithServices(<SignInScreen onSession={vi.fn()} />, { auth });

    await fill(user, '');

    expect(auth.signIn).toHaveBeenCalledWith('alice', 'my long passphrase', undefined);
  });

  it.each([
    ['sign_in_failed', 'Could not sign in. Check your details and try again.'],
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

  it('clears the password and code after a failure, keeping the username', async () => {
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
    expect(screen.getByLabelText(/password or temporary code/i)).toHaveValue('');
    expect(screen.getByLabelText(/authenticator code/i)).toHaveValue('');
  });

  it('shows why sign-in is needed again after a session expired', async () => {
    await renderWithServices(<SignInScreen onSession={vi.fn()} notice="expired" />);
    expect(screen.getByText(/your session ended/i)).toBeInTheDocument();
  });

  it('says when sign-in is unavailable at launch', async () => {
    await renderWithServices(<SignInScreen onSession={vi.fn()} notice="unavailable" />);
    expect(screen.getByText('Sign-in is temporarily unavailable.')).toBeInTheDocument();
  });
});
