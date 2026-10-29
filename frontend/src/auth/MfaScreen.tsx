import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthError, type SessionState } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError } from '../features/shared/FormBits';
import { SIGN_IN_UNAVAILABLE } from './SignInScreen';

const WRONG_CODE = 'That code is incorrect. Try again.';
const LOCKED = 'Too many attempts. Try again later.';

/**
 * The authenticator step of a pending sign-in (004 research R1; contracts/ui-flow.md). Only the 6-digit code
 * is asked for; the password was already checked on the previous screen.
 */
export function MfaScreen({
  onSession,
  onExpired,
  onAttemptsExceeded,
  onSignedOut,
}: {
  onSession: (session: SessionState) => void;
  /** The pending sign-in ended (5 minutes, or the server no longer has it). */
  onExpired: () => void;
  /** The 5th wrong code ended the pending sign-in. */
  onAttemptsExceeded: () => void;
  /** "Use a different account": the pending sign-in was discarded. */
  onSignedOut: () => void;
}) {
  const { auth } = useServices();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.verifyMfa(code));
      return;
    } catch (e) {
      if (!(e instanceof AuthError)) setError(SIGN_IN_UNAVAILABLE);
      else if (e.code === 'unauthenticated') return onExpired();
      else if (e.code === 'invalid_code' && (e.attemptsLeft ?? 0) <= 0) return onAttemptsExceeded();
      else if (e.code === 'invalid_code') setError(wrongCode(e.attemptsLeft ?? 0));
      else if (e.code === 'rate_limited') setError(LOCKED);
      else setError(SIGN_IN_UNAVAILABLE);
      setCode('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    setBusy(true);
    // Even if the request fails, the pending sign-in ends on its own within 5 minutes.
    await auth.signOut().catch(() => undefined);
    onSignedOut();
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      <h2>Enter your authenticator code</h2>
      <p className="muted">
        Open your authenticator app and enter the 6-digit code for Macro Counter.
      </p>
      <label>
        Authenticator code
        <input
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
        />
      </label>
      <FieldError message={error} />
      <button type="submit" className="primary" disabled={busy || code.length !== 6}>
        Verify
      </button>
      <button type="button" onClick={() => void switchAccount()} disabled={busy}>
        Use a different account
      </button>
    </form>
  );
}

function wrongCode(attemptsLeft: number): string {
  if (attemptsLeft > 2) return WRONG_CODE;
  return `${WRONG_CODE} ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`;
}
