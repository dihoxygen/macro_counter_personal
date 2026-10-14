import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCapture } from '../../src/features/add-food/CameraCapture';
import { describeCameraError, type CameraErrorReason, type CameraSession } from '../../src/media/camera';
import { FakeCameraService } from './fakeCamera';
import { renderWithServices } from './testServices';

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  // jsdom implements neither playback nor srcObject.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setVisibility('visible');
});

async function setup(camera = new FakeCameraService()) {
  const user = userEvent.setup();
  const props = {
    onCaptured: vi.fn<(blob: Blob) => void>(),
    onCancel: vi.fn(),
    onChooseExisting: vi.fn(),
    onUseCameraApp: vi.fn(),
  };
  const rendered = await renderWithServices(<CameraCapture {...props} />, { camera });
  return { user, camera, ...props, ...rendered };
}

const preview = () => screen.findByLabelText('Camera preview');

describe('CameraCapture', () => {
  it('starts the default (rear) camera and shows the live preview (FR-003, FR-006)', async () => {
    let release!: (session: CameraSession) => void;
    const camera = new FakeCameraService();
    const realStart = camera.start.getMockImplementation()!;
    camera.start.mockImplementationOnce(
      (options) =>
        new Promise((resolve) => {
          release = resolve;
          void realStart(options);
        }),
    );
    await setup(camera);

    expect(camera.start).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Starting camera…');

    await act(async () => release(camera.sessions[0]!));
    const video = await preview();
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('playsinline');
    expect((video as HTMLVideoElement).srcObject).toBe(camera.sessions[0]!.stream);
    expect(screen.getByRole('button', { name: 'Take snapshot' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('offers Switch camera only with two or more cameras; switching stops the old one first', async () => {
    const single = await setup(new FakeCameraService({ deviceIds: ['a'] }));
    await preview();
    expect(screen.queryByRole('button', { name: 'Switch camera' })).not.toBeInTheDocument();
    single.unmount();

    const { user, camera } = await setup(new FakeCameraService({ deviceIds: ['a', 'b'] }));
    await preview();
    camera.start.mockClear();
    const first = camera.sessions[0]!;
    first.stop.mockImplementation(() => {
      first.stopped = true;
      expect(camera.start).not.toHaveBeenCalled(); // stopped before the next start
    });

    await user.click(screen.getByRole('button', { name: 'Switch camera' }));
    expect(first.stopped).toBe(true);
    expect(camera.start).toHaveBeenCalledExactlyOnceWith({ deviceId: 'b' });
    await preview();
    expect(camera.liveSessions()).toEqual([camera.sessions[1]]);
  });

  it('Take snapshot captures the frame, turns the camera off, then hands over the photo (FR-005, FR-007)', async () => {
    const { user, camera, onCaptured } = await setup();
    const video = await preview();
    const session = camera.sessions[0]!;
    const order: string[] = [];
    session.snapshot.mockImplementation(async () => {
      order.push('snapshot');
      return new Blob(['frame'], { type: 'image/jpeg' });
    });
    session.stop.mockImplementation(() => {
      session.stopped = true;
      order.push('stop');
    });
    onCaptured.mockImplementation(() => order.push('captured'));

    await user.click(screen.getByRole('button', { name: 'Take snapshot' }));
    expect(session.snapshot).toHaveBeenCalledWith(video);
    expect(order).toEqual(['snapshot', 'stop', 'captured']);
    expect(onCaptured.mock.calls[0]![0].type).toBe('image/jpeg');
  });

  it('Cancel turns the camera off', async () => {
    const { user, camera, onCancel } = await setup();
    await preview();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(camera.liveSessions()).toEqual([]);
    expect(onCancel).toHaveBeenCalled();
  });

  it('unmounting turns the camera off', async () => {
    const { camera, unmount } = await setup();
    await preview();
    unmount();
    expect(camera.liveSessions()).toEqual([]);
  });

  it('a camera that starts after unmount is stopped immediately (research R5)', async () => {
    let release!: () => void;
    const camera = new FakeCameraService();
    const realStart = camera.start.getMockImplementation()!;
    camera.start.mockImplementationOnce(async (options) => {
      await new Promise<void>((resolve) => (release = resolve));
      return realStart(options);
    });
    const { unmount } = await setup(camera);
    unmount();
    await act(async () => release());
    expect(camera.sessions).toHaveLength(1);
    expect(camera.liveSessions()).toEqual([]);
  });

  it('hiding the page pauses the camera; it only resumes on request', async () => {
    const { user, camera, onChooseExisting } = await setup();
    await preview();

    act(() => setVisibility('hidden'));
    expect(camera.liveSessions()).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Camera paused');

    act(() => setVisibility('visible'));
    expect(camera.start).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Choose existing photo' }));
    expect(onChooseExisting).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Resume camera' }));
    await preview();
    expect(camera.start).toHaveBeenCalledTimes(2);
    expect(camera.liveSessions()).toHaveLength(1);
  });

  it('a camera that disconnects while live shows a message with Try again', async () => {
    const { user, camera } = await setup();
    await preview();
    act(() => camera.sessions[0]!.endUnexpectedly());

    expect(screen.getByRole('alert')).toHaveTextContent('The camera was disconnected.');
    expect(screen.getByRole('button', { name: 'Choose existing photo' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await preview();
    expect(camera.start).toHaveBeenCalledTimes(2);
  });

  it.each<CameraErrorReason>(['denied', 'no-camera', 'in-use', 'unsupported', 'unknown'])(
    'a start failure (%s) explains itself and offers the right ways out (FR-009)',
    async (reason) => {
      const error = cameraErrorFor(reason);
      const camera = new FakeCameraService({ startError: error });
      const { user, onUseCameraApp, onChooseExisting } = await setup(camera);

      expect(await screen.findByRole('alert')).toHaveTextContent(error.message);
      const tryAgain = screen.queryByRole('button', { name: 'Try again' });
      const cameraApp = screen.queryByRole('button', { name: 'Use camera app' });
      expect(tryAgain !== null).toBe(error.canRetry);
      expect(cameraApp !== null).toBe(error.offerCameraApp);

      await user.click(screen.getByRole('button', { name: 'Choose existing photo' }));
      expect(onChooseExisting).toHaveBeenCalled();
      if (cameraApp) {
        await user.click(cameraApp);
        expect(onUseCameraApp).toHaveBeenCalled();
      }
      if (tryAgain) {
        camera.failWith(undefined);
        await user.click(tryAgain);
        await preview();
        expect(camera.start).toHaveBeenCalledTimes(2);
      }
    },
  );

  it('works with the keyboard alone (FR-015)', async () => {
    const { user, onCaptured } = await setup(new FakeCameraService({ deviceIds: ['a', 'b'] }));
    await preview();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Take snapshot' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch camera' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(onCaptured).toHaveBeenCalled());
  });
});

/** The real mapping for a reason, built from a representative DOMException name. */
function cameraErrorFor(reason: CameraErrorReason) {
  const name: Record<CameraErrorReason, unknown> = {
    denied: new DOMException('x', 'NotAllowedError'),
    'no-camera': new DOMException('x', 'NotFoundError'),
    'in-use': new DOMException('x', 'NotReadableError'),
    unsupported: new DOMException('x', 'SecurityError'),
    disconnected: 'disconnected',
    unknown: new Error('x'),
  };
  return describeCameraError(name[reason]);
}
