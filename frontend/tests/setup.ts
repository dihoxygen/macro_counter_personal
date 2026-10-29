import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no object URLs; the photo preview (feature 002) needs them. Tests may replace these.
let objectUrlCount = 0;
URL.createObjectURL ??= () => `blob:test-${++objectUrlCount}`;
URL.revokeObjectURL ??= () => {};

// jsdom has no layout, so no scrollIntoView; the composer calls it on focus (feature 004). Tests may replace it.
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
});
