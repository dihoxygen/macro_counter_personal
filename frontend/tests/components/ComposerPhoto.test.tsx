import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstimateError, type Estimate } from '../../src/api/estimates';
import type { Services } from '../../src/app/services';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { describeCameraError } from '../../src/media/camera';
import { PhotoDecodeError } from '../../src/media/reencodePhoto';
import { toDayKey } from '../../src/domain/days';
import { FakeCameraService } from './fakeCamera';
import { renderWithServices } from './testServices';
import { eggItem, estimateOf, pendingUntilAborted, toastItem } from './fixtures';

const today = () => toDayKey(new Date());
const photoFile = (name = 'meal.jpg') => new File(['raw-bytes'], name, { type: 'image/jpeg' });
const reencoded = new Blob(['jpeg'], { type: 'image/jpeg' });

type User = ReturnType<typeof userEvent.setup>;

afterEach(() => {
  vi.restoreAllMocks();
});

// Feature 004: ported from AddFoodPhoto.test.tsx. The photo step now lives in the composer on Today.
async function setup(
  estimateFromPhoto: (photo: Blob, note: string | undefined, signal: AbortSignal) => Promise<Estimate>,
  reencodePhoto: (file: Blob) => Promise<Blob> = async () => reencoded,
  overrides: Partial<Services> = {},
) {
  const user = userEvent.setup();
  const rendered = await renderWithServices(<TodayScreen onNavigate={vi.fn()} />, {
    estimateFromPhoto: vi.fn(estimateFromPhoto),
    reencodePhoto: vi.fn(reencodePhoto),
    ...overrides,
  });
  const composer = await screen.findByRole('region', { name: 'Log food' });
  await user.click(within(composer).getByRole('button', { name: 'Photo' }));
  return { user, composer, ...rendered };
}

const pressed = (composer: HTMLElement, name: string) =>
  within(within(composer).getByRole('group', { name: 'Entry method' })).getByRole('button', { name });

const libraryInput = () => screen.getByLabelText('Existing photo file');
const cameraAppInput = () => screen.getByLabelText('Camera app photo file');

async function pickLibraryPhoto(user: User, file = photoFile()) {
  await user.upload(libraryInput(), file);
  await screen.findByRole('img', { name: 'Selected photo' });
}

async function choosePhoto(user: User, note?: string) {
  await pickLibraryPhoto(user);
  if (note) await user.type(screen.getByLabelText(/note/i), note);
  await user.click(screen.getByRole('button', { name: /estimate/i }));
}

/** Records which inputs had .click() called on them (opening the picker or camera app). */
function spyOnInputClicks() {
  return vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
}

