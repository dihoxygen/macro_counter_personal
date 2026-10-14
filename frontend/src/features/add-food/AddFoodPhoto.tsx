import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import type { CameraSupport } from '../../media/camera';
import { SubmitOrProgress } from './AddFoodText';
import { CameraCapture } from './CameraCapture';
import { PhotoSourcePicker } from './PhotoSourcePicker';
import { ReviewEstimate } from './ReviewEstimate';
import { useEstimateFlow } from './useEstimateFlow';
import { usePhotoSelection, type PhotoSource } from './usePhotoSelection';

interface Props {
  onConfirmed: () => void;
  onText: () => void;
  onManual: () => void;
}

/**
 * Log a meal from a photo: an existing one from the library or files, or a new one from the camera
 * (feature 002). The photo is re-encoded on the device as soon as it is chosen, then goes through
 * the feature 001 estimate → review → confirm flow.
 */
export function AddFoodPhoto({ onConfirmed, onText, onManual }: Props) {
  const services = useServices();
  const selection = usePhotoSelection();
  const { photo } = selection;
  const [support, setSupport] = useState<CameraSupport | null>(null);
  const [note, setNote] = useState('');
  const [missingPhoto, setMissingPhoto] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraAppInput = useRef<HTMLInputElement>(null);
  const flow = useEstimateFlow(onConfirmed);
  const { phase } = flow;
  const loading = phase.kind === 'loading';

  useEffect(() => {
    let active = true;
    services.camera
      .detectSupport()
      .catch(() => 'camera-app' as const)
      .then((result) => {
        if (active) setSupport(result);
      });
    return () => {
      active = false;
    };
  }, [services]);

  const onFile = (source: PhotoSource) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // so choosing the same file again still fires change
    if (!file) return; // picker cancelled
    setCameraOpen(false); // a chosen file always replaces the camera view
    setMissingPhoto(false);
    void selection.select(file, source);
  };

  const takePhoto = () => {
    setMissingPhoto(false);
    if (support === 'live') setCameraOpen(true);
    else cameraAppInput.current?.click();
  };

  const captured = (snapshot: Blob) => {
    setCameraOpen(false);
    void selection.select(snapshot, 'camera');
  };

  /** Leave the live camera for a file input instead (from a camera error or pause). */
  const leaveCameraForLibrary = () => {
    setCameraOpen(false);
    libraryInput.current?.click();
  };
  const leaveCameraForCameraApp = () => {
    setCameraOpen(false);
    cameraAppInput.current?.click();
  };

  const estimate = () => {
    if (!photo) {
      if (selection.rejected) selection.remove(); // one message at a time
      setMissingPhoto(true);
      return;
    }
    setMissingPhoto(false);
    void flow.run((signal) => services.estimateFromPhoto(photo.jpeg, note.trim() || undefined, signal));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    estimate();
  };

  if (phase.kind === 'review') {
    return <ReviewEstimate initial={phase.state} onConfirm={flow.confirm} onDiscard={flow.reset} />;
  }

  const recovery = (
    <div className="row">
      <button type="button" onClick={estimate}>
        Retry
      </button>
      <button type="button" onClick={onText}>
        Describe in text
      </button>
      <button type="button" onClick={onManual}>
        Enter manually
      </button>
    </div>
  );

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="Existing photo file"
        disabled={loading}
        onChange={onFile('library')}
      />
      <input
        ref={cameraAppInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Camera app photo file"
        disabled={loading}
        onChange={onFile('camera')}
      />

      {cameraOpen ? (
        <CameraCapture
          onCaptured={captured}
          onCancel={() => setCameraOpen(false)}
          onChooseExisting={leaveCameraForLibrary}
          onUseCameraApp={leaveCameraForCameraApp}
        />
      ) : (
        <>
          {photo && (
            <div className="photo-preview">
              <img src={photo.previewUrl} alt="Selected photo" />
            </div>
          )}
          {selection.preparing && <p role="status">Preparing photo…</p>}
          {selection.rejected && (
            <p role="alert" className="error">
              This photo couldn&apos;t be used. Choose another photo.
            </p>
          )}

          <PhotoSourcePicker
            support={support}
            photoSource={photo?.source ?? null}
            disabled={loading}
            onTakePhoto={takePhoto}
            onChooseExisting={() => libraryInput.current?.click()}
          />
          {photo && (
            <div className="row">
              <button type="button" disabled={loading} onClick={selection.remove}>
                Remove photo
              </button>
            </div>
          )}
          {missingPhoto && (
            <p role="alert" className="error">
              Choose or take a photo first.
            </p>
          )}
        </>
      )}

      <label>
        Note (optional)
        <textarea
          rows={2}
          maxLength={300}
          value={note}
          placeholder="e.g. cooked in olive oil"
          onChange={(e) => setNote(e.target.value)}
          disabled={loading || cameraOpen}
        />
      </label>

      <SubmitOrProgress loading={loading} disabled={cameraOpen} onCancel={flow.cancel} />

      {phase.kind === 'unrecognized' && (
        <div className="warning stack">
          <span>Couldn’t identify food in this photo.</span>
          {recovery}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="stack">
          <p role="alert" className="error">
            {phase.message}
          </p>
          {recovery}
        </div>
      )}
    </form>
  );
}
