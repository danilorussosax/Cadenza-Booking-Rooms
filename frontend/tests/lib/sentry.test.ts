import { describe, it, expect, beforeEach, vi } from 'vitest';

// Sentry init richiede VITE_SENTRY_DSN: senza, è no-op (ritorna false).
// Testiamo i contratti pubblici senza inizializzare davvero Sentry.

describe('lib/sentry (no DSN → no-op)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('initSentry senza DSN ritorna false', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry, isSentryInitialized } = await import('@/lib/sentry');
    expect(initSentry()).toBe(false);
    expect(isSentryInitialized()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('setSentryUser è no-op se non inizializzato', async () => {
    const { setSentryUser } = await import('@/lib/sentry');
    expect(() => setSentryUser({ id: 1, role: 'studente' })).not.toThrow();
    expect(() => setSentryUser(null)).not.toThrow();
  });

  it('setSentryRequestId è no-op se non inizializzato', async () => {
    const { setSentryRequestId } = await import('@/lib/sentry');
    expect(() => setSentryRequestId('abc')).not.toThrow();
  });
});
