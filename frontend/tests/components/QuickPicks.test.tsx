import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { toDayKey } from '../../src/domain/days';
import type { NewEntry } from '../../src/data/repositories';
import type { Services } from '../../src/app/services';
import { createTestServices, renderWithServices } from './testServices';
import { bananaItem, estimateOf } from './fixtures';

// Feature 004 User Story 2: re-log a recent food from Today (FR-007, FR-008, SC-002).

const today = () => toDayKey(new Date());

const food = (name: string, minute: number, overrides: Partial<NewEntry> = {}): NewEntry => ({
  dayKey: '2026-10-01',
  loggedAt: new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString(),
  name,
  quantity: { amount: 170, unit: 'g' },
  macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
  source: 'ai',
  savedFoodId: null,
  ...overrides,
});

async function setup(names: string[], overrides: Partial<Services> = {}) {
  const user = userEvent.setup();
  const services = await createTestServices(overrides);
  for (const [i, name] of names.entries()) await services.savedFoods.upsertFromEntry(food(name, i));
  const onNavigate = vi.fn();
  await renderWithServices(<TodayScreen onNavigate={onNavigate} />, services);
  const composer = await screen.findByRole('region', { name: 'Log food' });
  if (names.length > 0) await within(composer).findByRole('group', { name: 'Recent foods' });
  return { user, services, onNavigate, composer };
}

const picks = () => screen.findByRole('group', { name: 'Recent foods' });

describe('QuickPicks', () => {
  it('(a) shows no Recent foods group without saved foods', async () => {
    await setup([]);
    await screen.findByText(/nothing logged yet/i);
    expect(screen.queryByRole('group', { name: 'Recent foods' })).not.toBeInTheDocument();
  });

  it('(b) shows the 5 most recent foods, then More recent foods', async () => {
    await setup(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']);
    const group = await picks();
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Seven', 'Six', 'Five', 'Four', 'Three', 'More recent foods']);
  });

  it('(c) re-logs a food at its saved amount in 2 interactions', async () => {
    const { user, services, composer } = await setup(['Greek yogurt']);
    let interactions = 0;
    const act = async (fn: () => Promise<void>) => {
      interactions++;
      await fn();
    };

    await act(() => user.click(within(composer).getByRole('button', { name: 'Greek yogurt' })));
    expect(within(composer).getByRole('spinbutton', { name: 'Amount' })).toHaveValue(170);
    await act(() => user.click(within(composer).getByRole('button', { name: 'Log' })));

    expect(interactions).toBe(2);
    await vi.waitFor(async () => expect(await services.entries.listByDay(today())).toHaveLength(1));
    const list = await screen.findByRole('list', { name: /entries/i });
    expect(await within(list).findByText('Greek yogurt')).toBeInTheDocument();
  });

  it('(d) changing the amount scales the macros to log', async () => {
    const { user, composer } = await setup(['Greek yogurt']);
    await user.click(within(composer).getByRole('button', { name: 'Greek yogurt' }));
    const amount = within(composer).getByRole('spinbutton', { name: 'Amount' });
    await user.clear(amount);
    await user.type(amount, '85');

    const willLog = within(composer).getByRole('group', { name: 'Will log' });
    expect(within(willLog).getByText('8.5 g')).toBeInTheDocument();
    expect(within(willLog).getByText('50 kcal')).toBeInTheDocument();
  });

  it('(e) Cancel closes the re-log form without logging', async () => {
    const { user, services, composer } = await setup(['Greek yogurt']);
    await user.click(within(composer).getByRole('button', { name: 'Greek yogurt' }));
    await user.click(within(composer).getByRole('button', { name: 'Cancel' }));

    expect(within(composer).queryByRole('spinbutton', { name: 'Amount' })).not.toBeInTheDocument();
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it('(f) the quick picks are disabled while a review card or re-log form is open', async () => {
    const { user, composer } = await setup(['Greek yogurt', 'Oatmeal'], {
      estimateFromText: vi.fn(async () => estimateOf(bananaItem)) as never,
    });
    await user.click(within(composer).getByRole('button', { name: 'Greek yogurt' }));
    expect(within(await picks()).getByRole('button', { name: 'Oatmeal' })).toBeDisabled();
    await user.click(within(composer).getByRole('button', { name: 'Cancel' }));

    await user.type(within(composer).getByLabelText('What did you eat?'), 'banana{Enter}');
    await screen.findByRole('region', { name: 'Review estimate' });
    expect(within(await picks()).getByRole('button', { name: 'Oatmeal' })).toBeDisabled();
  });

  it('(g) a food confirmed from a description appears first without a reload', async () => {
    const { user, composer } = await setup(['Greek yogurt'], {
      estimateFromText: vi.fn(async () => estimateOf(bananaItem)) as never,
    });
    await user.type(within(composer).getByLabelText('What did you eat?'), 'banana{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await vi.waitFor(async () => {
      const names = within(await picks())
        .getAllByRole('button')
        .map((b) => b.textContent);
      expect(names.slice(0, 2)).toEqual(['Banana', 'Greek yogurt']);
    });
  });

  it('(h) More recent foods opens the Recent view', async () => {
    const { user, onNavigate } = await setup(['Greek yogurt']);
    await user.click(within(await picks()).getByRole('button', { name: 'More recent foods' }));
    expect(onNavigate).toHaveBeenCalledWith('recent');
  });
});
