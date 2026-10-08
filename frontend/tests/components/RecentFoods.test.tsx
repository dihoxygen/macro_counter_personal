import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { RecentFoods } from '../../src/features/recent/RecentFoods';
import { toDayKey } from '../../src/domain/days';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';

const today = () => toDayKey(new Date());

const food = (name: string, loggedAt: string, overrides: Partial<NewEntry> = {}): NewEntry => ({
  dayKey: '2026-10-01',
  loggedAt,
  name,
  quantity: { amount: 170, unit: 'g' },
  macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
  source: 'ai',
  savedFoodId: null,
  ...overrides,
});

async function seeded() {
  const services = await createTestServices();
  await services.savedFoods.upsertFromEntry(food('Oatmeal', '2026-10-01T07:00:00.000Z', { quantity: { amount: 1, unit: 'serving' }, macros: { kcal: 150, proteinG: 5, carbsG: 27, fatG: 3 } }));
  await services.savedFoods.upsertFromEntry(food('Greek yogurt', '2026-10-07T08:00:00.000Z'));
  return services;
}

describe('RecentFoods', () => {
  it('is reachable from Today in one tap and lists foods most recent first', async () => {
    const user = userEvent.setup();
    await renderWithServices(<App />, await seeded());

    await user.click(await screen.findByRole('button', { name: /^recent$/i }));

    const list = await screen.findByRole('list', { name: /recent foods/i });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Greek yogurt'),
      expect.stringContaining('Oatmeal'),
    ]);
  });

  it('logs a food in 3 interactions from Today: Recent → pick → Log', async () => {
    const user = userEvent.setup();
    const services = await seeded();
    await renderWithServices(<App />, services);

    await user.click(await screen.findByRole('button', { name: /^recent$/i })); // 1
    await user.click(await screen.findByRole('button', { name: /greek yogurt/i })); // 2
    expect(screen.getByLabelText(/amount/i)).toHaveValue(170);
    await user.click(screen.getByRole('button', { name: /^log$/i })); // 3

    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    const [logged] = await services.entries.listByDay(today());
    expect(logged).toMatchObject({
      name: 'Greek yogurt',
      quantity: { amount: 170, unit: 'g' },
      macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
      source: 'ai',
    });
    const [saved] = await services.savedFoods.listRecent();
    expect(logged!.savedFoodId).toBe(saved!.id);
  });

  it('rescales macros when the amount changes, using scaleMacros', async () => {
    const user = userEvent.setup();
    const services = await seeded();
    const onLogged = vi.fn();
    await renderWithServices(<RecentFoods onLogged={onLogged} />, services);

    await user.click(await screen.findByRole('button', { name: /greek yogurt/i }));
    const amount = screen.getByLabelText(/amount/i);
    await user.clear(amount);
    await user.type(amount, '85');

    const preview = screen.getByRole('group', { name: /will log/i });
    expect(within(preview).getByText('50 kcal')).toBeInTheDocument();
    expect(within(preview).getByText('8.5 g')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^log$/i }));
    await vi.waitFor(() => expect(onLogged).toHaveBeenCalled());
    const [logged] = await services.entries.listByDay(today());
    expect(logged!.quantity).toEqual({ amount: 85, unit: 'g' });
    expect(logged!.macros).toEqual({ kcal: 50, proteinG: 8.5, carbsG: 3, fatG: 0.35 });
  });

  it('keeps the unit fixed to the saved unit', async () => {
    const user = userEvent.setup();
    await renderWithServices(<RecentFoods onLogged={vi.fn()} />, await seeded());
    await user.click(await screen.findByRole('button', { name: /oatmeal/i }));
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByText(/serving/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('rejects an invalid amount', async () => {
    const user = userEvent.setup();
    const services = await seeded();
    await renderWithServices(<RecentFoods onLogged={vi.fn()} />, services);
    await user.click(await screen.findByRole('button', { name: /greek yogurt/i }));
    await user.clear(screen.getByLabelText(/amount/i));
    await user.click(screen.getByRole('button', { name: /^log$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/0 or more/i);
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it('logs a food with reference amount 0 only at its saved values', async () => {
    const user = userEvent.setup();
    const services = await createTestServices();
    await services.savedFoods.upsertFromEntry(
      food('Black coffee', '2026-10-07T08:00:00.000Z', {
        quantity: { amount: 0, unit: 'ml' },
        macros: { kcal: 2, proteinG: 0.3, carbsG: 0, fatG: 0 },
      }),
    );
    const onLogged = vi.fn();
    await renderWithServices(<RecentFoods onLogged={onLogged} />, services);

    await user.click(await screen.findByRole('button', { name: /black coffee/i }));
    expect(screen.getByLabelText(/amount/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^log$/i }));
    await vi.waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect((await services.entries.listByDay(today()))[0]!.macros.kcal).toBe(2);
  });

  it('shows an empty state when nothing has been saved', async () => {
    await renderWithServices(<RecentFoods onLogged={vi.fn()} />);
    expect(await screen.findByText(/no saved foods yet/i)).toBeInTheDocument();
  });
});
