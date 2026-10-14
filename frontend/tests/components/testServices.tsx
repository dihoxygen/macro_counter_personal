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
import { ServicesProvider, type Services } from '../../src/app/services';

let dbCounter = 0;

const testUser = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'tester',
  role: 'user' as const,
};
const signedIn: SessionState = { state: 'signed_in', csrfToken: 'test-csrf', user: testUser };

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
    ...overrides,
  };
}

/** Real repositories on a fresh fake-indexeddb database; API calls stubbed. */
export async function createTestServices(overrides: Partial<Services> = {}): Promise<Services> {
  const db = await openDb(`component-test-${++dbCounter}-${Date.now()}`);
  const entries = new IdbEntryRepository(db);
  const savedFoods = new IdbSavedFoodRepository(db);
  return {
    entries,
    savedFoods,
    goals: new IdbProteinGoalRepository(db),
    log: new LogService(entries, savedFoods),
    getStatus: vi.fn(async () => ({ aiAvailable: true })),
    estimateFromText: vi.fn(async () => {
      throw new EstimateError('ai_unavailable');
    }),
    estimateFromPhoto: vi.fn(async () => {
      throw new EstimateError('ai_unavailable');
    }),
    reencodePhoto: vi.fn(async (file: File) => file),
    now: () => new Date(),
    auth: fakeAuth(),
    reload: vi.fn(),
    ...overrides,
  };
}

export async function renderWithServices(ui: ReactElement, overrides: Partial<Services> = {}) {
  const services = await createTestServices(overrides);
  const result = render(<ServicesProvider services={services}>{ui}</ServicesProvider>);
  return { services, ...result };
}
