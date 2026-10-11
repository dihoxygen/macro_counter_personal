import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstimateError, type Estimate } from '../../src/api/estimates';
import { AddFoodPhoto } from '../../src/features/add-food/AddFoodPhoto';
import { PhotoDecodeError } from '../../src/media/reencodePhoto';
import { toDayKey } from '../../src/domain/days';
import { renderWithServices } from './testServices';
import { eggItem, estimateOf, pendingUntilAborted, toastItem } from './fixtures';

const today = () => toDayKey(new Date());
const photoFile = () => new File(['raw-bytes'], 'meal.jpg', { type: 'image/jpeg' });
const reencoded = new Blob(['jpeg'], { type: 'image/jpeg' });

async function setup(
  estimateFromPhoto: (photo: Blob, note: string | undefined, signal: AbortSignal) => Promise<Estimate>,
  reencodePhoto: (file: File) => Promise<Blob> = async () => reencoded,
) {
  const user = userEvent.setup();
  const onConfirmed = vi.fn();
  const onText = vi.fn();
  const onManual = vi.fn();
  const rendered = await renderWithServices(
    <AddFoodPhoto onConfirmed={onConfirmed} onText={onText} onManual={onManual} />,
    { estimateFromPhoto: vi.fn(estimateFromPhoto), reencodePhoto: vi.fn(reencodePhoto) },
  );
  return { user, onConfirmed, onText, onManual, ...rendered };
}

async function choosePhoto(user: ReturnType<typeof userEvent.setup>, note?: string) {
  await user.upload(screen.getByLabelText(/photo/i), photoFile());
  if (note) await user.type(screen.getByLabelText(/note/i), note);
  await user.click(screen.getByRole('button', { name: /estimate/i }));
}

describe('AddFoodPhoto', () => {
  it('uses a camera-capable file input and an optional note of up to 300 characters', async () => {
    await setup(async () => estimateOf(eggItem));
    const input = screen.getByLabelText(/photo/i);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(screen.getByLabelText(/note/i)).toHaveAttribute('maxLength', '300');
  });

  it('re-encodes the photo before upload and sends the note', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await choosePhoto(user, 'cooked in olive oil');

    expect(services.reencodePhoto).toHaveBeenCalledWith(expect.any(File));
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, 'cooked in olive oil', expect.any(AbortSignal));
  });

  it('sends no note when the note is empty', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await choosePhoto(user);
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, undefined, expect.any(AbortSignal));
  });

  it('shows progress with Cancel; Cancel aborts and saves nothing (FR-016)', async () => {
    const pending = pendingUntilAborted();
    const { user, services } = await setup((_photo, _note, signal) => pending.fn(null, signal));
    await choosePhoto(user);

    expect(await screen.findByRole('status')).toHaveTextContent(/estimating/i);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(pending.signal()?.aborted).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await services.entries.listByDay(today())).toEqual([]);
  });

  it('lets the user edit, remove and add items before confirming', async () => {
    const { user, services, onConfirmed } = await setup(async () => estimateOf(eggItem, toastItem));
    await choosePhoto(user);

    // Remove the toast.
    const toast = await screen.findByRole('group', { name: 'Toast' });
    await user.click(within(toast).getByRole('button', { name: /remove/i }));
    expect(screen.queryByRole('group', { name: 'Toast' })).not.toBeInTheDocument();

    // Add a side salad by hand.
    await user.click(screen.getByRole('button', { name: /add item/i }));
    const form = screen.getByRole('group', { name: /new item/i });
    await user.type(within(form).getByLabelText(/name/i), 'Side salad');
    await user.type(within(form).getByLabelText(/amount/i), '80');
    await user.type(within(form).getByLabelText(/calories/i), '20');
    await user.type(within(form).getByLabelText(/protein/i), '1');
    await user.type(within(form).getByLabelText(/carbs/i), '3.5');
    await user.type(within(form).getByLabelText(/fat/i), '0.2');
    await user.click(within(form).getByRole('button', { name: /^add$/i }));

    // Edit the egg.
    const egg = screen.getByRole('group', { name: 'Egg' });
    await user.click(within(egg).getByRole('button', { name: /edit/i }));
    const protein = within(egg).getByLabelText(/protein/i);
    await user.clear(protein);
    await user.type(protein, '7');
    await user.click(within(egg).getByRole('button', { name: /done/i }));

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    const entries = await services.entries.listByDay(today());
    expect(entries.map((e) => [e.name, e.source, e.macros.proteinG])).toEqual([
      ['Egg', 'ai-edited', 7],
      ['Side salad', 'manual', 1],
    ]);
  });

  it('cannot confirm after removing every item', async () => {
    const { user } = await setup(async () => estimateOf(eggItem));
    await choosePhoto(user);
    const egg = await screen.findByRole('group', { name: 'Egg' });
    await user.click(within(egg).getByRole('button', { name: /remove/i }));
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('an unrecognized photo offers Retry, Describe in text and Enter manually', async () => {
    const { user, services, onText, onManual } = await setup(async () => estimateOf());
    await choosePhoto(user);

    expect(await screen.findByText(/couldn.t identify food/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(services.estimateFromPhoto).toHaveBeenCalledTimes(2);
    await user.click(await screen.findByRole('button', { name: /describe in text/i }));
    expect(onText).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /enter manually/i }));
    expect(onManual).toHaveBeenCalled();
  });

  it('a photo that cannot be decoded shows "This image couldn\'t be used"', async () => {
    const { user, services } = await setup(
      async () => estimateOf(eggItem),
      async () => {
        throw new PhotoDecodeError('decode failed');
      },
    );
    await choosePhoto(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/this image couldn.t be used/i);
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enter manually/i })).toBeInTheDocument();
  });

  it.each(['image_too_large', 'unsupported_media_type'] as const)(
    'a %s error explains the image could not be used',
    async (code) => {
      const { user } = await setup(async () => {
        throw new EstimateError(code);
      });
      await choosePhoto(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(/this image couldn.t be used/i);
      expect(screen.getByRole('button', { name: /describe in text/i })).toBeInTheDocument();
    },
  );

  it('asks for a photo before estimating', async () => {
    const user = userEvent.setup();
    const { services } = await renderWithServices(
      <AddFoodPhoto onConfirmed={vi.fn()} onText={vi.fn()} onManual={vi.fn()} />,
      { estimateFromPhoto: vi.fn() },
    );
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a photo/i);
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
  });
});
