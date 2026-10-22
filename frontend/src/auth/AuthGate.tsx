import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SessionState, SessionUser } from '../api/auth';
import { authEvents } from '../api/http';
import { ServicesProvider, useServices, type Services, type UserData } from '../app/services';
import { initialAuthState, transition } from './authMachine';
import { CurrentUserContext } from './currentUser';
import { SessionExpiredOverlay } from './SessionExpiredOverlay';
import { SetupFlow } from './SetupFlow';
import { SignInScreen } from './SignInScreen';

export const OFFLINE_BANNER = 'Offline – sign in or reconnect to use AI lookup';

/**
 * Nothing that talks to the server is reachable until the person is signed in (US1), and only the signed-in
 * person's own local data is opened (US4). Offline, the last signed-in account keeps working locally.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const services = useServices();
  const { auth, reload, device } = services;
  const [state, dispatch] = useReducer(transition, initialAuthState);

  const onSession = useCallback(
    (session: SessionState) => dispatch({ type: 'session', session }),
    [],
  );

  const check = useCallback(async () => {
    try {
      onSession(await auth.getSession());
    } catch {
      // Server or database unreachable: fall back to whoever was last signed in here, if anyone (R9).
      const last = await device.getActiveAccount().catch(() => undefined);
      dispatch({
        type: 'unavailable',
        account: last && { id: last.userId, username: last.username, role: last.role },
      });
    }
  }, [auth, device, onSession]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const expired = () => dispatch({ type: 'session-expired' });
    // A page restored from the back/forward cache may show a screen from before sign-out (US1.3).
    const restored = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) void check();
    };
    const online = () => void check();
    authEvents.addEventListener('session-expired', expired);
    window.addEventListener('pageshow', restored);
    window.addEventListener('online', online);
    return () => {
      authEvents.removeEventListener('session-expired', expired);
      window.removeEventListener('pageshow', restored);
      window.removeEventListener('online', online);
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
        <AccountData services={services} user={state.user} remember>
          {children}
          {state.expired && <SessionExpiredOverlay onSession={onSession} />}
        </AccountData>
      );
    case 'offline':
      return (
        <AccountData services={services} user={state.user} offline>
          <p role="status" className="warning banner">
            {OFFLINE_BANNER}
          </p>
          {children}
        </AccountData>
      );
  }
}

/** Opens one account's own database and provides it to the app (FR-016). */
function AccountData({
  services,
  user,
  remember = false,
  offline = false,
  children,
}: {
  services: Services;
  user: SessionUser;
  remember?: boolean;
  offline?: boolean;
  children: ReactNode;
}) {
  const [data, setData] = useState<UserData | undefined>();
  const current = useRef<UserData | undefined>(undefined);
  const { device, adoptLegacyData, openUserData } = services;
  const { id, username, role } = user;

  useEffect(() => () => current.current?.close(), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (remember) {
        await device.setActiveAccount({ userId: id, username, role });
        // Only the owner ever receives the pre-feature data; a failure leaves it for the next sign-in.
        await adoptLegacyData({ id, username, role }).catch((error: unknown) =>
          console.warn('Adopting earlier data failed', error),
        );
      }
      const opened = await openUserData(id);
      if (!active) {
        opened.close();
        return;
      }
      // Swap in the new connection before closing the old one (e.g. offline → signed in).
      const previous = current.current;
      current.current = opened;
      setData(opened);
      previous?.close();
    })();
    return () => {
      active = false;
    };
  }, [device, adoptLegacyData, openUserData, id, username, role, remember]);

  // Stable across gate re-renders (e.g. the sign-in overlay appearing): effects that depend on the
  // services must not re-run, or each refused request would trigger the next one.
  const accountServices = useMemo<Services | undefined>(
    () =>
      data && {
        ...services,
        entries: data.entries,
        savedFoods: data.savedFoods,
        goals: data.goals,
        log: data.log,
        devicePreferences: data.devicePreferences,
        aiBlockedReason: offline ? 'offline' : undefined,
      },
    [services, data, offline],
  );

  if (!accountServices) return <p className="muted app">Loading…</p>;
  return (
    <ServicesProvider services={accountServices}>
      <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
    </ServicesProvider>
  );
}
