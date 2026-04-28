// Setup globale dei test frontend.
//
// - Estende `expect` con i matcher di @testing-library/jest-dom
//   (toBeInTheDocument, toHaveTextContent, ...).
// - Mocka window.matchMedia: alcuni componenti (theme, animazioni) lo
//   chiamano in mount; jsdom non lo implementa.

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// @ts-expect-error
window.IntersectionObserver = IOStub;
// @ts-expect-error
globalThis.IntersectionObserver = IOStub;

class ROStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error
window.ResizeObserver = ROStub;
// @ts-expect-error
globalThis.ResizeObserver = ROStub;
