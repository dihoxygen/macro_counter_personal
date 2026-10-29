import { useState, type FormEvent } from 'react';
import { AuthError, type AuthErrorCode, type SessionState } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError, PasswordInput } from '../features/shared/FormBits';
import type { SignInNotice } from './authMachine';

export const SIGN_IN_FAILED = 'Username or password is incorrect.';
export const SIGN_IN_UNAVAILABLE = 'Sign-in is temporarily unavailable.';

const messages: Partial<Record<AuthErrorCode, string>> = {
  rate_limited: 'Too many attempts. Try again later.',
  service_unavailable: SIGN_IN_UNAVAILABLE,
  network: SIGN_IN_UNAVAILABLE,
};

const notices: Record<SignInNotice, string> = {
  expired: 'Your session ended. Sign in again; your entries are safe.',
  unavailable: SIGN_IN_UNAVAILABLE,
  mfa_expired: 'Your sign-in timed out. Enter your password again.',
  mfa_attempts: 'Too many incorrect codes. Enter your password again.',
};

/**
 * The password step: username and password, or the one-time invite code on first sign-in. A wrong
 * password fails here; the authenticator code is asked for on the next screen (004 research R1).
 * There is deliberately no sign-up.
 */
export function SignInScreen({
  onSession,
  notice,
  deviceRemembered = false,
}: {
  onSession: (session: SessionState) => void;
  notice?: SignInNotice;
  /** This browser is remembered for some account: Remember User starts ticked (004 FR-003). */
  deviceRemembered?: boolean;
}) {
  const { auth } = useServices();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(deviceRemembered);
  // Only a change the person makes is a choice; an untouched box keeps the current state (004 FR-003).
  const [rememberTouched, setRememberTouched] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSession(
        await auth.signIn(username.trim(), password, rememberTouched ? remember : undefined),
      );
    } catch (e) {
      setError((e instanceof AuthError && messages[e.code]) || SIGN_IN_FAILED);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      {notice && <p className="muted">{notices[notice]}</p>}
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
          required
        />
      </label>
      <PasswordInput
        label="Password (or Invite Code)"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        maxLength={128}
      />
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => {
            setRemember(e.target.checked);
            setRememberTouched(true);
          }}
        />
        Remember User
      </label>
      <FieldError message={error} />
      <button type="submit" className="primary" disabled={busy || !username.trim() || !password}>
        Sign in
      </button>
    </form>
  );
}
