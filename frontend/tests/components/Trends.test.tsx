import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import type { Services } from '../../src/app/services';
import { createChanges } from '../../src/data/changes';
import type { NewEntry } from '../../src/data/repositories';
import { TrendsView } from '../../src/features/trends/TrendsView';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 10, 4, 12, 0);
const TODAY = '2026-11-04';

const on = (dayKey: string, kcal: number, proteinG: number): NewEntry => ({
  dayKey,
  loggedAt: `${dayKey}T08:00:00.000Z`,
  name: 'Food',
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal, proteinG, carbsG: 10, fatG: 2 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'lunch',
});

async function setup(): Promise<Services> {
  return createTestServices({ changes: createChanges(), now: () => now });
}

const rows = () => within(screen.getByRole('table', { name: /daily values/i })).getAllByRole('row').slice(1);

describe('TrendsView', () => {
  it('starts on 7 days, ending today', async () => {
    const services = await setup();
    await services.entries.create(on(TODAY, 100, 10));

    await renderWithServices(<TrendsView />, services);

    expect(await screen.findByRole('button', { name: '7 days', pressed: true })).toBeInTheDocument();
    expect(rows()).toHaveLength(7);
  });

  it('switches to 30 and 90 days', async () => {
    const user = userEvent.setup();
    const services = await setup();
    await services.entries.create(on(TODAY, 100, 10));
    await renderWithServices(<TrendsView />, services);
    await screen.findByRole('table', { name: /daily values/i });

    await user.click(screen.getByRole('button', { name: '30 days' }));
    expect(await screen.findByRole('button', { name: '30 days', pressed: true })).toBeInTheDocument();
    expect(rows()).toHaveLength(30);

    await user.click(screen.getByRole('button', { name: '90 days' }));
    expect(await screen.findByRole('button', { name: '90 days', pressed: true })).toBeInTheDocument();
    expect(rows()).toHaveLength(90);
  });

  it('shows each measure with its average', async () => {
    const services = await setup();
    await services.entries.create(on(TODAY, 1000, 100));
    await services.entries.create(on('2026-11-03', 2000, 150));

    await renderWithServices(<TrendsView />, services);

    const averages = await screen.findByRole('group', { name: /averages/i });
    expect(averages).toHaveTextContent('1500');
    expect(averages).toHaveTextContent('125');
    for (const name of ['Calories', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getByRole('img', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it('says no data for an empty day, in the table, and never zero', async () => {
    const services = await setup();
    await services.entries.create(on(TODAY, 100, 10));

    await renderWithServices(<TrendsView />, services);

    await screen.findByRole('table', { name: /daily values/i });
    expect(rows()[0]).toHaveTextContent(/no data/i);
    expect(rows()[0]).not.toHaveTextContent(/\b0\b/);
    expect(rows()[6]).toHaveTextContent('100');
  });

  it('shows the goal that applied each day', async () => {
    const services = await setup();
    await services.goals.setGoal('2026-11-03', 150);
    await services.goals.setGoal(TODAY, 170);
    await services.entries.create(on(TODAY, 100, 10));

    await renderWithServices(<TrendsView />, services);

    await screen.findByRole('table', { name: /daily values/i });
    expect(rows()[5]).toHaveTextContent('150');
    expect(rows()[6]).toHaveTextContent('170');
  });

  it('has a short message when the range is empty', async () => {
    const services = await setup();

    await renderWithServices(<TrendsView />, services);

    expect(await screen.findByText(/nothing logged in these days/i)).toBeInTheDocument();
  });

  it('refreshes when another device changes an entry or a goal', async () => {
    const services = await setup();
    await services.entries.create(on(TODAY, 100, 10));
    await renderWithServices(<TrendsView />, services);
    await screen.findByRole('table', { name: /daily values/i });

    await services.entries.create(on('2026-11-03', 777, 10));
    await act(async () => services.changes.emit(new Set(['entry'])));

    expect(await screen.findByText('777 kcal')).toBeInTheDocument();
  });

  it('matches the day: a change to a past entry shows when reopened', async () => {
    const services = await setup();
    const entry = await services.entries.create(on('2026-11-03', 100, 10));
    await services.entries.update(entry.id, { macros: { kcal: 250, proteinG: 25, carbsG: 10, fatG: 2 } });
    await services.entries.create(on(TODAY, 900, 90));

    await renderWithServices(<TrendsView />, services);

    expect(await screen.findByText('250 kcal')).toBeInTheDocument();
  });

  it('reads only the days in range', async () => {
    const services = await setup();
    const listByDayRange = vi.spyOn(services.entries, 'listByDayRange');

    await renderWithServices(<TrendsView />, services);
    await screen.findByText(/nothing logged/i);

    expect(listByDayRange).toHaveBeenCalledWith('2026-10-29', TODAY);
  });
});

describe('getting to Trends', () => {
  it('opens from Today and comes back', async () => {
    const user = userEvent.setup();
    const services = await setup();
    await renderWithServices(<App />, services);

    await user.click(await screen.findByRole('button', { name: 'Trends' }));
    expect(await screen.findByRole('heading', { name: 'Trends' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByRole('heading', { name: 'Trends' })).not.toBeInTheDocument();
  });
});
