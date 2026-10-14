import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ServicesProvider, type Services } from '../../src/app/services';
import { usePhotoSelection } from '../../src/features/add-food/usePhotoSelection';
import { PhotoDecodeError } from '../../src/media/reencodePhoto';
import { createTestServices } from './testServices';

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const raw = (name = 'meal.jpg') => new File(['raw'], name, { type: 'image/jpeg' });
const jpeg = (label = 'jpeg') => new Blob([label], { type: 'image/jpeg' });

let urlCounter = 0;
let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;

// jsdom has no object URLs; each test file runs in its own environment, so assigning is safe.
beforeEach(() => {
  urlCounter = 0;
  revoke = vi.fn<(url: string) => void>();
  URL.createObjectURL = vi.fn(() => `blob:${++urlCounter}`);
  URL.revokeObjectURL = revoke;
});

async function setup(reencodePhoto: Services['reencodePhoto']) {
  const services = await createTestServices({ reencodePhoto: vi.fn(reencodePhoto) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  const hook = renderHook(() => usePhotoSelection(), { wrapper });
  return { services, ...hook };
}

describe('usePhotoSelection', () => {
  it('re-encodes on selection, shows preparing, then exposes the JPEG and its preview URL', async () => {
    const pending = deferred<Blob>();
    const { result, services } = await setup(() => pending.promise);
    const file = raw();

    act(() => void result.current.select(file, 'library'));
    expect(result.current.preparing).toBe(true);
    expect(services.reencodePhoto).toHaveBeenCalledExactlyOnceWith(file);

    const encoded = jpeg();
    await act(async () => pending.resolve(encoded));
    expect(result.current.preparing).toBe(false);
    expect(result.current.photo).toEqual({
      source: 'library',
      jpeg: encoded,
      previewUrl: 'blob:1',
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(encoded);
  });

  it('a decode failure marks the photo rejected and releases the previous one', async () => {
    let call = 0;
    const { result } = await setup(async () => {
      if (++call === 1) return jpeg('first');
      throw new PhotoDecodeError('bad');
    });

    await act(() => result.current.select(raw('a.jpg'), 'library'));
    expect(result.current.photo?.previewUrl).toBe('blob:1');

    await act(() => result.current.select(raw('b.heic'), 'library'));
    expect(result.current.rejected).toBe(true);
    expect(result.current.photo).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('any other re-encode failure is also a rejection, never thrown to the caller', async () => {
    const { result } = await setup(async () => {
      throw new Error('canvas exploded');
    });
    await act(() => result.current.select(raw(), 'camera'));
    expect(result.current.rejected).toBe(true);
  });

  it('keeps the old photo while a replacement is preparing, then swaps and revokes the old URL', async () => {
    const second = deferred<Blob>();
    let call = 0;
    const { result } = await setup(() => (++call === 1 ? Promise.resolve(jpeg('first')) : second.promise));

    await act(() => result.current.select(raw('a.jpg'), 'camera'));
    act(() => void result.current.select(raw('b.jpg'), 'library'));
    expect(result.current.preparing).toBe(true);
    expect(result.current.photo?.previewUrl).toBe('blob:1');
    expect(revoke).not.toHaveBeenCalled();

    await act(async () => second.resolve(jpeg('second')));
    expect(result.current.photo).toMatchObject({ source: 'library', previewUrl: 'blob:2' });
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('remove() revokes the URL and clears the photo and any rejection', async () => {
    const { result } = await setup(async () => jpeg());
    await act(() => result.current.select(raw(), 'library'));
    act(() => result.current.remove());
    expect(result.current.photo).toBeNull();
    expect(result.current.rejected).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('revokes the current URL on unmount', async () => {
    const { result, unmount } = await setup(async () => jpeg());
    await act(() => result.current.select(raw(), 'library'));
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('only the latest selection wins when an earlier one finishes later', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    let call = 0;
    const { result } = await setup(() => (++call === 1 ? first.promise : second.promise));

    act(() => void result.current.select(raw('a.jpg'), 'library'));
    act(() => void result.current.select(raw('b.jpg'), 'camera'));
    await act(async () => second.resolve(jpeg('second')));
    await act(async () => first.resolve(jpeg('stale')));

    await waitFor(() => expect(result.current.preparing).toBe(false));
    expect(result.current.photo).toMatchObject({ source: 'camera', previewUrl: 'blob:1' });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
