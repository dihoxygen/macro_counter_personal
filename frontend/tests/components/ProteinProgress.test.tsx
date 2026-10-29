import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayView } from '../../src/features/history/DayView';
import { ProteinProgress } from '../../src/features/today/ProteinProgress';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 9, 8, 12, 0);

const protein = (dayKey: string, proteinG: number): NewEntry => ({
  dayKey,
  loggedAt: `${dayKey}T12:00:00.000Z`,
  name: `Protein ${proteinG}`,
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: proteinG * 4, proteinG, carbsG: 0, fatG: 0 },
  source: 'manual',
  savedFoodId: null,
});

describe('ProteinProgress', () => {
  // Feature 004: the protein an open estimate card would add (FR-004).
  it('shows pending protein without counting it as logged', async () => {
    await renderWithServices(<ProteinProgress loggedG={96} goalG={150} pendingG={54} />);
    const region = screen.getByRole('region', { name: /protein goal/i });
    expect(within(region).getByText('+54 g pending')).toBeInTheDocument();
    expect(within(region).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '96');
  });

  it.each([0, undefined])('shows no pending text when pending is %s', async (pendingG) => {
    await renderWithServices(<ProteinProgress loggedG={96} goalG={150} pendingG={pendingG} />);
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it('with no goal, shows the pending protein next to the Set a protein goal prompt', async () => {
    await renderWithServices(<ProteinProgress loggedG={96} goalG={null} pendingG={54} onSetGoal={vi.fn()} />);
    expect(screen.getByRole('button', { name: /set a protein goal/i })).toBeInTheDocument();
    expect(screen.getByText('+54 g pending')).toBeInTheDocument();
  });

  it('with no goal, shows a Set a protein goal prompt', async () => {
    const user = userEvent.setup();
    const onSetGoal = vi.fn();
    await renderWithServices(<ProteinProgress loggedG={90} goalG={null} onSetGoal={onSetGoal} />);
    await user.click(screen.getByRole('button', { name: /set a protein goal/i }));
    expect(onSetGoal).toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('with a goal, shows logged of goal and the amount left', async () => {
    await renderWithServices(<ProteinProgress loggedG={90} goalG={150} />);
    const region = screen.getByRole('region', { name: /protein goal/i });
    expect(within(region).getByText('90 / 150 g')).toBeInTheDocument();
    expect(within(region).getByText('60 g left')).toBeInTheDocument();
    const bar = within(region).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '90');
    expect(bar).toHaveAttribute('aria-valuemax', '150');
  });

  it('with a goal, offers Change goal so the goal can be edited (V9)', async () => {
    const user = userEvent.setup();
    const onSetGoal = vi.fn();
    await renderWithServices(<ProteinProgress loggedG={90} goalG={180} onSetGoal={onSetGoal} />);
    await user.click(screen.getByRole('button', { name: /change goal/i }));
    expect(onSetGoal).toHaveBeenCalled();
  });

  it('with a goal but no handler (previous days), offers no Change goal button', async () => {
    await renderWithServices(<ProteinProgress loggedG={90} goalG={180} />);
    expect(screen.queryByRole('button', { name: /change goal/i })).not.toBeInTheDocument();
  });

  it('when exceeded, shows Goal met and by how much', async () => {
    await renderWithServices(<ProteinProgress loggedG={170} goalG={150} />);
    expect(screen.getByText(/goal met/i)).toBeInTheDocument();
    expect(screen.getByText('+20 g')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '150');
  });

  it('exactly at the goal shows Goal met', async () => {
    await renderWithServices(<ProteinProgress loggedG={150} goalG={150} />);
    expect(screen.getByText(/goal met/i)).toBeInTheDocument();
  });

  it("Today shows today's protein against the current goal", async () => {
    const services = await createTestServices({ now: () => now });
    await services.goals.setGoal('2026-10-01', 150);
    await services.entries.create(protein('2026-10-08', 90));
    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);

    expect(await screen.findByText('90 / 150 g')).toBeInTheDocument();
    expect(screen.getByText('60 g left')).toBeInTheDocument();
  });

  it('Today offers to set a goal when none is set', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    await renderWithServices(<TodayScreen onNavigate={onNavigate} />, await createTestServices({ now: () => now }));
    await user.click(await screen.findByRole('button', { name: /set a protein goal/i }));
    expect(onNavigate).toHaveBeenCalledWith('goal');
  });

  it('DayView for a past day uses the goal in effect on that day (FR-020)', async () => {
    const services = await createTestServices({ now: () => now });
    await services.goals.setGoal('2026-10-01', 120);
    await services.goals.setGoal('2026-10-08', 150);
    await services.entries.create(protein('2026-10-07', 100));
    await renderWithServices(<DayView />, services);

    expect(await screen.findByText('100 / 120 g')).toBeInTheDocument();
    expect(screen.getByText('20 g left')).toBeInTheDocument();
  });
});
