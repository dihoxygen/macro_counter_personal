import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntryEditor } from '../../src/features/today/EntryEditor';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { toDayKey } from '../../src/domain/days';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';

const today = () => toDayKey(new Date());

const yogurt = (): NewEntry => ({
  dayKey: today(),
  loggedAt: new Date().toISOString(),
  name: 'Greek yogurt',
  quantity: { amount: 170, unit: 'g' },
  macros: { kcal: 100, proteinG: 17, carbsG: 6, fatG: 0.7 },
  source: 'ai',
  savedFoodId: null,
});

async function setup(entry: NewEntry = yogurt()) {
  const user = userEvent.setup();
  const services = await createTestServices();
  const saved = await services.entries.create(entry);
  const onClose = vi.fn();
  const onChanged = vi.fn();
  await renderWithServices(<EntryEditor entry={saved} onClose={onClose} onChanged={onChanged} />, services);
  return { user, services, saved, onClose, onChanged };
}

async function setField(user: ReturnType<typeof userEvent.setup>, label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

describe('EntryEditor', () => {
  it('rescales macros with scaleMacros when the quantity changes', async () => {
    const { user, services, saved, onChanged } = await setup();
    await setField(user, /amount/i, '85');

    expect(screen.getByLabelText(/protein/i)).toHaveValue(8.5);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const updated = await services.entries.get(saved.id);
    expect(updated!.quantity).toEqual({ amount: 85, unit: 'g' });
    expect(updated!.macros).toEqual({ kcal: 50, proteinG: 8.5, carbsG: 3, fatG: 0.35 });
    expect(updated!.source).toBe('ai');
    expect(updated!.dayKey).toBe(saved.dayKey);
  });

  it("saves macro values edited directly, and an 'ai' source becomes 'ai-edited'", async () => {
    const { user, services, saved, onChanged } = await setup();
    await setField(user, /protein/i, '20');
    await setField(user, /calories/i, '112');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const updated = await services.entries.get(saved.id);
    expect(updated!.macros.proteinG).toBe(20);
    expect(updated!.macros.kcal).toBe(112);
    expect(updated!.source).toBe('ai-edited');
    expect(updated!.dayKey).toBe(saved.dayKey);
  });

  it("keeps a 'manual' source as 'manual' after editing", async () => {
    const { user, services, saved, onChanged } = await setup({ ...yogurt(), source: 'manual' });
    await setField(user, /protein/i, '18');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((await services.entries.get(saved.id))!.source).toBe('manual');
  });

  it('applies the same validation as manual entry', async () => {
    const { user, services, saved, onChanged } = await setup();
    await setField(user, /fat/i, '-1');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/0 or more/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(await services.entries.get(saved.id)).toEqual(saved);
  });

  it('asks before saving implausibly large values', async () => {
    const { user, onChanged } = await setup();
    await setField(user, /amount/i, '3000');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/unusually large/i)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /save anyway/i }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('asks for confirmation before deleting, then removes the entry', async () => {
    const { user, services, saved, onChanged } = await setup();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.getByText(/delete this entry/i)).toBeInTheDocument();
    expect(await services.entries.get(saved.id)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /yes, delete/i }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await services.entries.get(saved.id)).toBeUndefined();
  });

  it('can back out of a delete', async () => {
    const { user, services, saved } = await setup();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(screen.getByRole('button', { name: /keep/i }));
    expect(await services.entries.get(saved.id)).toBeDefined();
  });

  it('Cancel closes without saving', async () => {
    const { user, services, saved, onClose } = await setup();
    await setField(user, /protein/i, '30');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(await services.entries.get(saved.id)).toEqual(saved);
  });

  it('does not rescale an entry whose amount is 0', async () => {
    const { user } = await setup({ ...yogurt(), quantity: { amount: 0, unit: 'g' }, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } });
    await setField(user, /amount/i, '100');
    expect(screen.getByLabelText(/protein/i)).toHaveValue(0);
  });
});

describe('Editing from the Today screen (FR-010)', () => {
  it('totals reflect each edit and delete exactly', async () => {
    const user = userEvent.setup();
    const services = await createTestServices();
    await services.entries.create({ ...yogurt(), loggedAt: '2026-10-08T07:00:00.000Z' });
    await services.entries.create({
      ...yogurt(),
      name: 'Chicken breast',
      loggedAt: '2026-10-08T12:00:00.000Z',
      quantity: { amount: 150, unit: 'g' },
      macros: { kcal: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4 },
    });
    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);
    const totals = await screen.findByRole('region', { name: /totals/i });
    const protein = () => within(totals).getByRole('group', { name: 'Protein' });
    await vi.waitFor(() => expect(protein()).toHaveTextContent('63.5 g'));

    // Edit: halve the yogurt.
    await user.click(screen.getByRole('button', { name: /greek yogurt/i }));
    // The composer's hidden Manual form has an Amount field too (feature 004); edit within the editor.
    const editor = screen.getByRole('form', { name: 'Edit Greek yogurt' });
    await user.clear(within(editor).getByLabelText(/amount/i));
    await user.type(within(editor).getByLabelText(/amount/i), '85');
    await user.click(within(editor).getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(protein()).toHaveTextContent('55 g'));

    // Delete: remove the chicken.
    await user.click(screen.getByRole('button', { name: /chicken breast/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete/i }));
    await vi.waitFor(() => expect(protein()).toHaveTextContent('8.5 g'));
    expect(screen.queryByText('Chicken breast')).not.toBeInTheDocument();
  });
});
