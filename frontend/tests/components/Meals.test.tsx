import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LogEntry, SavedFood } from '../../src/data/records';
import type { NewEntry } from '../../src/data/repositories';
import { startReview } from '../../src/domain/review';
import { ManualEntryForm } from '../../src/features/add-food/ManualEntryForm';
import { ReviewEstimate } from '../../src/features/add-food/ReviewEstimate';
import { RelogForm } from '../../src/features/recent/RelogForm';
import { MealCategoryField } from '../../src/features/shared/MealCategoryField';
import { EntryEditor } from '../../src/features/today/EntryEditor';
import { EntryList } from '../../src/features/today/EntryList';
import { createTestServices, renderWithServices } from './testServices';

const breakfastTime = new Date(2026, 10, 4, 8, 30);
const macros = { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 };

const logged = (id: string, name: string, mealCategory: LogEntry['mealCategory']): LogEntry => ({
  id,
  versionId: `state-${id}`,
  createdAt: breakfastTime.toISOString(),
  updatedAt: breakfastTime.toISOString(),
  schemaVersion: 1,
  dayKey: '2026-11-04',
  loggedAt: breakfastTime.toISOString(),
  name,
  quantity: { amount: 100, unit: 'g' },
  macros,
  source: 'manual',
  savedFoodId: null,
  mealCategory,
});

describe('MealCategoryField', () => {
  it('offers the four meals', () => {
    render(<MealCategoryField value="lunch" onChange={() => undefined} />);

    const field = screen.getByRole('combobox', { name: 'Meal' });
    expect(field).toHaveValue('lunch');
    expect(within(field).getAllByRole('option').map((o) => o.textContent)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  });

  it('reports a change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MealCategoryField value="lunch" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Meal' }), 'Dinner');

    expect(onChange).toHaveBeenCalledWith('dinner');
  });

  it('shows Uncategorized for an older entry, but offers no way back to it', () => {
    render(<MealCategoryField value={null} onChange={() => undefined} />);

    const field = screen.getByRole('combobox', { name: 'Meal' });
    expect(field).toHaveDisplayValue('Uncategorized');
    expect(within(field).getByRole('option', { name: 'Uncategorized' })).toBeDisabled();
  });
});

describe('the logging forms', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole('textbox', { name: /food name/i }), 'Egg');
    for (const label of [/amount/i, /calories/i, /protein/i, /carbs/i, /fat/i]) {
      await user.type(screen.getByRole('spinbutton', { name: label }), '1');
    }
    await user.click(screen.getByRole('button', { name: 'Save' }));
  };

  it('pre-fills the manual form, and saving needs no extra step', { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    const { services } = await renderWithServices(<ManualEntryForm onSaved={() => undefined} />, { now: () => breakfastTime });
    expect(screen.getByRole('combobox', { name: 'Meal' })).toHaveValue('breakfast');

    await fill(user);

    expect(await services.entries.listByDay('2026-11-04')).toMatchObject([{ mealCategory: 'breakfast' }]);
  });

  it('saves the meal chosen on the manual form', { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    const { services } = await renderWithServices(<ManualEntryForm onSaved={() => undefined} />, { now: () => breakfastTime });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Meal' }), 'Snacks');
    await fill(user);

    expect(await services.entries.listByDay('2026-11-04')).toMatchObject([{ mealCategory: 'snacks' }]);
  });

  it('gives each item of an estimate its own field', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    const item = { portion: { amount: 1, unit: 'g' as const }, portionDescription: '', macros, flags: [] };
    const state = startReview({ items: [{ ...item, name: 'Egg' }, { ...item, name: 'Toast' }] } as never);
    render(<ReviewEstimate initial={state} onConfirm={onConfirm} onDiscard={() => undefined} now={() => breakfastTime} />);

    const toast = within(screen.getByRole('group', { name: 'Toast' })).getByRole('combobox', { name: 'Meal' });
    expect(toast).toHaveValue('breakfast');
    await user.selectOptions(toast, 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const confirmed = (onConfirm.mock.calls as unknown as [[typeof state]])[0][0];
    expect(confirmed.items.map((i) => i.mealCategory)).toEqual([undefined, 'lunch']);
  });

  it('pre-fills re-logging, and keeps it to the same taps', async () => {
    const user = userEvent.setup();
    const food: SavedFood = {
      id: 'f1',
      createdAt: breakfastTime.toISOString(),
      updatedAt: breakfastTime.toISOString(),
      schemaVersion: 1,
      name: 'Oats',
      referenceQuantity: { amount: 100, unit: 'g' },
      macros,
      source: 'manual',
      lastUsedAt: breakfastTime.toISOString(),
    };
    const onLogged = vi.fn();
    const { services } = await renderWithServices(<RelogForm food={food} onLogged={onLogged} onBack={() => undefined} />, {
      now: () => breakfastTime,
    });
    expect(screen.getByRole('combobox', { name: 'Meal' })).toHaveValue('breakfast');

    await user.click(screen.getByRole('button', { name: 'Log' }));

    expect(onLogged).toHaveBeenCalled();
    expect(await services.entries.listByDay('2026-11-04')).toMatchObject([{ mealCategory: 'breakfast' }]);
  });
});

describe('the entry editor', () => {
  async function editorFor(mealCategory: null) {
    const services = await createTestServices();
    const created = await services.entries.create({ ...logged('x', 'Egg', 'lunch') } as NewEntry);
    const update = vi.spyOn(services.entries, 'update');
    await renderWithServices(<EntryEditor entry={{ ...created, mealCategory }} onClose={() => undefined} onChanged={() => undefined} />, services);
    return { created, update };
  }

  it('lets an uncategorized entry take a meal', async () => {
    const user = userEvent.setup();
    const { created, update } = await editorFor(null);

    const field = screen.getByRole('combobox', { name: 'Meal' });
    expect(field).toHaveDisplayValue('Uncategorized');
    await user.selectOptions(field, 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledWith(created.id, expect.objectContaining({ mealCategory: 'dinner' }));
  });

  it('leaves an uncategorized entry uncategorized if no meal was chosen', async () => {
    const user = userEvent.setup();
    const { update } = await editorFor(null);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update.mock.calls[0]![1]).not.toHaveProperty('mealCategory');
  });
});

describe('EntryList', () => {
  it('groups entries by meal with a heading and subtotal', () => {
    render(
      <EntryList
        entries={[logged('a', 'Egg', 'breakfast'), logged('b', 'Soup', 'lunch'), logged('c', 'Toast', 'breakfast'), logged('d', 'Tea', null)]}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^Breakfast/),
      expect.stringMatching(/^Lunch/),
      expect.stringMatching(/^Uncategorized/),
    ]);
    expect(screen.getByRole('heading', { name: /breakfast/i })).toHaveTextContent('200');
    expect(screen.getByRole('heading', { name: /lunch/i })).toHaveTextContent('100');
  });

  it('keeps every entry reachable in one list', () => {
    render(<EntryList entries={[logged('a', 'Egg', 'breakfast'), logged('b', 'Soup', 'lunch')]} onSelect={() => undefined} />);

    expect(within(screen.getByRole('list', { name: /entries/i })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Egg'),
      expect.stringContaining('Soup'),
    ]);
  });

  it('hands back the entry that was picked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const egg = logged('a', 'Egg', 'breakfast');
    render(<EntryList entries={[egg]} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /egg/i }));

    expect(onSelect).toHaveBeenCalledWith(egg);
  });
});