describe('Composer photo: sources (feature 002)', () => {
  it('offers Take photo and Choose existing photo without touching the camera (FR-001, FR-008)', async () => {
    const { services } = await setup(async () => estimateOf(eggItem));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
    expect(services.camera.start).not.toHaveBeenCalled();
  });

  it('Take photo waits for camera detection; Choose existing photo does not', async () => {
    let detected!: (support: 'live') => void;
    const camera = new FakeCameraService();
    camera.detectSupport.mockReturnValueOnce(new Promise((resolve) => (detected = resolve)));
    await setup(async () => estimateOf(eggItem), undefined, { camera });

    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeEnabled();
    detected('live');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled());
  });

  it('falls back to the camera app if detection fails', async () => {
    const camera = new FakeCameraService();
    camera.detectSupport.mockRejectedValueOnce(new Error('boom'));
    await setup(async () => estimateOf(eggItem), undefined, { camera });
    expect(await screen.findByText("Opens your device's camera app.")).toBeVisible();
  });

  it('the library input has no capture attribute; the camera-app input does (FR-002)', async () => {
    await setup(async () => estimateOf(eggItem));
    expect(libraryInput()).toHaveAttribute('type', 'file');
    expect(libraryInput()).toHaveAttribute('accept', 'image/*');
    expect(libraryInput()).not.toHaveAttribute('capture');
    expect(libraryInput()).not.toHaveAttribute('multiple');
    expect(cameraAppInput()).toHaveAttribute('accept', 'image/*');
    expect(cameraAppInput()).toHaveAttribute('capture', 'environment');
  });

  it('uses only the first file if several arrive (one photo per estimate)', async () => {
    const { services } = await setup(async () => estimateOf(eggItem));
    const first = photoFile('first.jpg');
    const user = userEvent.setup({ applyAccept: false });
    // Bypass the missing `multiple` attribute to simulate a browser handing over two files anyway.
    libraryInput().setAttribute('multiple', '');
    await user.upload(libraryInput(), [first, photoFile('second.jpg')]);
    await screen.findByRole('img', { name: 'Selected photo' });
    expect(services.reencodePhoto).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('Choose existing photo opens the library input', async () => {
    const { user } = await setup(async () => estimateOf(eggItem));
    const clicks = spyOnInputClicks();
    await user.click(screen.getByRole('button', { name: 'Choose existing photo' }));
    expect(clicks.mock.contexts).toContain(libraryInput());
    expect(clicks.mock.contexts).not.toContain(cameraAppInput());
  });

  it('without a live camera, Take photo opens the camera app input and says so (FR-004)', async () => {
    const { user } = await setup(async () => estimateOf(eggItem), undefined, {
      camera: new FakeCameraService({ support: 'camera-app' }),
    });
    expect(await screen.findByText("Opens your device's camera app.")).toBeVisible();
    const clicks = spyOnInputClicks();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(clicks.mock.contexts).toContain(cameraAppInput());
    expect(clicks.mock.contexts).not.toContain(libraryInput());
  });

  it('re-encodes at selection time and previews exactly what will be sent', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    const file = photoFile();
    await pickLibraryPhoto(user, file);

    expect(services.reencodePhoto).toHaveBeenCalledExactlyOnceWith(file);
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Selected photo' }).getAttribute('src')).toMatch(/^blob:/);

    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, undefined, expect.any(AbortSignal));
  });

  it('shows "Preparing photo…" while the photo is being prepared', async () => {
    let finish!: (blob: Blob) => void;
    const { user } = await setup(
      async () => estimateOf(eggItem),
      () => new Promise<Blob>((resolve) => (finish = resolve)),
    );
    await user.upload(libraryInput(), photoFile());
    expect(screen.getByRole('status')).toHaveTextContent('Preparing photo…');
    finish(reencoded);
    expect(await screen.findByRole('img', { name: 'Selected photo' })).toBeVisible();
  });

  it('with a library photo: Replace photo and Take photo are offered; Remove photo empties the step (FR-010)', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await pickLibraryPhoto(user);

    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Choose existing photo' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByRole('img', { name: 'Selected photo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose or take a photo first.');
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
  });

  it('with a camera-app photo: Retake and Choose existing photo are offered', async () => {
    const { user } = await setup(async () => estimateOf(eggItem), undefined, {
      camera: new FakeCameraService({ support: 'camera-app' }),
    });
    await user.upload(cameraAppInput(), photoFile());
    await screen.findByRole('img', { name: 'Selected photo' });
    expect(screen.getByRole('button', { name: 'Retake' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
  });

  it('a cancelled picker changes nothing and shows no error (US1 AS5)', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await user.upload(libraryInput(), []);
    expect(services.reencodePhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
  });

  it('a photo that cannot be decoded is rejected at selection; nothing is sent (FR-012)', async () => {
    const { user, services } = await setup(
      async () => estimateOf(eggItem),
      async () => {
        throw new PhotoDecodeError('decode failed');
      },
    );
    await user.upload(libraryInput(), photoFile('meal.heic'));

    expect(await screen.findByRole('alert')).toHaveTextContent("This photo couldn't be used. Choose another photo.");
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
  });

  it('disables the sources while an estimate is loading', async () => {
    const pending = pendingUntilAborted();
    const { user } = await setup((_photo, _note, signal) => pending.fn(null, signal));
    await choosePhoto(user);

    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeDisabled();
    expect(libraryInput()).toBeDisabled();
    expect(cameraAppInput()).toBeDisabled();
  });
});

describe('Composer photo: estimate flow (unchanged from feature 001, FR-016)', () => {
  it('keeps the note field at up to 300 characters', async () => {
    await setup(async () => estimateOf(eggItem));
    expect(screen.getByLabelText(/note/i)).toHaveAttribute('maxLength', '300');
  });

  it('sends the re-encoded photo and the note', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await choosePhoto(user, 'cooked in olive oil');
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, 'cooked in olive oil', expect.any(AbortSignal));
  });

  it('sends no note when the note is empty', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await choosePhoto(user);
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, undefined, expect.any(AbortSignal));
  });

  it('shows progress with Cancel; Cancel aborts and saves nothing', async () => {
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
    const { user, services } = await setup(async () => estimateOf(eggItem, toastItem));
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
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Review estimate' })).not.toBeInTheDocument());
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

  it('an unrecognized photo offers Retry (same photo, no re-encode), Describe in text and Enter manually', async () => {
    const { user, services, composer } = await setup(async () => estimateOf());
    await choosePhoto(user);

    expect(await screen.findByText(/couldn.t identify food/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await vi.waitFor(() => expect(services.estimateFromPhoto).toHaveBeenCalledTimes(2));
    expect(vi.mocked(services.estimateFromPhoto).mock.calls[1]![0]).toBe(reencoded);
    expect(services.reencodePhoto).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole('button', { name: /describe in text/i }));
    expect(pressed(composer, 'Describe')).toHaveAttribute('aria-pressed', 'true');

    await user.click(pressed(composer, 'Photo'));
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    await user.click(await screen.findByRole('button', { name: /enter manually/i }));
    expect(pressed(composer, 'Manual')).toHaveAttribute('aria-pressed', 'true');
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
    const { user, services } = await setup(async () => estimateOf(eggItem));
    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose or take a photo first.');
    expect(services.estimateFromPhoto).not.toHaveBeenCalled();
  });
});

describe('Composer photo: live camera (feature 002 US2)', () => {
  const live = () => ({ camera: new FakeCameraService({ support: 'live' }) });

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('Take photo opens the in-app preview instead of a file input', async () => {
    const { user } = await setup(async () => estimateOf(eggItem), undefined, live());
    const clicks = spyOnInputClicks();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('a snapshot becomes the selected photo with Retake, and the camera is off', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem), undefined, live());
    const camera = services.camera as FakeCameraService;
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Camera preview');
    await user.click(screen.getByRole('button', { name: 'Take snapshot' }));

    expect(await screen.findByRole('img', { name: 'Selected photo' })).toBeVisible();
    const snapshot = await camera.sessions[0]!.snapshot.mock.results[0]!.value;
    expect(services.reencodePhoto).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(screen.getByRole('button', { name: 'Retake' })).toBeVisible();
    expect(camera.liveSessions()).toEqual([]);

    await user.click(screen.getByRole('button', { name: /estimate/i }));
    expect(services.estimateFromPhoto).toHaveBeenCalledWith(reencoded, undefined, expect.any(AbortSignal));
  });

  it('Retake restarts the camera; cancelling it keeps the previous photo', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem), undefined, live());
    const camera = services.camera as FakeCameraService;
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await user.click(await screen.findByRole('button', { name: 'Take snapshot' }));
    await screen.findByRole('img', { name: 'Selected photo' });

    await user.click(screen.getByRole('button', { name: 'Retake' }));
    await screen.findByLabelText('Camera preview');
    expect(camera.start).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('img', { name: 'Selected photo' })).toBeVisible();
    expect(camera.liveSessions()).toEqual([]);
  });

  it('after a camera error, Choose existing photo and Use camera app open the right inputs (SC-005)', async () => {
    const camera = new FakeCameraService({
      support: 'live',
      startError: describeCameraError(new DOMException('x', 'SecurityError')),
    });
    const { user } = await setup(async () => estimateOf(eggItem), undefined, { camera });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByRole('alert');

    const clicks = spyOnInputClicks();
    await user.click(screen.getByRole('button', { name: 'Use camera app' }));
    expect(clicks.mock.contexts).toEqual([cameraAppInput()]);

    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByRole('alert');
    clicks.mockClear();
    await user.click(screen.getByRole('button', { name: 'Choose existing photo' }));
    expect(clicks.mock.contexts).toEqual([libraryInput()]);
    await pickLibraryPhoto(user);
    expect(screen.getByRole('img', { name: 'Selected photo' })).toBeVisible();
  });

  it('a file chosen while the camera view is open replaces it and turns the camera off', async () => {
    const { user, services } = await setup(async () => estimateOf(eggItem), undefined, live());
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Camera preview');
    await pickLibraryPhoto(user);
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument();
    expect((services.camera as FakeCameraService).liveSessions()).toEqual([]);
  });

  it('keeps the note and Estimate disabled while the camera is open', async () => {
    const { user } = await setup(async () => estimateOf(eggItem), undefined, live());
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Camera preview');
    expect(screen.getByLabelText(/note/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /estimate/i })).toBeDisabled();
  });

  it('switching to another entry mode turns the camera off (FR-007)', async () => {
    const camera = new FakeCameraService({ support: 'live' });
    const { user, composer } = await setup(async () => estimateOf(eggItem), undefined, { camera });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByLabelText('Camera preview');
    expect(camera.liveSessions()).toHaveLength(1);

    await user.click(pressed(composer, 'Describe'));
    expect(camera.liveSessions()).toEqual([]);
  });

  it('without a camera, Take photo is disabled with the reason; the library still works (P13)', async () => {
    const { user } = await setup(async () => estimateOf(eggItem), undefined, {
      camera: new FakeCameraService({ support: 'no-camera' }),
    });
    const take = await screen.findByRole('button', { name: 'Take photo' });
    await vi.waitFor(() => expect(take).toBeDisabled());
    expect(take).toHaveAccessibleDescription('No camera found on this device.');
    await pickLibraryPhoto(user);
  });
});
