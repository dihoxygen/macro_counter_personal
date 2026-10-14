import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';

/** Where the photo came from: the library/files, or a camera (in-app or the device camera app). */
export type PhotoSource = 'library' | 'camera';

/** The single photo waiting to be analyzed (data-model.md). Never stored. */
export interface SelectedPhoto {
  source: PhotoSource;
  /** Already resized, upright and stripped of metadata: exactly what gets uploaded. */
  jpeg: Blob;
  previewUrl: string;
}

/**
 * Holds the Selected Photo. A photo is re-encoded as soon as it is chosen (research R6), so an
 * unreadable file is reported before anything else happens, and the preview shows what is sent.
 */
export function usePhotoSelection() {
  const services = useServices();
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [rejected, setRejected] = useState(false);
  // The URL to revoke when the photo goes away, and which selection is the latest.
  const currentUrl = useRef<string | null>(null);
  const latest = useRef(0);

  const replace = useCallback((next: SelectedPhoto | null) => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = next?.previewUrl ?? null;
    setPhoto(next);
  }, []);

  useEffect(
    () => () => {
      latest.current++;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );

  const select = useCallback(
    async (file: Blob, source: PhotoSource) => {
      const request = ++latest.current;
      setPreparing(true);
      setRejected(false);
      let jpeg: Blob;
      try {
        jpeg = await services.reencodePhoto(file);
      } catch {
        if (request !== latest.current) return;
        replace(null);
        setRejected(true);
        setPreparing(false);
        return;
      }
      if (request !== latest.current) return;
      replace({ source, jpeg, previewUrl: URL.createObjectURL(jpeg) });
      setPreparing(false);
    },
    [services, replace],
  );

  const remove = useCallback(() => {
    latest.current++;
    replace(null);
    setRejected(false);
    setPreparing(false);
  }, [replace]);

  return { photo, preparing, rejected, select, remove };
}
