import { createContext, useContext, type ReactNode } from 'react';
import type { AuthApi, SessionUser } from '../api/auth';
import type { Estimate } from '../api/estimates';
import type { Status } from '../api/status';
import type { DeviceRepository } from '../data/deviceRepository';
import type { AdoptionResult } from '../data/legacyAdoption';
import type { LogService } from '../data/logService';
import type { CameraService } from '../media/camera';
import type {
  EntryRepository,
  ProteinGoalRepository,
  SavedFoodRepository,
} from '../data/repositories';

/** One account's local food data (its own IndexedDB database, FR-016). */
export interface UserData {
  entries: EntryRepository;
  savedFoods: SavedFoodRepository;
  goals: ProteinGoalRepository;
  /** Confirms entries into the log and remembers each food (FR-014). */
  log: LogService;
  close: () => void;
}

/**
 * Everything the UI needs from the outside world, injected so tests can swap it. The data repositories
 * belong to whoever is signed in: AuthGate fills them in; before that they refuse every call.
 */
export interface Services extends Omit<UserData, 'close'> {
  getStatus: () => Promise<Status>;
  estimateFromText: (description: string, signal: AbortSignal) => Promise<Estimate>;
  estimateFromPhoto: (
    jpeg: Blob,
    note: string | undefined,
    signal: AbortSignal,
  ) => Promise<Estimate>;
  /** Resizes and strips metadata on the device before upload (research R7). */
  reencodePhoto: (file: Blob) => Promise<Blob>;
  /** The only code that touches navigator.mediaDevices. */
  camera: CameraService;
  now: () => Date;
  /** Sign-in, setup and sign-out (contracts/auth-api.yaml). */
  auth: AuthApi;
  /** Reloads the page, dropping everything in memory (sign-out, switching person). */
  reload: () => void;
  /** Who last signed in on this browser (offline launch), and whether old data was adopted. */
  device: DeviceRepository;
  /** Opens one account's own database. */
  openUserData: (userId: string) => Promise<UserData>;
  /** One-time, owner-only adoption of the pre-feature database (FR-018). */
  adoptLegacyData: (user: SessionUser) => Promise<AdoptionResult>;
  /** Set when AI lookup cannot be used right now; manual entry always works (FR-022). */
  aiBlockedReason?: 'offline';
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
