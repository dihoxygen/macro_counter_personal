import { describe, expect, it } from 'vitest';
import { describeCameraError, nextCameraId, supportFrom, type CameraErrorReason } from '../../../src/media/camera';

describe('supportFrom (research R3)', () => {
  const secure = { isSecureContext: true, hasGetUserMedia: true };

  it('falls back to the camera app outside a secure context', () => {
    expect(supportFrom({ ...secure, isSecureContext: false, videoInputCount: 1 })).toBe('camera-app');
  });

  it('falls back to the camera app when getUserMedia is missing', () => {
    expect(supportFrom({ ...secure, hasGetUserMedia: false, videoInputCount: 1 })).toBe('camera-app');
  });

  it('reports no camera when no video input exists', () => {
    expect(supportFrom({ ...secure, videoInputCount: 0 })).toBe('no-camera');
  });

  it.each([1, 3, null])('offers the live camera with %s video inputs', (count) => {
    expect(supportFrom({ ...secure, videoInputCount: count })).toBe('live');
  });
});

describe('describeCameraError (research R4)', () => {
  const cases: [string, unknown, CameraErrorReason, boolean, boolean, string][] = [
    [
      'NotAllowedError',
      new DOMException('x', 'NotAllowedError'),
      'denied',
      true,
      false,
      'Camera access is blocked. Allow camera access for this site in your browser settings, then try again.',
    ],
    [
      'NotFoundError',
      new DOMException('x', 'NotFoundError'),
      'no-camera',
      false,
      false,
      'No camera found on this device. You can choose an existing photo instead.',
    ],
    [
      'OverconstrainedError',
      new DOMException('x', 'OverconstrainedError'),
      'no-camera',
      false,
      false,
      'No camera found on this device. You can choose an existing photo instead.',
    ],
    [
      'NotReadableError',
      new DOMException('x', 'NotReadableError'),
      'in-use',
      true,
      false,
      'The camera is being used by another app. Close it and try again.',
    ],
    [
      'AbortError',
      new DOMException('x', 'AbortError'),
      'in-use',
      true,
      false,
      'The camera is being used by another app. Close it and try again.',
    ],
    [
      'SecurityError',
      new DOMException('x', 'SecurityError'),
      'unsupported',
      false,
      true,
      "The live camera isn't available here. You can use your device's camera app or choose an existing photo.",
    ],
    [
      'NotSupportedError',
      new DOMException('x', 'NotSupportedError'),
      'unsupported',
      false,
      true,
      "The live camera isn't available here. You can use your device's camera app or choose an existing photo.",
    ],
    [
      'TypeError',
      new TypeError('x'),
      'unsupported',
      false,
      true,
      "The live camera isn't available here. You can use your device's camera app or choose an existing photo.",
    ],
    ['disconnected', 'disconnected', 'disconnected', true, false, 'The camera was disconnected.'],
    ['an unrelated Error', new Error('boom'), 'unknown', true, false, "The camera couldn't start."],
  ];

  it.each(cases)('%s', (_name, error, reason, canRetry, offerCameraApp, message) => {
    expect(describeCameraError(error)).toEqual({ reason, canRetry, offerCameraApp, message });
  });
});

describe('nextCameraId', () => {
  it.each([
    [['a', 'b', 'c'], 'a', 'b'],
    [['a', 'b', 'c'], 'c', 'a'],
    [['a'], 'a', 'a'],
    [[], 'a', 'a'],
    [['a', 'b'], 'zzz', 'a'],
  ])('%j after %s → %s', (ids, current, expected) => {
    expect(nextCameraId(ids, current)).toBe(expected);
  });
});
