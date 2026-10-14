import { vi } from 'vitest';
import {
  CameraStartError,
  type CameraError,
  type CameraService,
  type CameraSession,
  type CameraSupport,
} from '../../src/media/camera';

/** A camera session that never touches real media; records stop() and can simulate an unplugged camera. */
export class FakeCameraSession implements CameraSession {
  readonly stream = {} as MediaStream;
  stopped = false;
  private endedListener: (() => void) | null = null;

  readonly deviceId: string;
  readonly deviceIds: readonly string[];

  constructor(deviceId: string, deviceIds: readonly string[]) {
    this.deviceId = deviceId;
    this.deviceIds = deviceIds;
  }

  snapshot = vi.fn<(video: HTMLVideoElement) => Promise<Blob>>(async () => new Blob(['frame'], { type: 'image/jpeg' }));

  stop = vi.fn(() => {
    this.stopped = true;
  });

  onEnded(listener: () => void) {
    this.endedListener = listener;
  }

  /** Simulates the camera disappearing while live. */
  endUnexpectedly() {
    if (!this.stopped) this.endedListener?.();
  }
}

export class FakeCameraService implements CameraService {
  readonly sessions: FakeCameraSession[] = [];
  private readonly support: CameraSupport;
  private readonly deviceIds: string[];
  private startError: CameraError | undefined;

  constructor(options: { support?: CameraSupport; deviceIds?: string[]; startError?: CameraError } = {}) {
    this.support = options.support ?? 'live';
    this.deviceIds = options.deviceIds ?? ['cam-rear'];
    this.startError = options.startError;
  }

  /** Makes later starts fail (or succeed again, with undefined). */
  failWith(error: CameraError | undefined) {
    this.startError = error;
  }

  detectSupport = vi.fn(async () => this.support);

  start = vi.fn(async (options?: { deviceId?: string }): Promise<CameraSession> => {
    if (this.startError) throw new CameraStartError(this.startError);
    const session = new FakeCameraSession(options?.deviceId ?? this.deviceIds[0]!, this.deviceIds);
    this.sessions.push(session);
    return session;
  });

  liveSessions() {
    return this.sessions.filter((s) => !s.stopped);
  }
}
