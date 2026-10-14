import { createContext, useContext, type ReactNode } from 'react';
import type { AuthApi } from '../api/auth';
import type { Estimate } from '../api/estimates';
import type { Status } from '../api/status';
import type { LogService } from '../data/logService';
import type {
  EntryRepository,
  ProteinGoalRepository,
  SavedFoodRepository,
} from '../data/repositories';

/** Everything the UI needs from the outside world, injected so tests can swap it. */
export interface Services {
  entries: EntryRepository;
  savedFoods: SavedFoodRepository;
  goals: ProteinGoalRepository;
  /** Confirms entries into the log and remembers each food (FR-014). */
  log: LogService;
  getStatus: () => Promise<Status>;
  estimateFromText: (description: string, signal: AbortSignal) => Promise<Estimate>;
  estimateFromPhoto: (
    jpeg: Blob,
    note: string | undefined,
    signal: AbortSignal,
  ) => Promise<Estimate>;
  /** Resizes and strips metadata on the device before upload (research R7). */
  reencodePhoto: (file: File) => Promise<Blob>;
  now: () => Date;
  /** Sign-in, setup and sign-out (contracts/auth-api.yaml). */
  auth: AuthApi;
  /** Reloads the page, dropping everything in memory (sign-out, switching person). */
  reload: () => void;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}
