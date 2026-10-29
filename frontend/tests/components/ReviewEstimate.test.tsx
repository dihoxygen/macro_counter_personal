import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewEstimate } from '../../src/features/add-food/ReviewEstimate';
import { startReview, type ReviewState } from '../../src/domain/review';
import { bananaItem, eggItem, estimateOf } from './fixtures';

// Feature 004: the composer shows the card's protein as pending, so it must see every edit (FR-004).
describe('ReviewEstimate onChange', () => {
  function setup(initial: ReviewState) {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewEstimate initial={initial} onConfirm={vi.fn()} onDiscard={vi.fn()} onChange={onChange} />);
    return { user, onChange };
  }

  const lastState = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as ReviewState;

  it('is not called on first render', () => {
    const { onChange } = setup(startReview(estimateOf(bananaItem)));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports an edited item after Edit → Done', async () => {
    const { user, onChange } = setup(startReview(estimateOf(bananaItem)));
    const card = screen.getByRole('group', { name: 'Banana' });
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const protein = within(card).getByLabelText('Protein (g)');
    await user.clear(protein);
    await user.type(protein, '4');
    await user.click(within(card).getByRole('button', { name: 'Done' }));

    expect(lastState(onChange).items[0]!.macros.proteinG).toBe(4);
  });

  it('reports a removed item', async () => {
    const { user, onChange } = setup(startReview(estimateOf(bananaItem, eggItem)));
    await user.click(within(screen.getByRole('group', { name: 'Egg' })).getByRole('button', { name: 'Remove' }));

    expect(lastState(onChange).items.map((i) => i.name)).toEqual(['Banana']);
  });

  it('reports an added item', async () => {
    const { user, onChange } = setup(startReview(estimateOf(bananaItem)));
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('group', { name: 'New item' });
    await user.type(within(form).getByLabelText('Name'), 'Yogurt');
    await user.type(within(form).getByLabelText('Amount'), '170');
    await user.type(within(form).getByLabelText('Calories (kcal)'), '100');
    await user.type(within(form).getByLabelText('Protein (g)'), '17');
    await user.type(within(form).getByLabelText('Carbs (g)'), '6');
    await user.type(within(form).getByLabelText('Fat (g)'), '0.7');
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(lastState(onChange).items.map((i) => i.name)).toEqual(['Banana', 'Yogurt']);
  });

  it('reports an accepted warning', async () => {
    const flagged = { ...bananaItem, macros: { ...bananaItem.macros, kcal: 300 }, flags: ['calorie_macro_mismatch' as const] };
    const { user, onChange } = setup(startReview(estimateOf(flagged)));
    await user.click(screen.getByRole('button', { name: 'Yes, these values are right' }));

    expect(lastState(onChange).items[0]!.accepted).toBe(true);
  });
});
