import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import {
  CameraStartError,
  describeCameraError,
  nextCameraId,
  type CameraError,
  type CameraService,
  type CameraSession,
} from '../../media/camera';

interface Props {
  /** A snapshot was taken; the camera is already off. */
  onCaptured: (photo: Blob) => void;
  onCancel: () => void;
  onChooseExisting: () => void;
  onUseCameraApp: () => void;
}

type StartOptions = Parameters<CameraService['start']>[0];

type View = { kind: 'starting' } | { kind: 'live' } | { kind: 'paused' } | { kind: 'error'; error: CameraError };

/**
 * The in-app live camera (US2). The camera is on only in the `live` view: it is stopped after a
 * snapshot, on cancel, on unmount and when the page is hidden (FR-007, research R5).
 */
export function CameraCapture({ onCaptured, onCancel, onChooseExisting, onUseCameraApp }: Props) {
  const { camera, devicePreferences } = useServices();
  const [view, setView] = useState<View>({ kind: 'starting' });
  const [canSwitch, setCanSwitch] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  // Bumped on every start and on stop/unmount, so a start that resolves late knows it is stale.
  const generation = useRef(0);
  // The camera to reopen on Resume / Try again: the one last streaming, else the remembered one.
  const inUse = useRef<string | null>(null);

  const stop = useCallback(() => {
    generation.current++;
    session.current?.stop();
    session.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  /** Starts a camera; the caller has already shown the `starting` view. */
  const open = useCallback(
    async (options?: StartOptions) => {
      stop();
      const mine = generation.current;
      let started: CameraSession;
      try {
        started = await camera.start(options);
      } catch (error) {
        if (mine !== generation.current) return;
        setView({
          kind: 'error',
          error: error instanceof CameraStartError ? error.cameraError : describeCameraError(error),
        });
        return;
      }
      if (mine !== generation.current) {
        started.stop(); // cancelled or unmounted while the camera was starting
        return;
      }
      session.current = started;
      if (started.deviceId) inUse.current = started.deviceId;
      started.onEnded(() => {
        if (session.current !== started) return;
        stop();
        setView({ kind: 'error', error: describeCameraError('disconnected') });
      });
      setCanSwitch(started.deviceIds.length >= 2);
      setView({ kind: 'live' });
    },
    [camera, stop],
  );

  const start = (options?: StartOptions) => {
    setView({ kind: 'starting' });
    void open(options);
  };

  const reopen = () => start(inUse.current ? { preferredDeviceId: inUse.current } : undefined);

  // On mount, start with the camera last used for a snapshot (the initial view is already
  // `starting`), so a virtual camera listed first doesn't win on desktops. Always stop on unmount.
  useEffect(() => {
    let cancelled = false;
    void devicePreferences
      .getCameraId()
      .catch(() => null)
      .then((remembered) => {
        if (cancelled) return;
        if (remembered) inUse.current = remembered;
        void open(remembered ? { preferredDeviceId: remembered } : undefined);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [devicePreferences, open, stop]);

  // Attach the stream once the <video> is rendered.
  useEffect(() => {
    if (view.kind !== 'live' || !video.current || !session.current) return;
    video.current.srcObject = session.current.stream;
    void video.current.play().catch(() => {});
  }, [view.kind]);

  // Never keep the camera on in the background; never resume on its own.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && session.current) {
        stop();
        setView({ kind: 'paused' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  const snapshot = async () => {
    const current = session.current;
    if (!current || !video.current) return;
    let photo: Blob;
    try {
      photo = await current.snapshot(video.current);
    } catch {
      stop();
      setView({ kind: 'error', error: describeCameraError(new Error('snapshot failed')) });
      return;
    }
    stop();
    if (current.deviceId) void devicePreferences.setCameraId(current.deviceId).catch(() => {});
    onCaptured(photo);
  };

  const switchCamera = () => {
    const current = session.current;
    if (!current) return;
    start({ deviceId: nextCameraId(current.deviceIds, current.deviceId) });
  };

  const cancel = () => {
    stop();
    onCancel();
  };

  const chooseExisting = () => {
    stop();
    onChooseExisting();
  };

  return (
    <div className="stack camera">
      {view.kind === 'starting' && <p role="status">Starting camera…</p>}

      {view.kind === 'live' && (
        <>
          <div className="camera-preview">
            <video ref={video} aria-label="Camera preview" autoPlay playsInline muted />
          </div>
          <div className="row camera-controls">
            <button type="button" className="primary" onClick={() => void snapshot()}>
              Take snapshot
            </button>
            {canSwitch && (
              <button type="button" onClick={switchCamera}>
                Switch camera
              </button>
            )}
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {view.kind === 'starting' && (
        <div className="row">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {view.kind === 'paused' && (
        <>
          <p role="status">Camera paused</p>
          <div className="row">
            <button type="button" onClick={reopen}>
              Resume camera
            </button>
            <button type="button" onClick={chooseExisting}>
              Choose existing photo
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {view.kind === 'error' && (
        <>
          <p role="alert" className="error">
            {view.error.message}
          </p>
          <div className="row">
            {view.error.canRetry && (
              <button type="button" onClick={reopen}>
                Try again
              </button>
            )}
            {view.error.offerCameraApp && (
              <button type="button" onClick={onUseCameraApp}>
                Use camera app
              </button>
            )}
            <button type="button" onClick={chooseExisting}>
              Choose existing photo
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
