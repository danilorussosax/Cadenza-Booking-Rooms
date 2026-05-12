import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, HttpError, httpErrorMessage, tokenStore, userCache } from '@/lib/api';
// Side-effect import: inizializza i18n minimale per i test (httpErrorMessage
// usa `i18n.t(...)`. Senza init il fallback è undefined).
import '../test-utils';

describe('lib/api · tokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('get/set/clear ciclano sul token', () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set('abc');
    expect(tokenStore.get()).toBe('abc');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('clear rimuove anche userCache', () => {
    tokenStore.set('t');
    userCache.set({ id: 1 });
    tokenStore.clear();
    expect(userCache.get()).toBeNull();
  });
});

describe('lib/api · userCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('get → null se nessun valore', () => {
    expect(userCache.get()).toBeNull();
  });

  it('set + get serializza e deserializza', () => {
    userCache.set({ id: 7, role: 'admin' });
    expect(userCache.get<{ id: number; role: string }>()).toEqual({ id: 7, role: 'admin' });
  });

  it('get tollera JSON corrotto restituendo null', () => {
    localStorage.setItem('conservatory_user', '{not-json');
    expect(userCache.get()).toBeNull();
  });
});

describe('lib/api · HttpError', () => {
  it('costruisce un Error con status + payload', () => {
    const e = new HttpError(404, { error: 'Not found', code: 'NOT_FOUND' });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.payload.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Not found');
  });

  it('senza payload.error usa messaggio default', () => {
    const e = new HttpError(500, {} as never);
    expect(e.message).toMatch(/Errore HTTP 500/);
  });
});

describe('lib/api · api()', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockOk(body: unknown, status = 200) {
    fetchSpy.mockResolvedValueOnce(
      new Response(body == null ? '' : JSON.stringify(body), { status }),
    );
  }

  function mockErr(payload: unknown, status = 400) {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status }));
  }

  it('GET semplice ritorna il JSON parsato', async () => {
    mockOk({ ok: true, items: [1, 2] });
    const out = await api<{ ok: boolean; items: number[] }>('/api/x', { auth: false });
    expect(out).toEqual({ ok: true, items: [1, 2] });
  });

  it('aggiunge Authorization se auth=true e token presente', async () => {
    tokenStore.set('abc');
    mockOk({ ok: true });
    await api('/api/me');
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer abc');
  });

  it('NON aggiunge Authorization se auth=false', async () => {
    tokenStore.set('abc');
    mockOk({ ok: true });
    await api('/api/public', { auth: false });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBeNull();
  });

  it('POST con body JSON setta Content-Type e serializza', async () => {
    mockOk({ id: 1 });
    await api('/api/x', { method: 'POST', body: { a: 1 }, auth: false });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('FormData: non setta Content-Type (browser fa boundary)', async () => {
    mockOk({});
    const fd = new FormData();
    fd.append('x', '1');
    await api('/api/upload', { method: 'POST', body: fd, auth: false });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Content-Type')).toBeNull();
    expect(init?.body).toBe(fd);
  });

  it('query string costruita escludendo undefined/null/empty', async () => {
    mockOk([]);
    await api('/api/list', {
      query: { a: 1, b: 'x', c: undefined, d: null, e: '', f: true },
      auth: false,
    });
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/a=1/);
    expect(url).toMatch(/b=x/);
    expect(url).toMatch(/f=true/);
    expect(url).not.toMatch(/[?&]c=/);
    expect(url).not.toMatch(/[?&]d=/);
    expect(url).not.toMatch(/[?&]e=/);
  });

  it('risposta empty body → null', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
    const out = await api('/api/x', { auth: false });
    expect(out).toBeNull();
  });

  it('errore HTTP → throw HttpError con status e payload', async () => {
    mockErr({ error: 'Boom', code: 'BAD' }, 400);
    await expect(api('/api/x', { auth: false })).rejects.toMatchObject({
      status: 400,
      payload: { error: 'Boom', code: 'BAD' },
    });
  });

  it('401 con auth=true: pulisce token + dispatcha auth:expired', async () => {
    tokenStore.set('xxx');
    const listener = vi.fn();
    window.addEventListener('auth:expired', listener);
    mockErr({ error: 'No', code: 'TOKEN_REVOKED' }, 401);
    await expect(api('/api/me')).rejects.toBeInstanceOf(HttpError);
    expect(tokenStore.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('auth:expired', listener);
  });

  it('401 con auth=false: NON pulisce il token né dispatcha evento', async () => {
    tokenStore.set('xxx');
    const listener = vi.fn();
    window.addEventListener('auth:expired', listener);
    mockErr({ error: 'No' }, 401);
    await expect(api('/api/public', { auth: false })).rejects.toBeInstanceOf(HttpError);
    expect(tokenStore.get()).toBe('xxx');
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('auth:expired', listener);
  });

  it('risposta non-JSON viene restituita come stringa', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not-json-just-text', { status: 200 }));
    const out = await api<unknown>('/api/raw', { auth: false });
    expect(out).toBe('not-json-just-text');
  });

  it('errore senza payload JSON → fallback {error: Errore HTTP N}', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(api('/api/x', { auth: false })).rejects.toMatchObject({
      status: 500,
      payload: { error: expect.stringMatching(/Errore HTTP 500/) },
    });
  });
});

describe('lib/api · httpErrorMessage', () => {
  it('HttpError con code traducibile → testo localizzato (fallback al testo)', () => {
    const err = new HttpError(409, { error: 'Slot occupato', code: 'BOOKING_CONFLICT' });
    const msg = httpErrorMessage(err);
    // In test i18n usa parseMissingKeyHandler → ritorna la chiave letterale,
    // quindi fallback all'error testuale del backend.
    expect(msg).toBe('Slot occupato');
  });

  it('HttpError con details[] → unisce i message', () => {
    const err = new HttpError(422, {
      error: 'val',
      details: [
        { path: 'a', message: 'manca a' },
        { path: 'b', message: 'manca b' },
      ],
    });
    expect(httpErrorMessage(err)).toContain('manca a');
    expect(httpErrorMessage(err)).toContain('manca b');
  });

  it('HttpError senza code né details: usa payload.error', () => {
    const err = new HttpError(500, { error: 'BOOM' });
    expect(httpErrorMessage(err)).toBe('BOOM');
  });

  it('Error generico: usa message', () => {
    expect(httpErrorMessage(new Error('net down'))).toBe('net down');
  });

  it('input non-Error: ricorre al fallback i18n', () => {
    expect(httpErrorMessage('plain string')).toBeTypeOf('string');
    expect(httpErrorMessage(null)).toBeTypeOf('string');
  });
});
