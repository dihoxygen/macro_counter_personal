import type { SessionState } from '../api/auth';
import { SignInFlow } from './SignInFlow';

/**
 * Sign-in shown on top of the app when the session ends mid-use. The app underneath stays mounted, so
 * an estimate being reviewed or a half-typed entry is still there afterwards (US1.4).
 */
export function SessionExpiredOverlay({
  onSession,
  deviceRemembered = false,
}: {
  onSession: (session: SessionState) => void;
  deviceRemembered?: boolean;
}) {
  return (
    <div className="overlay">
      <div
        className="card stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
      >
        <h2 id="session-expired-title">Sign in again</h2>
        <p className="muted">Your session ended. Your entries are safe on this device.</p>
        <SignInFlow onSession={onSession} deviceRemembered={deviceRemembered} />
      </div>
    </div>
  );
}
