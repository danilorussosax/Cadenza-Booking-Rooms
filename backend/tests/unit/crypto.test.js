'use strict';

/**
 * Unit: lib/crypto (AES-256-GCM) + logica idempotente di re-encrypt della
 * migrazione di chiave (scripts/reencrypt-settings.reencryptBlob).
 */

const { encrypt, decrypt, deriveKey } = require('../../lib/crypto');
const { reencryptBlob } = require('../../scripts/reencrypt-settings');

const keyA = deriveKey('old-secret-aaaaaaaaaaaaaaaaaaaaaaaa');
const keyB = deriveKey('new-secret-bbbbbbbbbbbbbbbbbbbbbbbb');

describe('lib/crypto — encrypt/decrypt', () => {
  it('round-trip con la chiave di default', () => {
    const blob = encrypt('hello world');
    expect(blob).toBeTruthy();
    expect(decrypt(blob)).toBe('hello world');
  });

  it('round-trip con chiave esplicita', () => {
    const blob = encrypt('segreto', keyA);
    expect(decrypt(blob, keyA)).toBe('segreto');
  });

  it('decifrare con chiave diversa ritorna null (auth tag mismatch)', () => {
    const blob = encrypt('segreto', keyA);
    expect(decrypt(blob, keyB)).toBeNull();
  });

  it('input vuoto/nullo non viene cifrato', () => {
    expect(encrypt('')).toBeNull();
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });
});

describe('reencryptBlob — idempotenza migrazione chiave', () => {
  it('blob vuoto → status empty', () => {
    expect(reencryptBlob(null, keyA, keyB).status).toBe('empty');
    expect(reencryptBlob('', keyA, keyB).status).toBe('empty');
  });

  it('blob cifrato con chiave vecchia → ri-cifrato con la nuova', () => {
    const blob = encrypt('credenziale', keyA);
    const res = reencryptBlob(blob, keyA, keyB);
    expect(res.status).toBe('reencrypted');
    expect(decrypt(res.value, keyB)).toBe('credenziale');
    // il nuovo blob NON è più decifrabile con la chiave vecchia
    expect(decrypt(res.value, keyA)).toBeNull();
  });

  it('blob già cifrato con la chiave nuova → status already (skip)', () => {
    const blob = encrypt('credenziale', keyB);
    expect(reencryptBlob(blob, keyA, keyB).status).toBe('already');
  });

  it('ri-eseguire sulla stessa riga è no-op (already)', () => {
    const blob = encrypt('credenziale', keyA);
    const first = reencryptBlob(blob, keyA, keyB);
    expect(first.status).toBe('reencrypted');
    const second = reencryptBlob(first.value, keyA, keyB);
    expect(second.status).toBe('already');
  });

  it('blob non decifrabile con nessuna chiave → undecryptable (mai azzerato)', () => {
    expect(reencryptBlob('non-un-blob-valido!!!', keyA, keyB).status).toBe('undecryptable');
  });
});
