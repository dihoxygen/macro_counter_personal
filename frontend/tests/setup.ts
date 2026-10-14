import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no object URLs; the photo preview (feature 002) needs them. Tests may replace these.
let objectUrlCount = 0;
URL.createObjectURL ??= () => `blob:test-${++objectUrlCount}`;
URL.revokeObjectURL ??= () => {};

afterEach(() => {
  cleanup();
});
