import { createContext, useContext, type ReactNode } from 'react';
import type { AuthApi, SessionUser } from '../api/auth';
import type { Estimate } from '../api/estimates';
import type { Status } from '../api/status';
import type { Changes } from '../data/changes';
import type { DeviceRepository } from '../data/deviceRepository';
import type { ExportFile } from '../data/exportData';
import type { AdoptionResult } from '../data/legacyAdoption';
import type { LogService } from '../data/logService';
import type { CameraService } from '../media/camera';
import type {
  DevicePreferences,
  EntryRepository,
  EntryVersionRepository,
  ProteinGoalRepository,
  SavedFoodRepository,
} from '../data/repositories';
import type { SyncService } from '../sync/syncService';

/** One account's local food data (its own IndexedDB database, FR-016). */
export interface UserData {
  entries: EntryRepository;
  savedFoods: SavedFoodRepository;
  goals: ProteinGoalRepository;
  /** Settings such as the last camera used, kept with this account's data (FR-016). */
  devicePreferences: DevicePreferences;
  /** Confirms entries into the log and remembers each food (FR-014). */
  log: LogService;
  /** Earlier states of entries (007 FR-024). */
  entryVersions: EntryVersionRepository;
  /** Says when changes from another device arrive (007 FR-005). */
  changes: Changes;
  sync: SyncService;
  /** Everything of this account on this device, as one document (007 FR-036). */
  exportData: () => Promise<ExportFile>;
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
  /** Hands the person a file through the browser's download. */
  downloadFile: (name: string, content: string) => void;
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
