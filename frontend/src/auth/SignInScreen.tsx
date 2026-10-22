import { useState, type FormEvent } from 'react';
import { AuthError, type AuthErrorCode, type SessionState } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError, PasswordInput } from '../features/shared/FormBits';

export const SIGN_IN_FAILED = 'Could not sign in. Check your details and try again.';
export const SIGN_IN_UNAVAILABLE = 'Sign-in is temporarily unavailable.';

const messages: Partial<Record<AuthErrorCode, string>> = {
  rate_limited: 'Too many attempts. Try again later.',
  service_unavailable: SIGN_IN_UNAVAILABLE,
  network: SIGN_IN_UNAVAILABLE,
};

/**
 * Username, password (or the one-time temporary code on first sign-in) and authenticator code, sent
 * together so a failure never says which part was wrong (FR-006). There is deliberately no sign-up.
 */
export function SignInScreen({
  onSession,
  notice,
}: {
  onSession: (session: SessionState) => void;
  notice?: 'expired' | 'unavailable';
}) {
  const { auth } = useServices();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.signIn(username.trim(), password, code.trim() || undefined));
    } catch (e) {
      setError((e instanceof AuthError && messages[e.code]) || SIGN_IN_FAILED);
      setPassword('');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      {notice === 'expired' && (
        <p className="muted">Your session ended. Sign in again; your entries are safe.</p>
      )}
      {notice === 'unavailable' && <p className="muted">{SIGN_IN_UNAVAILABLE}</p>}
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
        label="Password or temporary code"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        maxLength={128}
      />
      <label>
        Authenticator code (leave blank on first sign-in)
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
        />
      </label>
      <FieldError message={error} />
      <button type="submit" className="primary" disabled={busy || !username.trim() || !password}>
        Sign in
      </button>
    </form>
  );
}
