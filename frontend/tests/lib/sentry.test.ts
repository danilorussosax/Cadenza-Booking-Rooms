import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock di @sentry/react: catturiamo le call a init/setUser/setTag e gli
// hook beforeBreadcrumb/beforeSend (per testare il PII scrubbing senza
// inizializzare davvero il client).
const sentryMock = {
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
};

vi.mock('@sentry/react', () => sentryMock);

describe('lib/sentry · no-op senza DSN', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(sentryMock).forEach((m) => {
      if (typeof m === 'function' && 'mockClear' in m) m.mockClear();
    });
  });

  it('initSentry senza DSN ritorna false e non chiama Sentry.init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry, isSentryInitialized } = await import('@/lib/sentry');
    expect(initSentry()).toBe(false);
    expect(isSentryInitialized()).toBe(false);
    expect(sentryMock.init).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('setSentryUser è no-op se non inizializzato', async () => {
    const { setSentryUser } = await import('@/lib/sentry');
    expect(() => setSentryUser({ id: 1, role: 'studente' })).not.toThrow();
    expect(() => setSentryUser(null)).not.toThrow();
    expect(sentryMock.setUser).not.toHaveBeenCalled();
  });

  it('setSentryRequestId è no-op se non inizializzato', async () => {
    const { setSentryRequestId } = await import('@/lib/sentry');
    expect(() => setSentryRequestId('req-1')).not.toThrow();
    expect(sentryMock.setTag).not.toHaveBeenCalled();
  });
});

describe('lib/sentry · init + scrubbing PII (con DSN mockato)', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(sentryMock).forEach((m) => {
      if (typeof m === 'function' && 'mockClear' in m) m.mockClear();
    });
    vi.stubEnv('VITE_SENTRY_DSN', 'https://abc@o123.ingest.sentry.io/4567');
    vi.stubEnv('VITE_SENTRY_RELEASE', '1.2.3');
    vi.stubEnv('VITE_SENTRY_USER_ID_SALT', 'salt-xyz');
  });

  it('initSentry chiama Sentry.init con config attesa', async () => {
    const { initSentry, isSentryInitialized } = await import('@/lib/sentry');
    expect(initSentry()).toBe(true);
    expect(isSentryInitialized()).toBe(true);
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const cfg = sentryMock.init.mock.calls[0]![0];
    expect(cfg.dsn).toMatch(/sentry/);
    expect(cfg.release).toBe('1.2.3');
    expect(cfg.sendDefaultPii).toBe(false);
    expect(cfg.attachStacktrace).toBe(true);
    expect(cfg.tracesSampleRate).toBeGreaterThan(0);
    expect(typeof cfg.beforeBreadcrumb).toBe('function');
    expect(typeof cfg.beforeSend).toBe('function');
    expect(cfg.ignoreErrors).toEqual(
      expect.arrayContaining(['ResizeObserver loop limit exceeded']),
    );
    vi.unstubAllEnvs();
  });

  it('beforeBreadcrumb scrubba data sensitive', async () => {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    const cfg = sentryMock.init.mock.calls[0]![0];
    const out = cfg.beforeBreadcrumb({
      data: { password: 'segreto', token: 'xyz', notes: 'ok' },
    });
    expect(out.data.password).toBe('[REDACTED]');
    expect(out.data.token).toBe('[REDACTED]');
    expect(out.data.notes).toBe('ok');
    vi.unstubAllEnvs();
  });

  it('beforeBreadcrumb passthrough se data è assente', async () => {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    const cfg = sentryMock.init.mock.calls[0]![0];
    const bc = { message: 'click' };
    expect(cfg.beforeBreadcrumb(bc)).toEqual(bc);
    vi.unstubAllEnvs();
  });

  it('beforeSend scrubba request.data + cookies + extra', async () => {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    const cfg = sentryMock.init.mock.calls[0]![0];
    const event = {
      request: {
        data: { email: 'a@b.it', password: 'p', nested: { firstName: 'Mario' } },
        headers: { authorization: 'Bearer xyz', 'X-Custom': 'visible' },
        cookies: { session: 'abc' },
      },
      extra: { apiKey: 'secret-key', counter: 42 },
    };
    const out = cfg.beforeSend(event);
    expect(out.request.data.email).toBe('[PII]');
    expect(out.request.data.password).toBe('[REDACTED]');
    expect((out.request.data.nested as Record<string, unknown>).firstName).toBe('[PII]');
    expect(out.request.headers.authorization).toBe('[REDACTED]');
    expect(out.request.headers['X-Custom']).toBe('visible');
    expect(out.request.cookies).toEqual({ redacted: '[REDACTED]' });
    expect(out.extra.apiKey).toBe('[REDACTED]');
    expect(out.extra.counter).toBe(42);
    vi.unstubAllEnvs();
  });

  it('beforeSend passthrough se event è "vuoto"', async () => {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    const cfg = sentryMock.init.mock.calls[0]![0];
    const out = cfg.beforeSend({});
    expect(out).toEqual({});
    vi.unstubAllEnvs();
  });

  it('scrub gestisce ricorsivamente array e oggetti annidati', async () => {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
    const cfg = sentryMock.init.mock.calls[0]![0];
    const out = cfg.beforeBreadcrumb({
      data: {
        users: [
          { email: 'a@b.it', name: 'visible' },
          { firstName: 'Mario', token: 'x' },
        ],
        primitive: 'ok',
      },
    });
    expect(out.data.users[0].email).toBe('[PII]');
    expect(out.data.users[1].token).toBe('[REDACTED]');
    expect(out.data.users[1].firstName).toBe('[PII]');
    expect(out.data.primitive).toBe('ok');
    vi.unstubAllEnvs();
  });

  it('setSentryUser(null) chiama Sentry.setUser(null)', async () => {
    const { initSentry, setSentryUser } = await import('@/lib/sentry');
    initSentry();
    setSentryUser(null);
    expect(sentryMock.setUser).toHaveBeenCalledWith(null);
    vi.unstubAllEnvs();
  });

  it('setSentryUser({id,role}) hasha id e setta setUser + setTag', async () => {
    const { initSentry, setSentryUser } = await import('@/lib/sentry');
    initSentry();
    setSentryUser({ id: 42, role: 'admin' });
    // hashUserId è async: aspettiamo un tick per consumare la promise
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryMock.setUser).toHaveBeenCalled();
    const arg = sentryMock.setUser.mock.calls[0]![0];
    expect(arg.role).toBe('admin');
    expect(arg.id).toMatch(/^[0-9a-f]{16}$/);
    expect(sentryMock.setTag).toHaveBeenCalledWith('user_role', 'admin');
    vi.unstubAllEnvs();
  });

  it('setSentryRequestId chiama Sentry.setTag("request_id", id)', async () => {
    const { initSentry, setSentryRequestId } = await import('@/lib/sentry');
    initSentry();
    setSentryRequestId('req-abc');
    expect(sentryMock.setTag).toHaveBeenCalledWith('request_id', 'req-abc');
    vi.unstubAllEnvs();
  });
});
