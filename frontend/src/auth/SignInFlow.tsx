import { useState } from 'react';
import type { SessionState } from '../api/auth';
import type { SignInNotice } from './authMachine';
import { MfaScreen } from './MfaScreen';
import { SignInScreen } from './SignInScreen';

/**
 * The two sign-in steps (004 research R1): the password screen, then, when the password was right, the
 * authenticator screen. A pending sign-in stays inside this flow; only a completed step (signed in, or setup)
 * reaches `onSession`, so the expired overlay can run both steps over the app without replacing it.
 */
export function SignInFlow({
  onSession,
  notice,
  deviceRemembered = false,
  startAt = 'password',
}: {
  onSession: (session: SessionState) => void;
  notice?: SignInNotice;
  /** From the last session response: Remember User starts ticked (004 FR-003). */
  deviceRemembered?: boolean;
  /** 'mfa' when a pending sign-in already exists (the page was reloaded on the code screen). */
  startAt?: 'password' | 'mfa';
}) {
  const [step, setStep] = useState(startAt);
  const [shown, setShown] = useState<SignInNotice | undefined>(notice);

  function backToPassword(why?: SignInNotice) {
    setShown(why);
    setStep('password');
  }

  if (step === 'mfa') {
    return (
      <MfaScreen
        onSession={onSession}
        onExpired={() => backToPassword('mfa_expired')}
        onAttemptsExceeded={() => backToPassword('mfa_attempts')}
        onSignedOut={() => backToPassword()}
      />
    );
  }
  return (
    <SignInScreen
      notice={shown}
      deviceRemembered={deviceRemembered}
      onSession={(session) => (session.state === 'mfa' ? setStep('mfa') : onSession(session))}
    />
  );
}
