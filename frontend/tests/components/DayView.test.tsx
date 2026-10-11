import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayView } from '../../src/features/history/DayView';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 9, 8, 12, 0, 0);

const entry = (dayKey: string, name: string, proteinG: number): NewEntry => ({
  dayKey,
  loggedAt: `${dayKey}T12:00:00.000Z`,
  name,
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: proteinG * 4, proteinG, carbsG: 0, fatG: 0 },
  source: 'manual',
  savedFoodId: null,
});

async function setup() {
  const user = userEvent.setup();
  const services = await createTestServices({ now: () => now });
  await services.entries.create(entry('2026-10-06', 'Tuesday tuna', 30));
  await services.entries.create(entry('2026-10-07', 'Wednesday steak', 40));
  await services.entries.create(entry('2026-10-08', 'Thursday tofu', 20));
  await renderWithServices(<DayView />, services);
  const protein = () =>
    within(screen.getByRole('region', { name: /totals/i })).getByRole('group', { name: 'Protein' });
  return { user, services, protein };
}

describe('DayView', () => {
  it("starts on the previous day and shows that day's entries and totals", async () => {
    const { protein } = await setup();
    expect(await screen.findByText('Wednesday steak')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /wed.*oct.*7/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(protein()).toHaveTextContent('40 g'));
    expect(screen.queryByText('Thursday tofu')).not.toBeInTheDocument();
  });

  it('navigates to previous and next days; next is disabled on today', async () => {
    const { user, protein } = await setup();
    await screen.findByText('Wednesday steak');

    await user.click(screen.getByRole('button', { name: /previous day/i }));
    expect(await screen.findByText('Tuesday tuna')).toBeInTheDocument();
    await vi.waitFor(() => expect(protein()).toHaveTextContent('30 g'));

    await user.click(screen.getByRole('button', { name: /next day/i }));
    await user.click(screen.getByRole('button', { name: /next day/i }));
    expect(await screen.findByText('Thursday tofu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next day/i })).toBeDisabled();
  });

  it("editing or deleting there changes only that day's totals", async () => {
    const { user, services, protein } = await setup();
    await user.click(await screen.findByRole('button', { name: /wednesday steak/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete/i }));

    await vi.waitFor(() => expect(protein()).toHaveTextContent('0 g'));
    expect(await services.entries.listByDay('2026-10-07')).toEqual([]);
    expect(await services.entries.listByDay('2026-10-08')).toHaveLength(1);
    expect(await services.entries.listByDay('2026-10-06')).toHaveLength(1);
  });

  it('shows an empty state for a day with nothing logged', async () => {
    const { user } = await setup();
    await screen.findByText('Wednesday steak');
    await user.click(screen.getByRole('button', { name: /previous day/i }));
    await user.click(screen.getByRole('button', { name: /previous day/i }));
    expect(await screen.findByText(/nothing logged/i)).toBeInTheDocument();
  });
});
