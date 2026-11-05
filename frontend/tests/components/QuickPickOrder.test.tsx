import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import type { Services } from '../../src/app/services';
import { createChanges } from '../../src/data/changes';
import { IdbEntryRepository } from '../../src/data/entryRepository';
import { openDb } from '../../src/data/db';
import type { NewEntry } from '../../src/data/repositories';
import { IdbSavedFoodRepository } from '../../src/data/savedFoodRepository';
import { QuickPicks } from '../../src/features/add-food/QuickPicks';
import { RecentFoods } from '../../src/features/recent/RecentFoods';
import { LogService } from '../../src/data/logService';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 10, 30, 12, 0);

const entry = (name: string, dayKey = '2026-11-29'): NewEntry => ({
  dayKey,
  loggedAt: `${dayKey}T08:00:00.000Z`,
  name,
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'lunch',
});

async function setup(): Promise<Services> {
  return createTestServices({ changes: createChanges(), now: () => now });
}

async function logTimes(services: Services, name: string, times: number) {
  for (let i = 0; i < times; i++) await services.log.confirmEntries([entry(name)]);
}

describe('IdbSavedFoodRepository.listQuickPicks', () => {
  it('orders by use in the window, and honours the limit', async () => {
    const db = await openDb(`quick-picks-${Date.now()}-${Math.random()}`);
    const foods = new IdbSavedFoodRepository(db);
    const log = new LogService(new IdbEntryRepository(db), foods);
    await log.confirmEntries([entry('Once'), entry('Twice'), entry('Twice'), entry('Old', '2026-09-01')]);

    expect((await foods.listQuickPicks('2026-11-30')).map((f) => f.name)).toEqual(['Twice', 'Once', 'Old']);
    expect((await foods.listQuickPicks('2026-11-30', 1)).map((f) => f.name)).toEqual(['Twice']);
  });
});

describe('the quick picks', () => {
  it('put the most used food first, with the label unchanged', async () => {
    const services = await setup();
    await logTimes(services, 'Oats', 1);
    await logTimes(services, 'Eggs', 3);

    await renderWithServices(<QuickPicks refreshKey={0} disabled={false} onPick={() => undefined} onMore={() => undefined} />, services);

    const group = await screen.findByRole('group', { name: 'Recent foods' });
    await within(group).findByRole('button', { name: 'Eggs' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Eggs', 'Oats', 'More recent foods']);
  });

  it('reorder when entries change on another device', async () => {
    const services = await setup();
    await logTimes(services, 'Oats', 2);
    await logTimes(services, 'Eggs', 1);
    await renderWithServices(<QuickPicks refreshKey={0} disabled={false} onPick={() => undefined} onMore={() => undefined} />, services);
    const group = await screen.findByRole('group', { name: 'Recent foods' });
    await within(group).findByRole('button', { name: 'Oats' });

    await logTimes(services, 'Eggs', 3);
    await act(async () => services.changes.emit(new Set(['entry'])));

    await expect.poll(() => within(group).getAllByRole('button')[0]!.textContent).toBe('Eggs');
  });
});

describe('the Recent foods list', () => {
  it('uses the same order', async () => {
    const services = await setup();
    await logTimes(services, 'Oats', 1);
    await logTimes(services, 'Eggs', 2);

    await renderWithServices(<RecentFoods onLogged={() => undefined} />, services);

    const list = await screen.findByRole('list', { name: 'Recent foods' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Eggs'),
      expect.stringContaining('Oats'),
    ]);
  });
});
