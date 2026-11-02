import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useServices } from '../../app/services';
import type { CameraSupport } from '../../media/camera';
import { CameraCapture } from './CameraCapture';
import { PhotoSourcePicker } from './PhotoSourcePicker';
import type { PhotoSource, usePhotoSelection } from './usePhotoSelection';

interface Props {
  /** Owned by the composer, so the chosen photo survives switching method (FR-011). */
  selection: ReturnType<typeof usePhotoSelection>;
  note: string;
  onNoteChange: (note: string) => void;
  onSend: (jpeg: Blob, note: string | undefined) => void;
  /** True while an estimate is loading or under review. */
  disabled: boolean;
  /** False when another method is selected or Today is hidden: the live camera is then turned off. */
  active: boolean;
  onFocus?: () => void;
}

/**
 * The composer's Photo method (feature 004): an existing photo from the library or files, or a new one from the
 * camera (feature 002). The photo is re-encoded as soon as it is chosen; the estimate itself is the composer's.
 */
export function PhotoInput({ selection, note, onNoteChange, onSend, disabled, active, onFocus }: Props) {
  const services = useServices();
  const { photo } = selection;
  const [support, setSupport] = useState<CameraSupport | null>(null);
  const [missingPhoto, setMissingPhoto] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraAppInput = useRef<HTMLInputElement>(null);

  // Never keep the camera running out of sight (feature 002 FR-007): close it as soon as this is inactive.
  if (!active && cameraOpen) setCameraOpen(false);

  useEffect(() => {
    let isMounted = true;
    services.camera
      .detectSupport()
      .catch(() => 'camera-app' as const)
      .then((result) => {
        if (isMounted) setSupport(result);
      });
    return () => {
      isMounted = false;
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!photo) {
      if (selection.rejected) selection.remove(); // one message at a time
      setMissingPhoto(true);
      return;
    }
    setMissingPhoto(false);
    onSend(photo.jpeg, note.trim() || undefined);
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="Existing photo file"
        disabled={disabled}
        onChange={onFile('library')}
      />
      <input
        ref={cameraAppInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Camera app photo file"
        disabled={disabled}
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
            disabled={disabled}
            onTakePhoto={takePhoto}
            onChooseExisting={() => libraryInput.current?.click()}
          />
          {photo && (
            <div className="row">
              <button type="button" disabled={disabled} onClick={selection.remove}>
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
          onChange={(e) => onNoteChange(e.target.value)}
          onFocus={onFocus}
          disabled={disabled || cameraOpen}
        />
      </label>

      <div className="row">
        <button type="submit" className="primary" disabled={disabled || cameraOpen}>
          Estimate
        </button>
      </div>
    </form>
  );
}
