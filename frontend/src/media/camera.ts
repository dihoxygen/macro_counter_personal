// The in-app live camera (feature 002, research R2–R5). This is the only module that touches
// navigator.mediaDevices; the UI reaches it through services.camera so tests can fake it.

import { PhotoDecodeError } from './reencodePhoto';

/** What "Take photo" can do on this device, decided without asking for permission (FR-008). */
export type CameraSupport = 'live' | 'no-camera' | 'camera-app';

export type CameraErrorReason = 'denied' | 'no-camera' | 'in-use' | 'unsupported' | 'disconnected' | 'unknown';

export interface CameraError {
  reason: CameraErrorReason;
  message: string;
  canRetry: boolean;
  offerCameraApp: boolean;
}

export interface CameraSession {
  readonly stream: MediaStream;
  /** The camera currently streaming. */
  readonly deviceId: string;
  /** Video inputs known after permission; two or more means "Switch camera" is offered (FR-006). */
  readonly deviceIds: readonly string[];
  /** Draws the current frame of `video` at its native size into an image/jpeg Blob. */
  snapshot(video: HTMLVideoElement): Promise<Blob>;
  /** Stops every track. Idempotent; after it, `onEnded` listeners are never called. */
  stop(): void;
  /** Called once if a track ends unexpectedly (camera unplugged, access revoked by the OS). */
  onEnded(listener: () => void): void;
}

export interface CameraService {
  /** Never prompts for permission. */
  detectSupport(): Promise<CameraSupport>;
  /**
   * The only call that may prompt. Rejects with CameraStartError.
   * - `deviceId`: exactly this camera (Switch camera).
   * - `preferredDeviceId`: exactly this camera if it still exists, otherwise the default one (the
   *   remembered camera, so a virtual camera listed first doesn't win on desktops).
   * - neither: prefer the rear camera (phones).
   */
  start(options?: { deviceId?: string; preferredDeviceId?: string }): Promise<CameraSession>;
}

export class CameraStartError extends Error {
  readonly cameraError: CameraError;

  constructor(cameraError: CameraError) {
    super(cameraError.message);
    this.cameraError = cameraError;
    this.name = 'CameraStartError';
  }
}

export function supportFrom(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  /** null when the device list is unavailable; the live camera is then tried optimistically. */
  videoInputCount: number | null;
}): CameraSupport {
  if (!env.isSecureContext || !env.hasGetUserMedia) return 'camera-app';
  return env.videoInputCount === 0 ? 'no-camera' : 'live';
}

const errors: Record<CameraErrorReason, Omit<CameraError, 'reason'>> = {
  denied: {
    message: 'Camera access is blocked. Allow camera access for this site in your browser settings, then try again.',
    canRetry: true,
    offerCameraApp: false,
  },
  'no-camera': {
    message: 'No camera found on this device. You can choose an existing photo instead.',
    canRetry: false,
    offerCameraApp: false,
  },
  'in-use': {
    message: 'The camera is being used by another app. Close it and try again.',
    canRetry: true,
    offerCameraApp: false,
  },
  unsupported: {
    message: "The live camera isn't available here. You can use your device's camera app or choose an existing photo.",
    canRetry: false,
    offerCameraApp: true,
  },
  disconnected: { message: 'The camera was disconnected.', canRetry: true, offerCameraApp: false },
  unknown: { message: "The camera couldn't start.", canRetry: true, offerCameraApp: false },
};

const reasonByName: Record<string, CameraErrorReason> = {
  NotAllowedError: 'denied',
  NotFoundError: 'no-camera',
  OverconstrainedError: 'no-camera',
  NotReadableError: 'in-use',
  AbortError: 'in-use',
  SecurityError: 'unsupported',
  NotSupportedError: 'unsupported',
  TypeError: 'unsupported',
};

/** Maps any camera failure to a fixed, plain-language reason (FR-009). `'disconnected'` is the track-ended sentinel. */
export function describeCameraError(error: unknown): CameraError {
  // DOMException isn't an Error subclass in every environment, so match on `name` alone.
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  const reason: CameraErrorReason =
    error === 'disconnected' ? 'disconnected' : Object.hasOwn(reasonByName, name) ? reasonByName[name]! : 'unknown';
  return { reason, ...errors[reason] };
}

