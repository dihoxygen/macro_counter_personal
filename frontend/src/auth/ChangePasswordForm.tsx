import { useState, type FormEvent } from 'react';
import { AuthError } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError, PasswordInput } from '../features/shared/FormBits';
import { reasonMessages } from './SetupFlow';

const FAILED = 'Something went wrong. Please try again.';

/**
 * Change your own password (ASVS 2.1.5, 2.1.6). The current password and an authenticator code are both
 * required; on success the server ends every other session and keeps this one.
 */
export function ChangePasswordForm() {
  const { auth } = useServices();
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (password !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await auth.changePassword(current, code, password);
      setCurrent('');
      setCode('');
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (e) {
      setError(messageFor(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      <h2>Change password</h2>
      <PasswordInput
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        maxLength={128}
      />
      <label>
        Authenticator code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
        />
      </label>
      <PasswordInput
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />
      <PasswordInput
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
      <FieldError message={error} />
      {done && <p role="status">Password changed. Your other devices have been signed out.</p>}
      <button type="submit" disabled={busy || !current || code.length !== 6 || !password}>
        Change password
      </button>
    </form>
  );
}

function messageFor(error: unknown): string {
  if (!(error instanceof AuthError)) return FAILED;
  switch (error.code) {
    case 'invalid_credentials':
      return "Your current password or authenticator code didn't match.";
    case 'password_rejected':
      return (error.reasons ?? []).map((r) => reasonMessages[r] ?? FAILED).join(' ') || FAILED;
    case 'breach_check_unavailable':
      return "We couldn't check this password right now. Please try again in a minute.";
    case 'rate_limited':
      return 'Too many attempts. Try again later.';
    default:
      return FAILED;
  }
}
