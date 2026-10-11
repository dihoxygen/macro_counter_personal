// Re-encodes a meal photo on the device before upload (research R7): resizing to Claude's
// working size and drawing through a canvas drops all EXIF/GPS metadata, so location data
// never leaves the phone (FR-015).

export const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export class PhotoDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PhotoDecodeError';
  }
}

/** Scales (w, h) so the long edge is at most maxEdge. Never upscales; keeps the aspect ratio. */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`invalid image size ${width}x${height}`);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function reencodePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // Apply the EXIF orientation while decoding, since the metadata itself is dropped.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new PhotoDecodeError('The image could not be read.', { cause: error });
  }
  try {
    const { width, height } = computeTargetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoDecodeError('The image could not be processed on this device.');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new PhotoDecodeError('The image could not be converted to JPEG.');
    return blob;
  } finally {
    bitmap.close();
  }
}
