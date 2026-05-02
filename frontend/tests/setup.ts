// Setup globale dei test frontend.
//
// - Estende `expect` con i matcher di @testing-library/jest-dom
//   (toBeInTheDocument, toHaveTextContent, ...).
// - Mocka window.matchMedia: alcuni componenti (theme, animazioni) lo
//   chiamano in mount; jsdom non lo implementa.

import '@testing-library/jest-dom/vitest';
import { afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as axeMatchers from 'vitest-axe/matchers';

// axe-core (via vitest-axe) — `expect(container).toHaveNoViolations()` nei
// test componente verifica le WCAG rules supportate da axe (form labels,
// landmarks, ruoli ARIA, contrasto, keyboard).
expect.extend(axeMatchers);

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
