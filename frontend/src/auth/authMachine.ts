import type { SessionState, SessionUser, SetupStep } from '../api/auth';

// Pure sign-in state for the app shell (data-model.md: client session state). Kept in memory only.

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed_out'; notice?: 'expired' | 'unavailable' }
  | { kind: 'setup'; step: SetupStep }
  /** expired: the server no longer accepts the session; the app stays mounted under a sign-in overlay. */
  | { kind: 'signed_in'; user: SessionUser; expired: boolean }
  /** Another person is now signed in on this page: reload so nothing of the previous one stays in memory. */
  | { kind: 'reload' };

export type AuthEvent =
  | { type: 'session'; session: SessionState }
  | { type: 'session-expired' }
  | { type: 'unavailable' };

export const initialAuthState: AuthState = { kind: 'loading' };

export function transition(state: AuthState, event: AuthEvent): AuthState {
  if (state.kind === 'reload') return state;

  switch (event.type) {
    case 'session':
      return fromSession(state, event.session);
    case 'session-expired':
      if (state.kind === 'signed_in') return { ...state, expired: true };
      if (state.kind === 'setup') return { kind: 'signed_out', notice: 'expired' };
      return state;
    case 'unavailable':
      return state.kind === 'loading' ? { kind: 'signed_out', notice: 'unavailable' } : state;
  }
}

function fromSession(state: AuthState, session: SessionState): AuthState {
  const signedIn = state.kind === 'signed_in' ? state : undefined;

  if (session.state === 'signed_in' && session.user) {
    if (signedIn && signedIn.user.id !== session.user.id) return { kind: 'reload' };
    return { kind: 'signed_in', user: session.user, expired: false };
  }
  if (session.state === 'setup') {
    // A different setup cannot take over an app that still shows someone's data.
    if (signedIn) return { kind: 'reload' };
    return { kind: 'setup', step: session.setupStep ?? 'password' };
  }
  if (signedIn) return { ...signedIn, expired: true };
  return { kind: 'signed_out' };
}
