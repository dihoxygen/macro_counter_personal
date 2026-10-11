import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstimateError, type EstimateErrorCode } from '../../src/api/estimates';
import { AddFoodText } from '../../src/features/add-food/AddFoodText';
import { toDayKey } from '../../src/domain/days';
import { renderWithServices } from './testServices';
import { bananaItem, eggItem, estimateOf, pendingUntilAborted, toastItem } from './fixtures';

const today = () => toDayKey(new Date());

async function setup(estimateFromText: (d: string, s: AbortSignal) => Promise<unknown>) {
  const user = userEvent.setup();
  const onConfirmed = vi.fn();
  const onManual = vi.fn();
  const rendered = await renderWithServices(
    <AddFoodText onConfirmed={onConfirmed} onManual={onManual} />,
    { estimateFromText: vi.fn(estimateFromText) as never },
  );
  return { user, onConfirmed, onManual, ...rendered };
}

async function describeFood(user: ReturnType<typeof userEvent.setup>, text = '1 medium banana') {
  await user.type(screen.getByLabelText(/what did you eat/i), text);
  await user.click(screen.getByRole('button', { name: /estimate/i }));
}

describe('AddFoodText', () => {
  it('shows a progress indicator with Cancel, and Cancel aborts with nothing saved', async () => {
    const pending = pendingUntilAborted();
    const { user, services, onConfirmed } = await setup(pending.fn);

    await describeFood(user);
    expect(screen.getByRole('status')).toHaveTextContent(/estimating/i);
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(pending.signal()?.aborted).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/what did you eat/i)).toBeInTheDocument();
    expect(await services.entries.listByDay(today())).toEqual([]);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('sends only the description', async () => {
    const { user, services } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, '1 medium banana');
    expect(services.estimateFromText).toHaveBeenCalledWith('1 medium banana', expect.any(AbortSignal));
  });

  it('shows the item, the assumed portion, formatted macros and an AI estimate label', async () => {
    const { user } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText('1 medium banana (~118 g)')).toBeInTheDocument();
    expect(within(item).getByText('105 kcal')).toBeInTheDocument();
    expect(within(item).getByText('1.3 g')).toBeInTheDocument();
    expect(within(item).getByText('27 g')).toBeInTheDocument();
    expect(within(item).getByText('0.4 g')).toBeInTheDocument();
    expect(screen.getByText(/ai estimate/i)).toBeInTheDocument();
  });

  it('shows per-item rows plus a combined total for several foods', async () => {
    const { user } = await setup(async () => estimateOf(eggItem, toastItem));
    await describeFood(user, 'egg and toast');

    expect(await screen.findByRole('group', { name: 'Egg' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Toast' })).toBeInTheDocument();
    const total = screen.getByRole('group', { name: /total/i });
    expect(within(total).getByText('147 kcal')).toBeInTheDocument();
    expect(within(total).getByText('9.9 g')).toBeInTheDocument();
  });

  it('a calorie_macro_mismatch flag shows a warning and blocks Confirm until accepted', async () => {
    const flagged = { ...bananaItem, macros: { ...bananaItem.macros, kcal: 400 }, flags: ['calorie_macro_mismatch' as const] };
    const { user, services, onConfirmed } = await setup(async () => estimateOf(flagged));
    await describeFood(user);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText(/calories don.t match/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();

    await user.click(within(item).getByRole('button', { name: /yes, these values are right/i }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect((await services.entries.listByDay(today()))[0]!.macros.kcal).toBe(400);
  });

  it('a large_portion flag also needs acceptance', async () => {
    const big = { ...bananaItem, portion: { amount: 2500, unit: 'g' as const }, flags: ['large_portion' as const] };
    const { user } = await setup(async () => estimateOf(big));
    await describeFood(user);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText(/unusually large portion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('saves the edited value, not the AI value, and records the source as ai-edited', async () => {
    const { user, services, onConfirmed } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user);

    const item = await screen.findByRole('group', { name: 'Banana' });
    await user.click(within(item).getByRole('button', { name: /edit/i }));
    const protein = within(item).getByLabelText(/protein/i);
    await user.clear(protein);
    await user.type(protein, '2');
    await user.click(within(item).getByRole('button', { name: /done/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const [entry] = await services.entries.listByDay(today());
    expect(entry!.macros.proteinG).toBe(2);
    expect(entry!.source).toBe('ai-edited');
  });

  it('rejects an invalid edit with an inline error', async () => {
    const { user } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user);

    const item = await screen.findByRole('group', { name: 'Banana' });
    await user.click(within(item).getByRole('button', { name: /edit/i }));
    const fat = within(item).getByLabelText(/fat/i);
    await user.clear(fat);
    await user.type(fat, '-3');
    await user.click(within(item).getByRole('button', { name: /done/i }));

    expect(within(item).getByRole('alert')).toHaveTextContent(/0 or more/i);
  });

  it('confirming an unedited estimate saves source ai and returns', async () => {
    const { user, services, onConfirmed } = await setup(async () => estimateOf(eggItem, toastItem));
    await describeFood(user, 'egg and toast');
    await user.click(await screen.findByRole('button', { name: /confirm/i }));

    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const entries = await services.entries.listByDay(today());
    expect(entries.map((e) => [e.name, e.source])).toEqual([
      ['Egg', 'ai'],
      ['Toast', 'ai'],
    ]);
  });

  it('Discard saves nothing', async () => {
    const { user, services, onConfirmed } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user);
    await user.click(await screen.findByRole('button', { name: /discard/i }));

    expect(await services.entries.listByDay(today())).toEqual([]);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/what did you eat/i)).toBeInTheDocument();
  });

  it("recognized:false shows Couldn't identify food with Retry and Enter manually", async () => {
    const { user, onManual, services } = await setup(async () => estimateOf());
    await describeFood(user, 'asdf');

    expect(await screen.findByText(/couldn.t identify food/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(services.estimateFromText).toHaveBeenCalledTimes(2);

    await user.click(await screen.findByRole('button', { name: /enter manually/i }));
    expect(onManual).toHaveBeenCalled();
  });

  it.each<EstimateErrorCode>(['invalid_request', 'invalid_ai_response', 'ai_unavailable', 'ai_timeout', 'network'])(
    'a %s error shows a clear message and a manual-entry option',
    async (code) => {
      const { user, onManual } = await setup(async () => {
        throw new EstimateError(code);
      });
      await describeFood(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(new EstimateError(code).message);
      await user.click(screen.getByRole('button', { name: /enter manually/i }));
      expect(onManual).toHaveBeenCalled();
    },
  );

  it('does not submit an empty description', async () => {
    const { user, services } = await setup(async () => estimateOf(bananaItem));
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(services.estimateFromText).not.toHaveBeenCalled();
  });
});
