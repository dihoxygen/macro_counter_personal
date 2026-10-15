import { createContext, useContext } from 'react';
import type { SessionUser } from '../api/auth';

/** The signed-in person, provided by AuthGate. Null outside it (e.g. in tests of single screens). */
export const CurrentUserContext = createContext<SessionUser | null>(null);

export function useCurrentUser(): SessionUser | null {
  return useContext(CurrentUserContext);
}
