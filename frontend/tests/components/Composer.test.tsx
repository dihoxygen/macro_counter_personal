import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstimateError, type Estimate, type EstimateErrorCode } from '../../src/api/estimates';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { toDayKey } from '../../src/domain/days';
import type { Services } from '../../src/app/services';
import { createTestServices, renderWithServices } from './testServices';
import { bananaItem, eggItem, estimateOf, pendingUntilAborted, toastItem } from './fixtures';

// Feature 004: describe, review and confirm a food on Today (User Story 1, contracts/today-ui.md).

const today = () => toDayKey(new Date());

async function setup(
  estimateFromText: (d: string, s: AbortSignal) => Promise<Estimate>,
  overrides: Partial<Services> = {},
) {
  const user = userEvent.setup();
  const rendered = await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, {
    estimateFromText: vi.fn(estimateFromText) as never,
    ...overrides,
  });
  const composer = await screen.findByRole('region', { name: 'Log food' });
  return { user, composer, ...rendered };
}

const field = (composer: HTMLElement) => within(composer).getByLabelText('What did you eat?');

async function describeFood(user: ReturnType<typeof userEvent.setup>, composer: HTMLElement, text = '1 medium banana') {
  await user.type(field(composer), text);
  await user.click(within(composer).getByRole('button', { name: 'Estimate' }));
}

