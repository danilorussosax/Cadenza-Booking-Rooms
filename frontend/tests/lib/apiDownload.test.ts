import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  apiBlob,
  apiDownload,
  filenameFromContentDisposition,
  HttpError,
  httpErrorMessage,
  tokenStore,
} from '@/lib/api';
import '../test-utils';
import i18n from 'i18next';

describe('lib/api · download autenticati', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('errore 500 con code → HttpError, messaggio tradotto da httpErrorMessage', async () => {
    tokenStore.set('t');
    i18n.addResourceBundle(
      'it',
      'translation',
      { errors: { code: { EXPORT_FAILED: 'Esportazione non riuscita.' } } },
      true,
      true,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom', code: 'EXPORT_FAILED' }), { status: 500 }),
    );
    const err = await apiBlob('/api/x/export.csv').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect(httpErrorMessage(err)).toBe('Esportazione non riuscita.');
  });

  it('401: emette auth:expired e svuota il token', async () => {
    tokenStore.set('old');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'x' }), { status: 401 }),
    );
    const expired = vi.fn();
    window.addEventListener('auth:expired', expired);
    try {
      await expect(apiDownload('/api/x')).rejects.toBeInstanceOf(HttpError);
      expect(expired).toHaveBeenCalledOnce();
      expect(tokenStore.get()).toBeNull();
    } finally {
      window.removeEventListener('auth:expired', expired);
    }
  });

  it('successo: restituisce blob e nome file da Content-Disposition', async () => {
    tokenStore.set('t');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"a":1}', {
        headers: { 'Content-Disposition': 'attachment; filename="dati/export.json"' },
      }),
    );
    const { blob, filename } = await apiDownload('/api/users/me/gdpr/export');
    expect(await blob.text()).toBe('{"a":1}');
    expect(filename).toBe('dati_export.json');
  });

  it('senza Content-Disposition il nome file è null', async () => {
    tokenStore.set('t');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'));
    expect((await apiDownload('/api/x')).filename).toBeNull();
  });

  it('supporta metodo, body e query', async () => {
    tokenStore.set('t');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'));
    await apiBlob('/api/x', { method: 'POST', body: { a: 1 }, query: { q: 2, skip: undefined } });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/x?q=2');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
  });
});

describe('lib/api · filenameFromContentDisposition', () => {
  it('filename* UTF-8 percent-encoded', () => {
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''caff%C3%A8.csv")).toBe(
      'caffè.csv',
    );
  });
  it('filename senza virgolette', () => {
    expect(filenameFromContentDisposition('attachment; filename=a.csv')).toBe('a.csv');
  });
  it('assente → null', () => {
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition('inline')).toBeNull();
  });
  it('tronca a 100 caratteri', () => {
    const long = `${'a'.repeat(150)}.csv`;
    expect(filenameFromContentDisposition(`attachment; filename="${long}"`)).toHaveLength(100);
  });
});
