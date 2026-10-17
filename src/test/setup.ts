import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no object URLs; assets are shown through them.
let nextBlob = 0;
URL.createObjectURL ??= () => `blob:test/${++nextBlob}`;
URL.revokeObjectURL ??= () => {};

afterEach(() => {
  cleanup();
});
