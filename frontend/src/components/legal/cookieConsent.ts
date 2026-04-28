// Stato del consenso ai cookie/tracker, persistito in localStorage.
//
// Categorie:
//   - necessary  : sempre attivi, non consensabili (sessione, CSRF, lingua).
//   - functional : preferenze UI (tema scuro, ecc.). Default OFF.
//   - analytics  : misurazione anonima dell'uso. Default OFF.
//
// Il banner viene rimostrato quando:
//   - non esiste alcun consenso salvato;
//   - la versione della Privacy Policy è cambiata rispetto a quella accettata.

import { PRIVACY_POLICY_VERSION } from '@/pages/legal/policyVersions';

const STORAGE_KEY = 'conservatory_cookie_consent_v1';

export type CookieCategory = 'necessary' | 'functional' | 'analytics';

export interface CookieConsentState {
  necessary: true;
  functional: boolean;
  analytics: boolean;
  policyVersion: string;
  decidedAt: string; // ISO-8601
}

export function loadConsent(): CookieConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.policyVersion !== PRIVACY_POLICY_VERSION) return null;
    return {
      necessary: true,
      functional: !!parsed.functional,
      analytics: !!parsed.analytics,
      policyVersion: parsed.policyVersion,
      decidedAt: parsed.decidedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveConsent(choice: {
  functional: boolean;
  analytics: boolean;
}): CookieConsentState {
  const state: CookieConsentState = {
    necessary: true,
    functional: choice.functional,
    analytics: choice.analytics,
    policyVersion: PRIVACY_POLICY_VERSION,
    decidedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore: storage può essere disabilitato (modalità privata, quota piena)
  }
  window.dispatchEvent(new CustomEvent('cookie-consent-changed', { detail: state }));
  return state;
}

export function clearConsent() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('cookie-consent-changed', { detail: null }));
}
