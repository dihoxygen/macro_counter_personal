import { useEffect, useState, type FormEvent } from 'react';
import { encode } from 'uqr';
import { AuthError, type Enrollment, type SessionState, type SetupStep } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError } from '../features/shared/FormBits';

/** First-time setup: choose a password → add an authenticator → read what is sent to Claude (FR-004). */
export function SetupFlow({
  step,
  onSession,
}: {
  step: SetupStep;
  onSession: (session: SessionState) => void;
}) {
  return (
    <section className="stack">
      <header className="screen-header">
        <h1>Set up your account</h1>
      </header>
      <p className="muted">Step {['password', 'totp', 'notice'].indexOf(step) + 1} of 3</p>
      {step === 'password' && <PasswordStep onSession={onSession} />}
      {step === 'totp' && <AuthenticatorStep onSession={onSession} />}
      {step === 'notice' && <NoticeStep onSession={onSession} />}
    </section>
  );
}

const reasonMessages: Record<string, string> = {
  too_short: 'Use at least 12 characters.',
  too_long: 'Use 128 characters or fewer.',
  contains_username: "Don't include your username.",
  breached: 'This password has appeared in a data breach. Choose a different one.',
};
const SETUP_FAILED = 'Something went wrong. Please try again.';

function PasswordStep({ onSession }: { onSession: (session: SessionState) => void }) {
  const { auth } = useServices();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.setupPassword(password));
    } catch (e) {
      if (e instanceof AuthError && e.code === 'password_rejected') {
        setError((e.reasons ?? []).map((r) => reasonMessages[r] ?? SETUP_FAILED).join(' '));
      } else if (e instanceof AuthError && e.code === 'breach_check_unavailable') {
        setError("We couldn't check this password right now. Please try again in a minute.");
      } else {
        setError(SETUP_FAILED);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      <h2>Choose a password</h2>
      <p className="muted">
        At least 12 characters. A few unrelated words make a strong, memorable password.
      </p>
      <label>
        New password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <FieldError message={error} />
      <button type="submit" className="primary" disabled={busy || !password}>
        Set password
      </button>
    </form>
  );
}

function AuthenticatorStep({ onSession }: { onSession: (session: SessionState) => void }) {
  const { auth } = useServices();
  const [enrollment, setEnrollment] = useState<Enrollment | undefined>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    auth.setupTotpStart().then(
      (result) => current && setEnrollment(result),
      () => current && setError(SETUP_FAILED),
    );
    return () => {
      current = false;
    };
  }, [auth]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.setupTotpConfirm(code));
    } catch (e) {
      if (e instanceof AuthError && e.code === 'invalid_code') {
        const left = e.attemptsLeft ?? 0;
        setError(`Code didn't match. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
      } else {
        setError(SETUP_FAILED);
      }
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate>
      <h2>Add an authenticator</h2>
      <p className="muted">
        Scan this code with an authenticator app (for example Google Authenticator, Microsoft
        Authenticator or 1Password). On this phone, use the link instead, or type the setup key.
      </p>
      {enrollment && (
        <>
          <QrCode value={enrollment.otpauthUri} />
          <a className="touch link-button" href={enrollment.otpauthUri}>
            Open in authenticator app
          </a>
          <p>
            Setup key: <code className="setup-key">{enrollment.setupKey}</code>
          </p>
        </>
      )}
      <label>
        6-digit code from the app
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
      <button type="submit" className="primary" disabled={busy || code.length !== 6}>
        Confirm
      </button>
    </form>
  );
}

/** Drawn from the QR matrix as SVG elements: no injected markup, so the strict CSP holds (R11). */
function QrCode({ value }: { value: string }) {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => row.forEach((dark, x) => dark && cells.push(`M${x} ${y}h1v1h-1z`)));
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label="QR code for your authenticator app"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={cells.join('')} fill="#000000" />
    </svg>
  );
}

function NoticeStep({ onSession }: { onSession: (session: SessionState) => void }) {
  const { auth } = useServices();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function acknowledge() {
    setBusy(true);
    setError(undefined);
    try {
      onSession(await auth.acknowledgeNotice());
    } catch {
      setError(SETUP_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h2>What is sent to Claude</h2>
      <p>
        AI lookup sends the food descriptions and photos you choose to look up to Claude, an AI
        model made by Anthropic, to estimate the nutrition. Nothing else is sent: not your name,
        your food log, your goals or your history.
      </p>
      <p>
        Your food log stays on this device. The owner runs the server, which keeps only your
        account, sign-in sessions, AI usage counts and a security log.
      </p>
      <FieldError message={error} />
      <button type="button" className="primary" onClick={acknowledge} disabled={busy}>
        I understand
      </button>
    </div>
  );
}
