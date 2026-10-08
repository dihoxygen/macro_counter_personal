import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { EstimateError } from '../../src/api/estimates';
import { openDb } from '../../src/data/db';
import { IdbEntryRepository } from '../../src/data/entryRepository';
import { LogService } from '../../src/data/logService';
import { IdbProteinGoalRepository } from '../../src/data/proteinGoalRepository';
import { IdbSavedFoodRepository } from '../../src/data/savedFoodRepository';
import { ServicesProvider, type Services } from '../../src/app/services';

let dbCounter = 0;

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
    ...overrides,
  };
}

export async function renderWithServices(ui: ReactElement, overrides: Partial<Services> = {}) {
  const services = await createTestServices(overrides);
  const result = render(<ServicesProvider services={services}>{ui}</ServicesProvider>);
  return { services, ...result };
}
