import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { toDayKey } from '../../src/domain/days';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';
import { bananaItem, estimateOf } from './fixtures';

const today = () => toDayKey(new Date());

const entry = (overrides: Partial<NewEntry>): NewEntry => ({
  dayKey: today(),
  loggedAt: new Date().toISOString(),
  name: 'Food',
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
  ...overrides,
});

describe('TodayScreen', () => {
  it("shows today's formatted totals and the entries ordered by loggedAt", async () => {
    const services = await createTestServices();
    await services.entries.create(entry({ name: 'Dinner', loggedAt: '2026-10-08T19:00:00.000Z', macros: { kcal: 600.4, proteinG: 40.26, carbsG: 50, fatG: 20 } }));
    await services.entries.create(entry({ name: 'Breakfast', loggedAt: '2026-10-08T07:00:00.000Z', macros: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 10.1 } }));

    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);

    const totals = await screen.findByRole('region', { name: /totals/i });
    expect(await within(totals).findByText('900 kcal')).toBeInTheDocument();
    expect(within(totals).getByText('60.3 g')).toBeInTheDocument();
    expect(within(totals).getByText('80 g')).toBeInTheDocument();
    expect(within(totals).getByText('30.1 g')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: /entries/i });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Breakfast'),
      expect.stringContaining('Dinner'),
    ]);
  });

  it('shows only entries whose dayKey is today', async () => {
    const services = await createTestServices();
    await services.entries.create(entry({ name: 'Yesterday snack', dayKey: '2000-01-01' }));
    await services.entries.create(entry({ name: 'Today snack' }));

    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);

    expect(await screen.findByText('Today snack')).toBeInTheDocument();
    expect(screen.queryByText('Yesterday snack')).not.toBeInTheDocument();
  });

  it('shows an empty state and zero totals with no entries', async () => {
    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText(/nothing logged yet/i)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /totals/i })).getByText('0 kcal')).toBeInTheDocument();
  });

  it('updates the totals right after a confirm', async () => {
    const user = userEvent.setup();
    await renderWithServices(<App />, { estimateFromText: vi.fn(async () => estimateOf(bananaItem)) });

    await user.click(await screen.findByRole('button', { name: /add food/i }));
    await user.type(await screen.findByLabelText(/what did you eat/i), '1 medium banana');
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    await user.click(await screen.findByRole('button', { name: /confirm/i }));

    const totals = await screen.findByRole('region', { name: /totals/i });
    expect(await within(totals).findByText('105 kcal')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });
});

describe('TodayScreen protein prominence and day rollover (US2)', () => {
  it('shows protein first and as the primary (largest) total (FR-009)', async () => {
    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />);
    const totals = await screen.findByRole('region', { name: /totals/i });
    const groups = within(totals).getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Protein');
    expect(groups[0]).toHaveClass('primary');
    expect(groups.slice(1).map((g) => g.getAttribute('aria-label'))).toEqual(['Calories', 'Carbs', 'Fat']);
    expect(groups.slice(1).some((g) => g.classList.contains('primary'))).toBe(false);
  });

  it("switches to the new day's empty totals after midnight", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let current = new Date(2026, 9, 8, 23, 59, 0);
      const services = await createTestServices({ now: () => current });
      await services.entries.create(entry({ dayKey: '2026-10-08', name: 'Late snack' }));
      await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);
      expect(await screen.findByText('Late snack')).toBeInTheDocument();

      current = new Date(2026, 9, 9, 0, 0, 30);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(await screen.findByText(/nothing logged yet/i)).toBeInTheDocument();
      expect(screen.queryByText('Late snack')).not.toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: /totals/i })).getByText('0 kcal')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('has a Previous days entry point', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    await renderWithServices(<TodayScreen onNavigate={onNavigate} />);
    await user.click(await screen.findByRole('button', { name: /previous days/i }));
    expect(onNavigate).toHaveBeenCalledWith('history');
  });
});
