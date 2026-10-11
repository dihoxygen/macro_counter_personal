import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualEntryForm } from '../../src/features/add-food/ManualEntryForm';
import { toDayKey } from '../../src/domain/days';
import { renderWithServices } from './testServices';

const today = () => toDayKey(new Date());

async function setup() {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const rendered = await renderWithServices(<ManualEntryForm onSaved={onSaved} />);
  return { user, onSaved, ...rendered };
}

type User = ReturnType<typeof userEvent.setup>;

async function fill(
  user: User,
  values: Partial<Record<'name' | 'amount' | 'kcal' | 'protein' | 'carbs' | 'fat', string>>,
  unit?: 'g' | 'ml' | 'serving',
) {
  const fields: [keyof typeof values, RegExp][] = [
    ['name', /food name/i],
    ['amount', /amount/i],
    ['kcal', /calories/i],
    ['protein', /protein/i],
    ['carbs', /carbs/i],
    ['fat', /fat/i],
  ];
  for (const [key, label] of fields) {
    const value = values[key];
    if (value === undefined) continue;
    const input = screen.getByLabelText(label);
    await user.clear(input);
    if (value !== '') await user.type(input, value);
  }
  if (unit) await user.selectOptions(screen.getByLabelText(/unit/i), unit);
}

const valid = { name: 'Greek yogurt', amount: '170', kcal: '100', protein: '17', carbs: '6', fat: '0.7' };

describe('ManualEntryForm', () => {
  it("saves an entry with source 'manual' for today", async () => {
    const { user, services, onSaved } = await setup();
    await fill(user, valid, 'g');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [entry] = await services.entries.listByDay(today());
    expect(entry).toMatchObject({
      name: 'Greek yogurt',
      quantity: { amount: 170, unit: 'g' },
      macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
      source: 'manual',
      savedFoodId: null,
    });
  });

  it('offers g, ml and serving units', async () => {
    await setup();
    const options = Array.from((screen.getByLabelText(/unit/i) as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(options).toEqual(['g', 'ml', 'serving']);
  });

  it.each([
    ['an empty name', { ...valid, name: '' }, /name is required/i],
    ['a name over 120 characters', { ...valid, name: 'x'.repeat(121) }, /120 characters/i],
    ['a missing amount', { ...valid, amount: '' }, /0 or more/i],
    ['negative protein', { ...valid, protein: '-1' }, /0 or more/i],
    ['missing calories', { ...valid, kcal: '' }, /0 or more/i],
  ])('shows an inline error for %s and saves nothing', async (_label, values, message) => {
    const { user, services, onSaved } = await setup();
    await fill(user, values, 'g');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getAllByRole('alert').some((a) => message.test(a.textContent ?? ''))).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it('accepts zero values (adds nothing)', async () => {
    const { user, onSaved } = await setup();
    await fill(user, { ...valid, amount: '0', kcal: '0', protein: '0', carbs: '0', fat: '0' }, 'g');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('asks for confirmation before saving implausibly large values', async () => {
    const { user, services, onSaved } = await setup();
    await fill(user, { ...valid, amount: '2500' }, 'g');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/unusually large/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /go back/i }));
    expect(await services.entries.listByDay(today())).toEqual([]);

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(screen.getByRole('button', { name: /save anyway/i }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((await services.entries.listByDay(today()))[0]!.quantity.amount).toBe(2500);
  });
});