describe('Composer: describe on Today', () => {
  it('(a) has a Log food region with the description field and an Estimate button', async () => {
    const { composer } = await setup(async () => estimateOf(bananaItem));
    expect(field(composer)).toBeInTheDocument();
    expect(within(composer).getByRole('button', { name: 'Estimate' })).toBeInTheDocument();
  });

  it('(b) Enter sends and the review card appears on Today', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await user.type(field(composer), 'banana{Enter}');

    expect(await screen.findByRole('region', { name: 'Review estimate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(services.estimateFromText).toHaveBeenCalledWith('banana', expect.any(AbortSignal));
  });

  it('(c) Shift+Enter adds a newline and does not send', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await user.type(field(composer), 'egg{Shift>}{Enter}{/Shift}toast');

    expect(field(composer)).toHaveValue('egg\ntoast');
    expect(services.estimateFromText).not.toHaveBeenCalled();
  });

  it('(d) Enter during IME composition does not send', async () => {
    const { composer, services } = await setup(async () => estimateOf(bananaItem));
    fireEvent.change(field(composer), { target: { value: 'たまご' } });
    fireEvent.keyDown(field(composer), { key: 'Enter', isComposing: true });

    expect(services.estimateFromText).not.toHaveBeenCalled();
  });

  it('(e) Confirm logs the item, closes the card, clears and focuses the field', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Review estimate' })).not.toBeInTheDocument());
    expect(field(composer)).toHaveValue('');
    expect(field(composer)).toHaveFocus();
    const list = await screen.findByRole('list', { name: /entries/i });
    expect(await within(list).findByText('Banana')).toBeInTheDocument();
    expect((await services.entries.listByDay(today())).map((e) => e.name)).toEqual(['Banana']);
  });

  it('(f) Discard logs nothing and keeps the description', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer, 'banana');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('region', { name: 'Review estimate' })).not.toBeInTheDocument();
    expect(field(composer)).toHaveValue('banana');
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it('(g) while the card is open, Estimate and the description are disabled', async () => {
    const { user, composer } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);
    await screen.findByRole('region', { name: 'Review estimate' });

    expect(field(composer)).toBeDisabled();
    expect(within(composer).getByRole('button', { name: 'Estimate' })).toBeDisabled();
  });

  it('(h) focus moves to the card when it opens', async () => {
    const { user, composer } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);
    const card = await screen.findByRole('region', { name: 'Review estimate' });

    await vi.waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
  });

  it('(i) shows progress with Cancel in the card area; Cancel keeps the text', async () => {
    const pending = pendingUntilAborted();
    const { user, composer, services } = await setup(pending.fn as never);
    await describeFood(user, composer, 'banana');

    expect(within(composer).getByRole('status')).toHaveTextContent(/estimating/i);
    await user.click(within(composer).getByRole('button', { name: 'Cancel' }));

    expect(pending.signal()?.aborted).toBe(true);
    expect(within(composer).queryByRole('status')).not.toBeInTheDocument();
    expect(field(composer)).toHaveValue('banana');
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it.each<EstimateErrorCode>(['invalid_request', 'invalid_ai_response', 'ai_unavailable', 'ai_timeout', 'network'])(
    '(j) a %s error shows its message with Retry and Enter manually',
    async (code) => {
      const { user, composer, services } = await setup(async () => {
        throw new EstimateError(code);
      });
      await describeFood(user, composer, 'banana');

      expect(await within(composer).findByRole('alert')).toHaveTextContent(new EstimateError(code).message);
      await user.click(within(composer).getByRole('button', { name: 'Retry' }));
      await vi.waitFor(() => expect(services.estimateFromText).toHaveBeenCalledTimes(2));
      expect(services.estimateFromText).toHaveBeenLastCalledWith('banana', expect.any(AbortSignal));

      await user.click(await within(composer).findByRole('button', { name: 'Enter manually' }));
      expect(within(composer).getByRole('textbox', { name: 'Food name' })).toBeVisible();
      expect(field(composer)).toHaveValue('banana');
    },
  );

  it.each<EstimateErrorCode>(['quota_exceeded', 'rate_limited'])(
    '(j) a %s refusal keeps manual entry one click away (FR-019)',
    async (code) => {
      const { user, composer } = await setup(async () => {
        throw new EstimateError(code, { scope: 'user_daily', resetAt: '2026-10-15T00:00:00Z' });
      });
      await describeFood(user, composer);

      expect(await within(composer).findByRole('alert')).toHaveTextContent(
        code === 'quota_exceeded' ? /reached today's AI lookup limit/ : /wait a minute/i,
      );
      await user.click(within(composer).getByRole('button', { name: 'Enter manually' }));
      expect(within(composer).getByRole('textbox', { name: 'Food name' })).toBeVisible();
    },
  );

  it("(k) an unrecognized estimate shows Couldn't identify food with Retry and Enter manually", async () => {
    const { user, composer, services } = await setup(async () => estimateOf());
    await describeFood(user, composer, 'asdf');

    expect(
      await within(composer).findByText('Couldn’t identify food. Try describing it differently, or enter it manually.'),
    ).toBeInTheDocument();
    await user.click(within(composer).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(services.estimateFromText).toHaveBeenCalledTimes(2));
    await user.click(await within(composer).findByRole('button', { name: 'Enter manually' }));
    expect(within(composer).getByRole('textbox', { name: 'Food name' })).toBeVisible();
  });

  it('(l) shows the card’s protein as pending and follows edits', async () => {
    const shake = { ...bananaItem, name: 'Shake', macros: { kcal: 216, proteinG: 54, carbsG: 0, fatG: 0 } };
    const user = userEvent.setup();
    const services = await createTestServices({ estimateFromText: vi.fn(async () => estimateOf(shake)) as never });
    await services.goals.setGoal(today(), 150);
    await services.entries.create({
      dayKey: today(),
      loggedAt: new Date().toISOString(),
      name: 'Logged',
      quantity: { amount: 100, unit: 'g' },
      macros: { kcal: 384, proteinG: 96, carbsG: 0, fatG: 0 },
      source: 'manual',
      savedFoodId: null,
    });
    await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, services);
    const composer = await screen.findByRole('region', { name: 'Log food' });
    await describeFood(user, composer, 'shake');

    expect(await screen.findByText('+54 g pending')).toBeInTheDocument();
    const item = screen.getByRole('group', { name: 'Shake' });
    await user.click(within(item).getByRole('button', { name: 'Edit' }));
    const protein = within(item).getByLabelText('Protein (g)');
    await user.clear(protein);
    await user.type(protein, '40');
    await user.click(within(item).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('+40 g pending')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it('(m) a card confirmed after midnight is logged to the new day and shown on Today', async () => {
    let clock = new Date(2026, 9, 8, 23, 59);
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem), { now: () => clock });
    await describeFood(user, composer);
    await screen.findByRole('region', { name: 'Review estimate' });

    clock = new Date(2026, 9, 9, 0, 1);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(async () =>
      expect((await services.entries.listByDay('2026-10-09')).map((e) => e.name)).toEqual(['Banana']),
    );
    const list = await screen.findByRole('list', { name: /entries/i });
    expect(await within(list).findByText('Banana')).toBeInTheDocument();
  });
});

