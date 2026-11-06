import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Services } from '../../src/app/services';
import { createChanges } from '../../src/data/changes';
import type { NewEntry } from '../../src/data/repositories';
import { toDayKey } from '../../src/domain/days';
import { QuickPicks } from '../../src/features/add-food/QuickPicks';
import { GoalSettings } from '../../src/features/goal/GoalSettings';
import { RecentFoods } from '../../src/features/recent/RecentFoods';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 10, 4, 9, 0);

const entry = (name: string): NewEntry => ({
  dayKey: toDayKey(now),
  loggedAt: now.toISOString(),
  name,
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'breakfast',
});

async function setup() {
  const changes = createChanges();
  const services: Services = await createTestServices({ changes, now: () => now });
  return { changes, services };
}

describe('changes from another device', () => {
  it('reach Today without a remount', async () => {
    const { changes, services } = await setup();
    await renderWithServices(<TodayScreen onNavigate={() => undefined} />, services);
    expect(await screen.findByText(/nothing logged yet/i)).toBeInTheDocument();

    await services.entries.create(entry('Banana'));
    await act(async () => changes.emit(new Set(['entry'])));

    expect(await screen.findByText('Banana')).toBeInTheDocument();
  });

  it('reach the quick picks', async () => {
    const { changes, services } = await setup();
    await renderWithServices(<QuickPicks refreshKey={0} disabled={false} onPick={() => undefined} onMore={() => undefined} />, services);

    await services.savedFoods.upsertFromEntry(entry('Oats'));
    await act(async () => changes.emit(new Set(['food'])));

    expect(await screen.findByRole('button', { name: 'Oats' })).toBeInTheDocument();
  });

  it('reach the recent foods', async () => {
    const { changes, services } = await setup();
    await renderWithServices(<RecentFoods onLogged={() => undefined} />, services);
    expect(await screen.findByText(/no saved foods yet/i)).toBeInTheDocument();

    await services.savedFoods.upsertFromEntry(entry('Oats'));
    await act(async () => changes.emit(new Set(['food'])));

    expect(await screen.findByRole('button', { name: /oats/i })).toBeInTheDocument();
  });

  it('reach the goal settings, unless the person is typing', async () => {
    const user = userEvent.setup();
    const { changes, services } = await setup();
    await renderWithServices(<GoalSettings onSaved={() => undefined} />, services);
    const field = await screen.findByRole('spinbutton');

    await services.goals.setGoal(toDayKey(now), 150);
    await act(async () => changes.emit(new Set(['goal'])));
    expect(field).toHaveValue(150);

    await user.clear(field);
    await user.type(field, '12');
    await services.goals.setGoal(toDayKey(now), 170);
    await act(async () => changes.emit(new Set(['goal'])));

    expect(field).toHaveValue(12);
  });

  it('ignore changes the screen does not show', async () => {
    const { changes, services } = await setup();
    await renderWithServices(<RecentFoods onLogged={() => undefined} />, services);
    await screen.findByText(/no saved foods yet/i);

    await services.savedFoods.upsertFromEntry(entry('Oats'));
    await act(async () => changes.emit(new Set(['version'])));

    expect(screen.queryByRole('button', { name: /oats/i })).not.toBeInTheDocument();
  });
});

describe('an entry open in the editor', () => {
  async function openEditor() {
    const user = userEvent.setup();
    const context = await setup();
    const created = await context.services.entries.create(entry('Banana'));
    await renderWithServices(<TodayScreen onNavigate={() => undefined} />, context.services);
    await user.click(await screen.findByRole('button', { name: /banana/i }));
    const name = await screen.findByRole('textbox', { name: /name/i });
    return { ...context, created, user, name };
  }

  it('closes with an announcement when it was deleted elsewhere', async () => {
    const { changes, services, created, name } = await openEditor();

    await services.entries.delete(created.id);
    await act(async () => changes.emit(new Set(['entry'])));

    expect(name).not.toBeInTheDocument();
    expect(await screen.findByText('This entry was deleted on another device')).toBeInTheDocument();
  });

  it('keeps unsaved edits when it was changed elsewhere', async () => {
    const { changes, services, created, user, name } = await openEditor();
    await user.clear(name);
    await user.type(name, 'My edit');

    await services.entries.update(created.id, { name: 'Their edit' });
    await act(async () => changes.emit(new Set(['entry'])));

    expect(await screen.findByRole('textbox', { name: /name/i })).toHaveValue('My edit');
  });
});
