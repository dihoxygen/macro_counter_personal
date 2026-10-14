import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraStartError, createBrowserCameraService, type CameraSession } from '../../../src/media/camera';
import { PhotoDecodeError } from '../../../src/media/reencodePhoto';

/** A fake MediaStreamTrack: records stop() and lets the test fire 'ended'. */
function fakeTrack(deviceId: string) {
  const listeners: (() => void)[] = [];
  const track = {
    kind: 'video',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
    getSettings: () => ({ deviceId }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'ended') listeners.push(listener);
    },
    fireEnded: () => listeners.forEach((l) => l()),
  };
  return track;
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
}

const device = (kind: MediaDeviceKind, deviceId: string) =>
  ({ kind, deviceId, label: '', groupId: '' }) as MediaDeviceInfo;

function setup(options: { devices?: MediaDeviceInfo[]; enumerateFails?: boolean; activeDeviceId?: string } = {}) {
  const track = fakeTrack(options.activeDeviceId ?? 'rear');
  const mediaDevices = {
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(async () => fakeStream([track])),
    enumerateDevices: vi.fn(async () => {
      if (options.enumerateFails) throw new Error('nope');
      return options.devices ?? [device('videoinput', 'rear'), device('audioinput', 'mic')];
    }),
  };
  const service = createBrowserCameraService({ isSecureContext: true, mediaDevices, document });
  return { service, mediaDevices, track };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBrowserCameraService: detectSupport', () => {
  it('counts video inputs without asking for permission', async () => {
    const { service, mediaDevices } = setup({
      devices: [device('videoinput', ''), device('videoinput', ''), device('audioinput', '')],
    });
    expect(await service.detectSupport()).toBe('live');
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('reports no camera when there are no video inputs', async () => {
    const { service } = setup({ devices: [device('audioinput', 'mic')] });
    expect(await service.detectSupport()).toBe('no-camera');
  });

  it('tries the live camera when the device list is unavailable', async () => {
    const { service } = setup({ enumerateFails: true });
    expect(await service.detectSupport()).toBe('live');
  });

  it('uses the camera app outside a secure context or without mediaDevices', async () => {
    const insecure = createBrowserCameraService({
      isSecureContext: false,
      mediaDevices: setup().mediaDevices,
      document,
    });
    expect(await insecure.detectSupport()).toBe('camera-app');
    const missing = createBrowserCameraService({
      isSecureContext: true,
      mediaDevices: undefined,
      document,
    });
    expect(await missing.detectSupport()).toBe('camera-app');
  });
});

describe('createBrowserCameraService: start', () => {
  it('prefers the rear camera by default, without audio', async () => {
    const { service, mediaDevices } = setup();
    await service.start();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  });

  it('asks for an exact device when switching', async () => {
    const { service, mediaDevices } = setup();
    await service.start({ deviceId: 'b' });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { deviceId: { exact: 'b' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  });

  it('lists the cameras after permission and reports the active one', async () => {
    const { service, mediaDevices } = setup({
      activeDeviceId: 'front',
      devices: [
        device('videoinput', 'rear'),
        device('audioinput', 'mic'),
        device('videoinput', 'front'),
        device('videoinput', ''),
      ],
    });
    const session = await service.start();
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(1);
    expect(session.deviceIds).toEqual(['rear', 'front']);
    expect(session.deviceId).toBe('front');
  });

  it('turns a getUserMedia failure into a CameraStartError with a plain-language reason', async () => {
    const { service, mediaDevices } = setup();
    mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    const error = await service.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CameraStartError);
    expect((error as CameraStartError).cameraError.reason).toBe('denied');
  });

  it('reports unsupported when mediaDevices is missing', async () => {
    const service = createBrowserCameraService({
      isSecureContext: true,
      mediaDevices: undefined,
      document,
    });
    const error = await service.start().catch((e: unknown) => e);
    expect((error as CameraStartError).cameraError.reason).toBe('unsupported');
  });
});

describe('createBrowserCameraService: session', () => {
  async function started() {
    const ctx = setup();
    const session: CameraSession = await ctx.service.start();
    return { ...ctx, session };
  }

  it('stop() stops every track, is idempotent, and silences ended listeners', async () => {
    const { session, track } = await started();
    const ended = vi.fn();
    session.onEnded(ended);
    session.stop();
    session.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    track.fireEnded();
    expect(ended).not.toHaveBeenCalled();
  });

  it('an unexpected track end calls onEnded once', async () => {
    const { session, track } = await started();
    const ended = vi.fn();
    session.onEnded(ended);
    track.fireEnded();
    track.fireEnded();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  function video(width: number, height: number) {
    const element = document.createElement('video');
    Object.defineProperty(element, 'videoWidth', { value: width });
    Object.defineProperty(element, 'videoHeight', { value: height });
    return element;
  }

  it('snapshot() draws the frame at native size into a 0.92 JPEG', async () => {
    const { session } = await started();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback: BlobCallback) => callback(new Blob(['f'], { type: 'image/jpeg' })));
    const frame = video(1920, 1080);

    const blob = await session.snapshot(frame);

    const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 1920, 1080);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(blob.type).toBe('image/jpeg');
  });

  it('snapshot() waits for the first frame when the video has none yet', async () => {
    const { session } = await started();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback: BlobCallback) => callback(new Blob(['f'], { type: 'image/jpeg' })));
    const element = document.createElement('video');
    let width = 0;
    Object.defineProperty(element, 'videoWidth', { get: () => width });
    Object.defineProperty(element, 'videoHeight', { get: () => (width ? 480 : 0) });

    const pending = session.snapshot(element);
    width = 640;
    element.dispatchEvent(new Event('loadeddata'));

    await expect(pending).resolves.toBeInstanceOf(Blob);
    const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
  });

  it('snapshot() fails clearly when no frame arrives within 3 s or encoding fails', async () => {
    const { session } = await started();
    vi.useFakeTimers();
    try {
      const noFrame = expect(session.snapshot(video(0, 0))).rejects.toBeInstanceOf(PhotoDecodeError);
      await vi.advanceTimersByTimeAsync(3_000);
      await noFrame;
    } finally {
      vi.useRealTimers();
    }

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(null));
    await expect(session.snapshot(video(640, 480))).rejects.toBeInstanceOf(PhotoDecodeError);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(session.snapshot(video(640, 480))).rejects.toBeInstanceOf(PhotoDecodeError);
  });
});