// Ported from AddFoodText.test.tsx: the review behaviour is unchanged, only where it appears.
describe('Composer: review behaviour (ported)', () => {
  it('sends only the description', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer, '1 medium banana');
    expect(services.estimateFromText).toHaveBeenCalledWith('1 medium banana', expect.any(AbortSignal));
  });

  it('shows the item, the assumed portion, formatted macros and an AI estimate label', async () => {
    const { user, composer } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText('1 medium banana (~118 g)')).toBeInTheDocument();
    expect(within(item).getByText('105 kcal')).toBeInTheDocument();
    expect(within(item).getByText('1.3 g')).toBeInTheDocument();
    expect(within(item).getByText('27 g')).toBeInTheDocument();
    expect(within(item).getByText('0.4 g')).toBeInTheDocument();
    expect(within(composer).getByText(/ai estimate/i)).toBeInTheDocument();
  });

  it('shows per-item rows plus a combined total for several foods', async () => {
    const { user, composer } = await setup(async () => estimateOf(eggItem, toastItem));
    await describeFood(user, composer, 'egg and toast');

    const card = await screen.findByRole('region', { name: 'Review estimate' });
    expect(within(card).getByRole('group', { name: 'Egg' })).toBeInTheDocument();
    expect(within(card).getByRole('group', { name: 'Toast' })).toBeInTheDocument();
    const total = within(card).getByRole('group', { name: /total/i });
    expect(within(total).getByText('147 kcal')).toBeInTheDocument();
    expect(within(total).getByText('9.9 g')).toBeInTheDocument();
  });

  it('a calorie_macro_mismatch flag shows a warning and blocks Confirm until accepted', async () => {
    const flagged = { ...bananaItem, macros: { ...bananaItem.macros, kcal: 400 }, flags: ['calorie_macro_mismatch' as const] };
    const { user, composer, services } = await setup(async () => estimateOf(flagged));
    await describeFood(user, composer);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText(/calories don.t match/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();

    await user.click(within(item).getByRole('button', { name: /yes, these values are right/i }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await vi.waitFor(async () => expect((await services.entries.listByDay(today()))[0]!.macros.kcal).toBe(400));
  });

  it('a large_portion flag also needs acceptance', async () => {
    const big = { ...bananaItem, portion: { amount: 2500, unit: 'g' as const }, flags: ['large_portion' as const] };
    const { user, composer } = await setup(async () => estimateOf(big));
    await describeFood(user, composer);

    const item = await screen.findByRole('group', { name: 'Banana' });
    expect(within(item).getByText(/unusually large portion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('saves the edited value, not the AI value, and records the source as ai-edited', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);

    const item = await screen.findByRole('group', { name: 'Banana' });
    await user.click(within(item).getByRole('button', { name: 'Edit' }));
    const protein = within(item).getByLabelText(/protein/i);
    await user.clear(protein);
    await user.type(protein, '2');
    await user.click(within(item).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(async () => expect(await services.entries.listByDay(today())).toHaveLength(1));
    const [entry] = await services.entries.listByDay(today());
    expect(entry!.macros.proteinG).toBe(2);
    expect(entry!.source).toBe('ai-edited');
  });

  it('rejects an invalid edit with an inline error', async () => {
    const { user, composer } = await setup(async () => estimateOf(bananaItem));
    await describeFood(user, composer);

    const item = await screen.findByRole('group', { name: 'Banana' });
    await user.click(within(item).getByRole('button', { name: 'Edit' }));
    const fat = within(item).getByLabelText(/fat/i);
    await user.clear(fat);
    await user.type(fat, '-3');
    await user.click(within(item).getByRole('button', { name: 'Done' }));

    expect(within(item).getByRole('alert')).toHaveTextContent(/0 or more/i);
  });

  it('confirming an unedited estimate saves source ai', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(eggItem, toastItem));
    await describeFood(user, composer, 'egg and toast');
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await vi.waitFor(async () => expect(await services.entries.listByDay(today())).toHaveLength(2));
    const entries = await services.entries.listByDay(today());
    expect(entries.map((e) => [e.name, e.source])).toEqual([
      ['Egg', 'ai'],
      ['Toast', 'ai'],
    ]);
  });

  it('does not submit an empty description', async () => {
    const { user, composer, services } = await setup(async () => estimateOf(bananaItem));
    await user.click(within(composer).getByRole('button', { name: 'Estimate' }));
    await user.type(field(composer), '   {Enter}');
    expect(services.estimateFromText).not.toHaveBeenCalled();
  });
});
