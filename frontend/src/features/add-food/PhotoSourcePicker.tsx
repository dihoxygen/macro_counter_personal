import type { CameraSupport } from '../../media/camera';
import type { PhotoSource } from './usePhotoSelection';

interface Props {
  /** null until detection finishes (a few milliseconds); Take photo waits for it. */
  support: CameraSupport | null;
  /** Source of the currently selected photo; its button is renamed Retake / Replace photo. */
  photoSource: PhotoSource | null;
  disabled: boolean;
  onTakePhoto: () => void;
  onChooseExisting: () => void;
}

/** The two photo sources (FR-001). Choosing what "Take photo" does is left to the parent. */
export function PhotoSourcePicker({ support, photoSource, disabled, onTakePhoto, onChooseExisting }: Props) {
  const noCamera = support === 'no-camera';
  return (
    <div className="stack">
      <div className="row photo-sources">
        <button
          type="button"
          disabled={disabled || noCamera || support === null}
          aria-describedby={noCamera ? 'no-camera-reason' : undefined}
          onClick={onTakePhoto}
        >
          {photoSource === 'camera' ? 'Retake' : 'Take photo'}
        </button>
        <button type="button" disabled={disabled} onClick={onChooseExisting}>
          {photoSource === 'library' ? 'Replace photo' : 'Choose existing photo'}
        </button>
      </div>
      {support === 'camera-app' && <p className="hint">Opens your device&apos;s camera app.</p>}
      {noCamera && (
        <p id="no-camera-reason" className="hint">
          No camera found on this device.
        </p>
      )}
    </div>
  );
}
