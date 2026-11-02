import { useState, type FormEvent } from 'react';
import { AuthError, type AuthErrorCode, type SessionState } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError, PasswordInput } from '../features/shared/FormBits';
import type { SignInNotice } from './authMachine';
import { normalizeUsername } from './rememberedUser';

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
  rememberedUsername,
}: {
  onSession: (session: SessionState) => void;
  notice?: SignInNotice;
  /** The account this browser is remembered for, normalized: Remember User starts ticked for it (004 FR-003). */
  rememberedUsername?: string;
}) {
  const { auth } = useServices();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // What the box shows is what is sent (004 FR-003). Until the person clicks it, it follows the username: ticked
  // only for the account this browser is remembered for.
  const [rememberChoice, setRememberChoice] = useState<boolean | undefined>();
  const remember =
    rememberChoice ??
    (rememberedUsername !== undefined && normalizeUsername(username) === rememberedUsername);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.signIn(username.trim(), password, remember));
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
          onChange={(e) => setRememberChoice(e.target.checked)}
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
