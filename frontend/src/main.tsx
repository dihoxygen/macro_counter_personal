// First: configures zod for the strict CSP before any schema module is used.
import './zodConfig.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { authApi } from './api/auth.ts';
import { estimateFromPhoto, estimateFromText } from './api/estimates.ts';
import { getStatus } from './api/status.ts';
import { ServicesProvider, type Services } from './app/services.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { DB_NAME, openDb, openUserDb } from './data/db.ts';
import { openDeviceRepository } from './data/deviceRepository.ts';
import { IdbEntryRepository } from './data/entryRepository.ts';
import { adoptLegacyData, databaseExists, deleteDatabase } from './data/legacyAdoption.ts';
import { lockedRepositories } from './data/lockedData.ts';
import { LogService } from './data/logService.ts';
import { IdbProteinGoalRepository } from './data/proteinGoalRepository.ts';
import { IdbSavedFoodRepository } from './data/savedFoodRepository.ts';
import { IdbDevicePreferences } from './data/devicePreferences.ts';
import { browserIntroSession } from './data/introSession.ts';
import { SplashGate } from './features/splash/SplashGate.tsx';
import { browserCameraService } from './media/camera.ts';
import { reencodePhoto } from './media/reencodePhoto.ts';
import './styles.css';

const device = await openDeviceRepository();

const services: Services = {
  // Nothing is reachable until AuthGate opens the signed-in account's own database (FR-016, FR-017).
  ...lockedRepositories(),
  getStatus,
  estimateFromText,
  estimateFromPhoto,
  reencodePhoto,
  camera: browserCameraService(),
  now: () => new Date(),
  auth: authApi,
  // replace(): a fresh load, with no history entry to go Back to (US1.3).
  reload: () => window.location.replace('/'),
  device,
  openUserData: async (userId) => {
    const db = await openUserDb(userId);
    const entries = new IdbEntryRepository(db);
    const savedFoods = new IdbSavedFoodRepository(db);
    return {
      entries,
      savedFoods,
      goals: new IdbProteinGoalRepository(db),
      devicePreferences: new IdbDevicePreferences(db),
      log: new LogService(entries, savedFoods),
      close: () => db.close(),
    };
  },
  adoptLegacyData: (user) =>
    adoptLegacyData(user, {
      device,
      legacyExists: () => databaseExists(DB_NAME),
      openLegacy: () => openDb(DB_NAME),
      openTarget: () => openUserDb(user.id),
      deleteLegacy: () => deleteDatabase(DB_NAME),
    }),
};

// Feature 005: the splash intro plays once per browser session. Decided here, before React renders,
// because StrictMode runs state initializers twice and the second run would see the flag already set.
const introSession = browserIntroSession();
const playIntro = !introSession.hasPlayed();
if (playIntro) introSession.markPlayed();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SplashGate play={playIntro}>
      <ServicesProvider services={services}>
        <AuthGate>
          <App />
        </AuthGate>
      </ServicesProvider>
    </SplashGate>
  </StrictMode>,
);
