import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  bumpVisitCount,
  getVisitCount,
  isA2hsDismissed,
  setA2hsDismissed,
  isA2hsInstalled,
  isStandalone,
  isIos,
  getDeferredPrompt,
  clearDeferredPrompt,
  setupPwa,
} from '@/lib/pwa';

describe('lib/pwa · visit count', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('bumpVisitCount: parte da 0, sale di 1 ogni call', () => {
    expect(getVisitCount()).toBe(0);
    expect(bumpVisitCount()).toBe(1);
    expect(bumpVisitCount()).toBe(2);
    expect(getVisitCount()).toBe(2);
  });

  it('getVisitCount tollera localStorage corrotto', () => {
    localStorage.setItem('cadenza:visit-count', 'not-a-number');
    expect(getVisitCount()).toBeNaN();
  });
});

describe('lib/pwa · A2HS dismissed flag', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isA2hsDismissed: false di default', () => {
    expect(isA2hsDismissed()).toBe(false);
  });

  it('setA2hsDismissed → isA2hsDismissed === true', () => {
    setA2hsDismissed();
    expect(isA2hsDismissed()).toBe(true);
  });
});

describe('lib/pwa · A2HS installed flag', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isA2hsInstalled: false di default', () => {
    expect(isA2hsInstalled()).toBe(false);
  });

  it('isA2hsInstalled: true se il flag è stato settato', () => {
    localStorage.setItem('cadenza:a2hs-installed', '1');
    expect(isA2hsInstalled()).toBe(true);
  });
});

describe('lib/pwa · environment detection', () => {
  it('isStandalone false in jsdom (matchMedia stub ritorna matches:false)', () => {
    expect(isStandalone()).toBe(false);
  });

  it('isStandalone true se matchMedia display-mode standalone match', () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(isStandalone()).toBe(true);
    window.matchMedia = original;
  });

  it('isStandalone true via navigator.standalone (iOS legacy)', () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const navStandalone = Object.getOwnPropertyDescriptor(navigator, 'standalone');
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      expect(isStandalone()).toBe(true);
    } finally {
      window.matchMedia = original;
      if (navStandalone) {
        Object.defineProperty(navigator, 'standalone', navStandalone);
      } else {
        // @ts-expect-error best-effort cleanup
        delete navigator.standalone;
      }
    }
  });

  it('isIos: rileva iPhone/iPad/iPod via userAgent', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit',
      configurable: true,
    });
    try {
      expect(isIos()).toBe(true);
    } finally {
      if (original) Object.defineProperty(navigator, 'userAgent', original);
    }
  });

  it('isIos: false su userAgent desktop non-iOS', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/100',
      configurable: true,
    });
    try {
      expect(isIos()).toBe(false);
    } finally {
      if (original) Object.defineProperty(navigator, 'userAgent', original);
    }
  });
});

describe('lib/pwa · deferred prompt', () => {
  it('getDeferredPrompt null finché beforeinstallprompt non scatta', () => {
    clearDeferredPrompt();
    expect(getDeferredPrompt()).toBeNull();
  });

  it('clearDeferredPrompt azzera lo stato', () => {
    // Setup: simula un evento beforeinstallprompt → setupPwa lo intercetta
    setupPwa();
    const evt = new Event('beforeinstallprompt') as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };
    evt.prompt = vi.fn();
    evt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(evt);
    // dopo l'evento, il prompt è stato catturato
    expect(getDeferredPrompt()).not.toBeNull();
    clearDeferredPrompt();
    expect(getDeferredPrompt()).toBeNull();
  });

  it('appinstalled scatena marker installed + svuota prompt', () => {
    localStorage.clear();
    setupPwa();
    window.dispatchEvent(new Event('appinstalled'));
    expect(isA2hsInstalled()).toBe(true);
    expect(getDeferredPrompt()).toBeNull();
  });
});

describe('lib/pwa · setupPwa', () => {
  it('no-op se window è undefined', () => {
    // Simuliamo tramite chiamata diretta: il guard interno è
    // `typeof window === 'undefined'`. In jsdom window esiste, quindi
    // verifichiamo solo che setupPwa non lanci eccezioni.
    expect(() => setupPwa()).not.toThrow();
  });

  it('registra il listener appinstalled (verificato via dispatch)', () => {
    localStorage.clear();
    setupPwa();
    expect(isA2hsInstalled()).toBe(false);
    window.dispatchEvent(new Event('appinstalled'));
    expect(isA2hsInstalled()).toBe(true);
  });
});
