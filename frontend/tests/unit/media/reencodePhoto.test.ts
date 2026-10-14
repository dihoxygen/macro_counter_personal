import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoDecodeError, computeTargetSize, reencodePhoto } from '../../../src/media/reencodePhoto';

describe('computeTargetSize', () => {
  it.each([
    [4000, 3000, { width: 1568, height: 1176 }],
    [3000, 4000, { width: 1176, height: 1568 }],
    [1568, 1000, { width: 1568, height: 1000 }],
    [800, 600, { width: 800, height: 600 }], // never upscales
    [3137, 1000, { width: 1568, height: 500 }], // rounds to integers
    [5000, 5000, { width: 1568, height: 1568 }],
  ])('%sx%s → %o', (w, h, expected) => {
    expect(computeTargetSize(w, h)).toEqual(expected);
  });

  it('accepts a custom max edge', () => {
    expect(computeTargetSize(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });

  it('never returns a zero dimension', () => {
    expect(computeTargetSize(10000, 1)).toEqual({ width: 1568, height: 1 });
  });

  it('rejects invalid dimensions', () => {
    expect(() => computeTargetSize(0, 100)).toThrow(RangeError);
    expect(() => computeTargetSize(100, Number.NaN)).toThrow(RangeError);
  });
});

describe('reencodePhoto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
        callback(blob);
      });
    return { drawImage, toBlob };
  }

  it('decodes honoring EXIF orientation, draws at the target size and outputs a 0.85 JPEG', async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { drawImage, toBlob } = mockCanvas();
    const file = new File(['raw'], 'meal.heic', { type: 'image/heic' });

    const result = await reencodePhoto(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1568, 1176);
    const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1568, 1176]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(result.type).toBe('image/jpeg');
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('throws PhotoDecodeError when the image cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))));
    await expect(reencodePhoto(new File(['x'], 'x.jpg'))).rejects.toBeInstanceOf(PhotoDecodeError);
  });

  it('rejects a non-image file without trying to decode it (FR-012)', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    await expect(reencodePhoto(new Blob(['x'], { type: 'text/plain' }))).rejects.toBeInstanceOf(PhotoDecodeError);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('still decodes a file with no MIME type (some pickers give none)', async () => {
    const createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    mockCanvas();
    const file = new Blob(['x']);
    await reencodePhoto(file);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  });

  it('a HEIC photo the browser cannot decode becomes PhotoDecodeError', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))));
    await expect(reencodePhoto(new Blob(['x'], { type: 'image/heic' }))).rejects.toBeInstanceOf(PhotoDecodeError);
  });

  it('throws PhotoDecodeError when encoding produces nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    mockCanvas(null);
    await expect(reencodePhoto(new File(['x'], 'x.jpg'))).rejects.toBeInstanceOf(PhotoDecodeError);
  });

  it('throws PhotoDecodeError when no 2D context is available', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(reencodePhoto(new File(['x'], 'x.jpg'))).rejects.toBeInstanceOf(PhotoDecodeError);
  });
});
