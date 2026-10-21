import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { AuthApi, SessionState } from '../../src/api/auth';
import { EstimateError } from '../../src/api/estimates';
import { openDb } from '../../src/data/db';
import { IdbEntryRepository } from '../../src/data/entryRepository';
import { LogService } from '../../src/data/logService';
import { IdbProteinGoalRepository } from '../../src/data/proteinGoalRepository';
import { IdbSavedFoodRepository } from '../../src/data/savedFoodRepository';
import { IdbDevicePreferences } from '../../src/data/devicePreferences';
import { ServicesProvider, type Services } from '../../src/app/services';
import type { ActiveAccount, DeviceRepository } from '../../src/data/deviceRepository';
import { FakeCameraService } from './fakeCamera';

let dbCounter = 0;

const testUser = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'tester',
  role: 'user' as const,
};
const signedIn: SessionState = { state: 'signed_in', csrfToken: 'test-csrf', user: testUser };

/** An in-memory device record (who is signed in on this browser). */
export function fakeDevice(account?: ActiveAccount): DeviceRepository & { close: () => void } {
  let active = account;
  let adopted = false;
  return {
    getActiveAccount: vi.fn(async () => active),
    setActiveAccount: vi.fn(async (a: Omit<ActiveAccount, 'updatedAt'>) => {
      active = { ...a, updatedAt: new Date().toISOString() };
      return active;
    }),
    clearActiveAccount: vi.fn(async () => {
      active = undefined;
    }),
    isLegacyAdopted: vi.fn(async () => adopted),
    markLegacyAdopted: vi.fn(async () => {
      adopted = true;
    }),
    close: vi.fn(),
  };
}

/** An auth API whose calls all succeed (signed in as "tester"); override any of them per test. */
export function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    getSession: vi.fn(async () => signedIn),
    signIn: vi.fn(async () => signedIn),
    setupPassword: vi.fn(async (): Promise<SessionState> => ({
      state: 'setup',
      csrfToken: 't',
      setupStep: 'totp',
    })),
    setupTotpStart: vi.fn(async () => ({
      setupKey: 'JBSW Y3DP',
      otpauthUri: 'otpauth://totp/Macro%20Counter:tester?secret=JBSWY3DP',
    })),
    setupTotpConfirm: vi.fn(async (): Promise<SessionState> => ({
      state: 'setup',
      csrfToken: 't',
      setupStep: 'notice',
    })),
    acknowledgeNotice: vi.fn(async () => signedIn),
    signOut: vi.fn(async () => undefined),
    signOutEverywhere: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Real repositories on a fresh fake-indexeddb database; API calls stubbed. */
export async function createTestServices(overrides: Partial<Services> = {}): Promise<Services> {
  const db = await openDb(`component-test-${++dbCounter}-${Date.now()}`);
  const entries = new IdbEntryRepository(db);
  const savedFoods = new IdbSavedFoodRepository(db);
  const goals = new IdbProteinGoalRepository(db);
  const log = new LogService(entries, savedFoods);
  const devicePreferences = new IdbDevicePreferences(db);
  return {
    entries,
    savedFoods,
    goals,
    log,
    devicePreferences,
    getStatus: vi.fn(async () => ({ aiAvailable: true })),
    estimateFromText: vi.fn(async () => {
      throw new EstimateError('ai_unavailable');
    }),
    estimateFromPhoto: vi.fn(async () => {
      throw new EstimateError('ai_unavailable');
    }),
    reencodePhoto: vi.fn(async (file: Blob) => file),
    camera: new FakeCameraService(),
    now: () => new Date(),
    auth: fakeAuth(),
    reload: vi.fn(),
    device: fakeDevice(),
    // Every account gets the same repositories here; AuthGate tests override this.
    openUserData: vi.fn(async () => ({
      entries,
      savedFoods,
      goals,
      log,
      devicePreferences,
      close: () => undefined,
    })),
    adoptLegacyData: vi.fn(async () => 'not-owner' as const),
    ...overrides,
  };
}

export async function renderWithServices(ui: ReactElement, overrides: Partial<Services> = {}) {
  const services = await createTestServices(overrides);
  const result = render(<ServicesProvider services={services}>{ui}</ServicesProvider>);
  return { services, ...result };
}
