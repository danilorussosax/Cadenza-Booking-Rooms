import { describe, it, expect, beforeEach } from 'vitest';
import { loadConsent, saveConsent, clearConsent } from '@/components/legal/cookieConsent';

describe('cookieConsent', () => {
  beforeEach(() => {
    clearConsent();
    localStorage.clear();
  });

  it('loadConsent: null prima di qualunque save', () => {
    expect(loadConsent()).toBeNull();
  });

  it('saveConsent → loadConsent ritorna le scelte', () => {
    saveConsent({ analytics: true, functional: false });
    const state = loadConsent();
    expect(state).not.toBeNull();
    expect(state?.analytics).toBe(true);
    expect(state?.functional).toBe(false);
  });

  it('clearConsent rimuove lo stato', () => {
    saveConsent({ analytics: true, functional: true });
    expect(loadConsent()).not.toBeNull();
    clearConsent();
    expect(loadConsent()).toBeNull();
  });

  it('storage corruption → loadConsent ritorna null safe', () => {
    localStorage.setItem('cadenza:cookie_consent', 'not-json{}');
    expect(loadConsent()).toBeNull();
  });
});
