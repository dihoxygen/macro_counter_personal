import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '../../src/api/auth';
import { SetupFlow } from '../../src/auth/SetupFlow';
import { fakeAuth, renderWithServices } from './testServices';

const enrollment = {
  setupKey: 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
  otpauthUri:
    'otpauth://totp/Macro%20Counter:alice?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Macro%20Counter&digits=6&period=30',
};
const nextStep = (step: 'password' | 'totp' | 'notice') => ({
  state: 'setup' as const,
  csrfToken: 't',
  setupStep: step,
});
const signedIn = {
  state: 'signed_in' as const,
  csrfToken: 't',
  user: { id: '6f1c2a4e-0000-4000-8000-000000000001', username: 'alice', role: 'user' as const },
};

describe('SetupFlow', () => {
  describe('password step', () => {
    async function choose(
      user: ReturnType<typeof userEvent.setup>,
      password: string,
      confirm = password,
    ) {
      await user.type(screen.getByLabelText(/^new password$/i), password);
      await user.type(screen.getByLabelText(/confirm new password/i), confirm);
      await user.click(screen.getByRole('button', { name: /set password/i }));
    }

    it('sets the password and moves on', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth({ setupPassword: vi.fn(async () => nextStep('totp')) });
      const onSession = vi.fn();
      await renderWithServices(<SetupFlow step="password" onSession={onSession} />, { auth });

      expect(screen.getByLabelText(/^new password$/i)).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      await choose(user, 'a long and private passphrase');

      expect(auth.setupPassword).toHaveBeenCalledWith('a long and private passphrase');
      expect(onSession).toHaveBeenCalledWith(nextStep('totp'));
    });

    it('can show each new password field on its own (ASVS 2.1.12)', async () => {
      const user = userEvent.setup();
      await renderWithServices(<SetupFlow step="password" onSession={vi.fn()} />);

      const fresh = screen.getByLabelText(/^new password$/i);
      const confirm = screen.getByLabelText(/confirm new password/i);
      const toggles = screen.getAllByRole('button', { name: 'Show' });
      expect(toggles.map((t) => t.getAttribute('aria-controls'))).toEqual([fresh.id, confirm.id]);

      await user.click(toggles[0]!);
      expect(fresh).toHaveAttribute('type', 'text');
      expect(confirm).toHaveAttribute('type', 'password');
    });

    it('catches a mistyped confirmation before sending', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth();
      await renderWithServices(<SetupFlow step="password" onSession={vi.fn()} />, { auth });

      await choose(user, 'a long and private passphrase', 'a long and private passphrasf');

      expect(await screen.findByRole('alert')).toHaveTextContent("The passwords don't match.");
      expect(auth.setupPassword).not.toHaveBeenCalled();
    });

    it.each([
      ['too_short', 'Use at least 12 characters.'],
      ['too_long', 'Use 128 characters or fewer.'],
      ['contains_username', "Don't include your username."],
      ['breached', 'This password has appeared in a data breach. Choose a different one.'],
    ])('explains the %s rejection', async (reason, message) => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        setupPassword: vi.fn(async () => {
          throw new AuthError('password_rejected', { reasons: [reason] });
        }),
      });
      await renderWithServices(<SetupFlow step="password" onSession={vi.fn()} />, { auth });

      await choose(user, 'whatever it is here');

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
    });

    it('asks to retry when the breach check is unavailable', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        setupPassword: vi.fn(async () => {
          throw new AuthError('breach_check_unavailable');
        }),
      });
      await renderWithServices(<SetupFlow step="password" onSession={vi.fn()} />, { auth });

      await choose(user, 'a long and private passphrase');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "We couldn't check this password right now. Please try again in a minute.",
      );
    });
  });

  describe('authenticator step', () => {
    it('shows a QR code, the grouped setup key and an app link', async () => {
      const auth = fakeAuth({ setupTotpStart: vi.fn(async () => enrollment) });
      const { container } = await renderWithServices(
        <SetupFlow step="totp" onSession={vi.fn()} />,
        { auth },
      );

      expect(await screen.findByText(enrollment.setupKey)).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
      expect(screen.getByRole('img', { name: /qr code/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /open in authenticator app/i })).toHaveAttribute(
        'href',
        enrollment.otpauthUri,
      );
    });

    it('confirms a code and moves on', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        setupTotpStart: vi.fn(async () => enrollment),
        setupTotpConfirm: vi.fn(async () => nextStep('notice')),
      });
      const onSession = vi.fn();
      await renderWithServices(<SetupFlow step="totp" onSession={onSession} />, { auth });

      const code = await screen.findByLabelText(/6-digit code/i);
      expect(code).toHaveAttribute('inputmode', 'numeric');
      expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      await user.type(code, '123456');
      await user.click(screen.getByRole('button', { name: /confirm/i }));

      expect(auth.setupTotpConfirm).toHaveBeenCalledWith('123456');
      expect(onSession).toHaveBeenCalledWith(nextStep('notice'));
    });

    it('reports a wrong code with the attempts left', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth({
        setupTotpStart: vi.fn(async () => enrollment),
        setupTotpConfirm: vi.fn(async () => {
          throw new AuthError('invalid_code', { attemptsLeft: 3 });
        }),
      });
      await renderWithServices(<SetupFlow step="totp" onSession={vi.fn()} />, { auth });

      await user.type(await screen.findByLabelText(/6-digit code/i), '000000');
      await user.click(screen.getByRole('button', { name: /confirm/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Code didn't match. 3 attempts left.",
      );
    });
  });

  describe('notice step', () => {
    it('explains what is sent to Claude and who runs the server, then finishes setup', async () => {
      const user = userEvent.setup();
      const auth = fakeAuth({ acknowledgeNotice: vi.fn(async () => signedIn) });
      const onSession = vi.fn();
      await renderWithServices(<SetupFlow step="notice" onSession={onSession} />, { auth });

      const text = document.body.textContent ?? '';
      expect(text).toMatch(/Claude/);
      expect(text).toMatch(/Anthropic/);
      expect(text).toMatch(/food descriptions and photos/i);
      expect(text).toMatch(/owner runs the server/i);

      await user.click(screen.getByRole('button', { name: 'I understand' }));

      expect(auth.acknowledgeNotice).toHaveBeenCalled();
      expect(onSession).toHaveBeenCalledWith(signedIn);
    });
  });
});
