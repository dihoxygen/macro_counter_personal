import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '../../src/api/auth';
import { MfaScreen } from '../../src/auth/MfaScreen';
import { fakeAuth, renderWithServices } from './testServices';

const signedIn = {
  state: 'signed_in' as const,
  csrfToken: 't',
  deviceRemembered: false,
  user: { id: '6f1c2a4e-0000-4000-8000-000000000001', username: 'alice', role: 'user' as const },
};

function handlers() {
  return {
    onSession: vi.fn(),
    onExpired: vi.fn(),
    onAttemptsExceeded: vi.fn(),
    onSignedOut: vi.fn(),
  };
}

function failing(error: AuthError) {
  return fakeAuth({
    verifyMfa: vi.fn(async () => {
      throw error;
    }),
  });
}

async function enter(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  await user.type(screen.getByLabelText('Authenticator code'), code);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('MfaScreen (specs/004-security-qol/contracts/ui-flow.md)', () => {
  it('asks only for the 6-digit code, with the numeric keypad and focus', async () => {
    await renderWithServices(<MfaScreen {...handlers()} />);

    expect(
      screen.getByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Open your authenticator app and enter the 6-digit code for Macro Counter.'),
    ).toBeInTheDocument();
    const code = screen.getByLabelText('Authenticator code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveFocus();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it('strips non-digits and enables Verify only at 6 digits', async () => {
    const user = userEvent.setup();
    await renderWithServices(<MfaScreen {...handlers()} />);
    const code = screen.getByLabelText('Authenticator code');
    const verify = screen.getByRole('button', { name: 'Verify' });

    await user.type(code, '12a 34-5');
    expect(code).toHaveValue('12345');
    expect(verify).toBeDisabled();
    await user.type(code, '6');
    expect(verify).toBeEnabled();
  });

  it('sends the code and reports the new session', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth({ verifyMfa: vi.fn(async () => signedIn) });
    const on = handlers();
    await renderWithServices(<MfaScreen {...on} />, { auth });

    await enter(user);

    expect(auth.verifyMfa).toHaveBeenCalledWith('123456');
    expect(on.onSession).toHaveBeenCalledWith(signedIn);
  });

  it('says a wrong code is incorrect and clears the field', async () => {
    const user = userEvent.setup();
    const on = handlers();
    await renderWithServices(<MfaScreen {...on} />, {
      auth: failing(new AuthError('invalid_code', { attemptsLeft: 4 })),
    });

    await enter(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That code is incorrect\. Try again\.$/,
    );
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
    expect(on.onSession).not.toHaveBeenCalled();
  });

  it.each([
    [2, 'That code is incorrect. Try again. 2 attempts left.'],
    [1, 'That code is incorrect. Try again. 1 attempt left.'],
  ])('warns when only %i attempts are left', async (attemptsLeft, message) => {
    const user = userEvent.setup();
    await renderWithServices(<MfaScreen {...handlers()} />, {
      auth: failing(new AuthError('invalid_code', { attemptsLeft })),
    });

    await enter(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('after the 5th wrong code (no attempts left) hands back to the password step', async () => {
    const user = userEvent.setup();
    const on = handlers();
    await renderWithServices(<MfaScreen {...on} />, {
      auth: failing(new AuthError('invalid_code', { attemptsLeft: 0 })),
    });

    await enter(user);

    await vi.waitFor(() => expect(on.onAttemptsExceeded).toHaveBeenCalled());
    expect(on.onExpired).not.toHaveBeenCalled();
  });

  it('when the pending sign-in has ended (401) hands back as timed out', async () => {
    const user = userEvent.setup();
    const on = handlers();
    await renderWithServices(<MfaScreen {...on} />, {
      auth: failing(new AuthError('unauthenticated')),
    });

    await enter(user);

    await vi.waitFor(() => expect(on.onExpired).toHaveBeenCalled());
    expect(on.onAttemptsExceeded).not.toHaveBeenCalled();
  });

  it('when locked out says so and offers the way back', async () => {
    const user = userEvent.setup();
    await renderWithServices(<MfaScreen {...handlers()} />, {
      auth: failing(new AuthError('rate_limited')),
    });

    await enter(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later.',
    );
  });

  it('"Use a different account" signs the pending sign-in out', async () => {
    const user = userEvent.setup();
    const auth = fakeAuth();
    const on = handlers();
    await renderWithServices(<MfaScreen {...on} />, { auth });

    await user.click(screen.getByRole('button', { name: 'Use a different account' }));

    expect(auth.signOut).toHaveBeenCalled();
    await vi.waitFor(() => expect(on.onSignedOut).toHaveBeenCalled());
  });
});