/** The camera after `current`, wrapping around; `current` itself when there is nothing to switch to. */
export function nextCameraId(ids: readonly string[], current: string): string {
  if (ids.length < 2) return current;
  return ids[(ids.indexOf(current) + 1) % ids.length]!;
}

type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;

const SNAPSHOT_QUALITY = 0.92;
const FIRST_FRAME_TIMEOUT_MS = 3_000;

/** Resolves once the video has a frame (or gives up after a few seconds; the caller re-checks). */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      resolve();
    };
    const timer = setTimeout(done, FIRST_FRAME_TIMEOUT_MS);
    video.addEventListener('loadeddata', done);
  });
}
const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };

/** True when a requested camera no longer exists (unplugged, or its ID changed). */
function isMissingCamera(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  return name === 'OverconstrainedError' || name === 'NotFoundError';
}

/** The real camera, built from injected browser objects so it can be unit tested. */
export function createBrowserCameraService(env: {
  isSecureContext: boolean;
  mediaDevices: MediaDevicesLike | undefined;
  document: Document;
}): CameraService {
  const { mediaDevices } = env;

  const videoInputIds = async (): Promise<string[] | null> => {
    try {
      const devices = await mediaDevices!.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId);
    } catch {
      return null;
    }
  };

  return {
    async detectSupport() {
      const hasGetUserMedia = typeof mediaDevices?.getUserMedia === 'function';
      const ids = env.isSecureContext && hasGetUserMedia ? await videoInputIds() : null;
      return supportFrom({
        isSecureContext: env.isSecureContext,
        hasGetUserMedia,
        videoInputCount: ids?.length ?? null,
      });
    },

    async start(options) {
      if (typeof mediaDevices?.getUserMedia !== 'function') {
        throw new CameraStartError(describeCameraError(new TypeError('getUserMedia is unavailable')));
      }
      const open = (video: MediaTrackConstraints) => mediaDevices.getUserMedia({ audio: false, video });
      const byDefault: MediaTrackConstraints = { facingMode: { ideal: 'environment' }, ...size };
      let stream: MediaStream;
      try {
        if (options?.deviceId) {
          stream = await open({ deviceId: { exact: options.deviceId }, ...size });
        } else if (options?.preferredDeviceId) {
          // Requested exactly: Chrome may ignore `ideal` and pick a virtual camera that matches the
          // resolution better. If the remembered camera is gone, use the default one instead.
          try {
            stream = await open({ deviceId: { exact: options.preferredDeviceId }, ...size });
          } catch (error) {
            if (!isMissingCamera(error)) throw error;
            stream = await open(byDefault);
          }
        } else {
          stream = await open(byDefault);
        }
      } catch (error) {
        throw new CameraStartError(describeCameraError(error));
      }
      // Device IDs are only meaningful once permission has been granted.
      const deviceIds = ((await videoInputIds()) ?? []).filter((id) => id !== '');
      return browserSession(stream, deviceIds, env.document);
    },
  };
}

function browserSession(stream: MediaStream, deviceIds: string[], document: Document): CameraSession {
  let stopped = false;
  let endedListener: (() => void) | null = null;
  const tracks = stream.getTracks();
  for (const track of tracks) {
    track.addEventListener('ended', () => {
      if (stopped) return;
      const listener = endedListener;
      endedListener = null; // at most once
      listener?.();
    });
  }
  return {
    stream,
    deviceId: stream.getVideoTracks()[0]?.getSettings().deviceId ?? '',
    deviceIds,
    async snapshot(video) {
      if (!video.videoWidth || !video.videoHeight) await firstFrame(video);
      const { videoWidth: width, videoHeight: height } = video;
      if (!width || !height) throw new PhotoDecodeError('The camera has no picture yet.');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new PhotoDecodeError('The photo could not be processed on this device.');
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SNAPSHOT_QUALITY));
      if (!blob) throw new PhotoDecodeError('The photo could not be converted to JPEG.');
      return blob;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      endedListener = null;
      for (const track of tracks) track.stop();
    },
    onEnded(listener) {
      endedListener = listener;
    },
  };
}

/** The browser's camera. Created on first use so merely importing this module never touches media APIs. */
export function browserCameraService(): CameraService {
  return createBrowserCameraService({
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices as MediaDevices | undefined,
    document,
  });
}
