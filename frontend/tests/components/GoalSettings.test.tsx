import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalSettings } from '../../src/features/goal/GoalSettings';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 9, 8, 12, 0);

async function setup(existing?: number) {
  const user = userEvent.setup();
  const services = await createTestServices({ now: () => now });
  if (existing !== undefined) await services.goals.setGoal('2026-10-01', existing);
  const onSaved = vi.fn();
  await renderWithServices(<GoalSettings onSaved={onSaved} />, services);
  return { user, services, onSaved };
}

describe('GoalSettings', () => {
  it('sets a goal effective from today', async () => {
    const { user, services, onSaved } = await setup();
    await user.type(await screen.findByLabelText(/daily protein goal/i), '150');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((await services.goals.listAll()).map((g) => [g.effectiveFrom, g.grams])).toEqual([
      ['2026-10-08', 150],
    ]);
  });

  it('shows the current goal and changes it from today forward', async () => {
    const { user, services, onSaved } = await setup(120);
    const input = await screen.findByLabelText(/daily protein goal/i);
    await vi.waitFor(() => expect(input).toHaveValue(120));
    await user.clear(input);
    await user.type(input, '160');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((await services.goals.listAll()).map((g) => [g.effectiveFrom, g.grams])).toEqual([
      ['2026-10-01', 120],
      ['2026-10-08', 160],
    ]);
  });

  it('clears the goal from today forward', async () => {
    const { user, services, onSaved } = await setup(120);
    await user.click(await screen.findByRole('button', { name: /clear goal/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const history = await services.goals.listAll();
    expect(history.at(-1)).toMatchObject({ effectiveFrom: '2026-10-08', grams: null });
  });

  it('has no Clear button when no goal is set', async () => {
    await setup();
    await screen.findByLabelText(/daily protein goal/i);
    expect(screen.queryByRole('button', { name: /clear goal/i })).not.toBeInTheDocument();
  });

  it.each(['0', '-5', 'abc', ''])('rejects "%s" with a clear message and saves nothing', async (value) => {
    const { user, services, onSaved } = await setup();
    const input = await screen.findByLabelText(/daily protein goal/i);
    if (value) await user.type(input, value);
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a protein goal greater than 0 g');
    expect(onSaved).not.toHaveBeenCalled();
    expect(await services.goals.listAll()).toEqual([]);
  });
});
