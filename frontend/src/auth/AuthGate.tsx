import { useCallback, useEffect, useReducer, type ReactNode } from 'react';
import type { SessionState } from '../api/auth';
import { authEvents } from '../api/http';
import { useServices } from '../app/services';
import { initialAuthState, transition } from './authMachine';
import { CurrentUserContext } from './currentUser';
import { SessionExpiredOverlay } from './SessionExpiredOverlay';
import { SetupFlow } from './SetupFlow';
import { SignInScreen } from './SignInScreen';

/**
 * Nothing that talks to the server is reachable until the person is signed in (US1). Decides between
 * sign-in, first-time setup and the app, and re-asks for sign-in over the app when a session ends.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { auth, reload } = useServices();
  const [state, dispatch] = useReducer(transition, initialAuthState);

  const onSession = useCallback(
    (session: SessionState) => dispatch({ type: 'session', session }),
    [],
  );

  const check = useCallback(async () => {
    try {
      onSession(await auth.getSession());
    } catch {
      dispatch({ type: 'unavailable' });
    }
  }, [auth, onSession]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const expired = () => dispatch({ type: 'session-expired' });
    // A page restored from the back/forward cache may show a screen from before sign-out (US1.3).
    const restored = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) void check();
    };
    authEvents.addEventListener('session-expired', expired);
    window.addEventListener('pageshow', restored);
    return () => {
      authEvents.removeEventListener('session-expired', expired);
      window.removeEventListener('pageshow', restored);
    };
  }, [check]);

  useEffect(() => {
    if (state.kind === 'reload') reload();
  }, [state.kind, reload]);

  switch (state.kind) {
    case 'loading':
    case 'reload':
      return <p className="muted app">Loading…</p>;
    case 'signed_out':
      return (
        <main className="app">
          <section className="stack">
            <header className="screen-header">
              <h1>Macro Counter</h1>
            </header>
            <SignInScreen onSession={onSession} notice={state.notice} />
          </section>
        </main>
      );
    case 'setup':
      return (
        <main className="app">
          <SetupFlow step={state.step} onSession={onSession} />
        </main>
      );
    case 'signed_in':
      return (
        <CurrentUserContext.Provider value={state.user}>
          {children}
          {state.expired && <SessionExpiredOverlay onSession={onSession} />}
        </CurrentUserContext.Provider>
      );
  }
}
