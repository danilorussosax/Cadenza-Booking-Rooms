'use strict';

/**
 * Unit test puri su services/twoFa.js (no DB, no network).
 *
 * Copre:
 *   - generateCode: formato 6 cifre, sempre stringa, range [000000, 999999]
 *   - createChallenge: shape { code, record } con hash + expiresAt + attempts:0 + purpose
 *   - consumeChallenge: tutti i branch (null stored, expired, max attempts,
 *     formato invalido, codice errato che incrementa attempts e che porta a
 *     TOO_MANY_ATTEMPTS, codice corretto)
 *   - generateRecoveryCodes: 10 codici, formato XXXX-XXXX-XXXX-XXXX uppercase
 *   - hashRecoveryCodes + findRecoveryMatch: round-trip + miss + clean (trim/upper)
 *   - maskEmail: vari edge case (vuoto, no @, locale corto)
 *   - signPre2faToken / verifyPre2faToken: round-trip + tfa diverso
 */

const jwt = require('jsonwebtoken');
const twoFa = require('../../services/twoFa');
const { getJwtSecret } = require('../../lib/secrets');

describe('twoFa.generateCode', () => {
  it('ritorna stringa di 6 cifre numeriche', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = twoFa.generateCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('zero-padding su valori bassi (es. 42 → "000042")', () => {
    // Sample stocastico: cerchiamo almeno un codice < 100000 che abbia
    // padding. Il test e non-deterministico per essenza: con 5000 iterate
    // la probabilita che NESSUNO sia < 100000 e' 0.9^5000 ≈ 0.
    let hadPaddedCode = false;
    for (let i = 0; i < 5000; i += 1) {
      const code = twoFa.generateCode();
      if (code.startsWith('0')) {
        hadPaddedCode = true;
        break;
      }
    }
    expect(hadPaddedCode).toBe(true);
  });
});

describe('twoFa.createChallenge', () => {
  it("ritorna { code, record } con record.hash, expiresAt futuro, attempts=0, purpose='enroll' di default", async () => {
    const before = Date.now();
    const out = await twoFa.createChallenge();
    expect(out.code).toMatch(/^\d{6}$/);
    expect(out.record.hash).toEqual(expect.any(String));
    expect(out.record.hash.startsWith('$2')).toBe(true); // bcrypt
    expect(out.record.attempts).toBe(0);
    expect(out.record.purpose).toBe('enroll');
    const exp = new Date(out.record.expiresAt).getTime();
    expect(exp).toBeGreaterThan(before);
    // TTL default 10 min: tolleriamo 9-11 min.
    expect(exp - before).toBeGreaterThan(9 * 60_000);
    expect(exp - before).toBeLessThan(11 * 60_000);
  });

  it('accetta purpose custom (es. "login")', async () => {
    const out = await twoFa.createChallenge('login');
    expect(out.record.purpose).toBe('login');
  });
});

describe('twoFa.consumeChallenge', () => {
  it('NO_CHALLENGE se stored e null/undefined/non-object', async () => {
    for (const stored of [null, undefined, 0, '', 'string']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await twoFa.consumeChallenge(stored, '123456');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('NO_CHALLENGE');
      expect(r.updated).toBe(null);
    }
  });

  it('EXPIRED se expiresAt nel passato', async () => {
    const { record } = await twoFa.createChallenge();
    const past = { ...record, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const r = await twoFa.consumeChallenge(past, '000000');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('EXPIRED');
    expect(r.updated).toBe(null);
  });

  it('TOO_MANY_ATTEMPTS quando stored.attempts gia >= MAX', async () => {
    const { record } = await twoFa.createChallenge();
    const maxed = { ...record, attempts: twoFa.TWO_FA_MAX_ATTEMPTS };
    const r = await twoFa.consumeChallenge(maxed, '000000');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('TOO_MANY_ATTEMPTS');
    expect(r.updated).toBe(null);
  });

  it('INVALID_FORMAT incrementa attempts ma non scarta la challenge', async () => {
    const { record } = await twoFa.createChallenge();
    for (const bad of ['', 'abc', '12345', '1234567', 'not-a-number']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await twoFa.consumeChallenge(record, bad);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('INVALID_FORMAT');
      expect(r.updated).not.toBe(null);
      expect(r.updated.attempts).toBe(1);
    }
  });

  it('BAD_CODE incrementa attempts e mantiene la challenge sotto il cap', async () => {
    const { code, record } = await twoFa.createChallenge();
    // Cerca un codice DIVERSO dall'originale.
    const wrong = code === '000000' ? '111111' : '000000';
    const r = await twoFa.consumeChallenge(record, wrong);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('BAD_CODE');
    expect(r.updated.attempts).toBe(1);
  });

  it('BAD_CODE che porta al cap → TOO_MANY_ATTEMPTS, updated=null', async () => {
    const { code, record } = await twoFa.createChallenge();
    const wrong = code === '000000' ? '111111' : '000000';
    // Pre-incrementiamo a MAX-1, cosi il prossimo tentativo errato chiude.
    const nearCap = { ...record, attempts: twoFa.TWO_FA_MAX_ATTEMPTS - 1 };
    const r = await twoFa.consumeChallenge(nearCap, wrong);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('TOO_MANY_ATTEMPTS');
    expect(r.updated).toBe(null);
  });

  it('OK con codice corretto, updated=null (challenge consumata)', async () => {
    const { code, record } = await twoFa.createChallenge();
    const r = await twoFa.consumeChallenge(record, code);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('OK');
    expect(r.updated).toBe(null);
  });

  it('accetta codice con spazi extra (cleanup interno)', async () => {
    const { code, record } = await twoFa.createChallenge();
    const r = await twoFa.consumeChallenge(record, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    expect(r.ok).toBe(true);
  });
});

describe('twoFa.generateRecoveryCodes', () => {
  it('ritorna 10 codici nel formato XXXX-XXXX-XXXX-XXXX uppercase hex', () => {
    const codes = twoFa.generateRecoveryCodes();
    expect(codes).toHaveLength(twoFa.RECOVERY_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  it('codici unici tra di loro (collision impraticabile a 80 bit)', () => {
    const codes = twoFa.generateRecoveryCodes();
    const set = new Set(codes);
    expect(set.size).toBe(codes.length);
  });
});

describe('twoFa.hashRecoveryCodes + findRecoveryMatch', () => {
  it('round-trip: hash dei codici → ritrovo l indice del match', async () => {
    const codes = twoFa.generateRecoveryCodes();
    const hashed = await twoFa.hashRecoveryCodes(codes);
    expect(hashed).toHaveLength(codes.length);
    for (let i = 0; i < codes.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const idx = await twoFa.findRecoveryMatch(codes[i], hashed);
      expect(idx).toBe(i);
    }
  });

  it('ritorna -1 se il codice non matcha nessun hash', async () => {
    const codes = twoFa.generateRecoveryCodes();
    const hashed = await twoFa.hashRecoveryCodes(codes);
    const idx = await twoFa.findRecoveryMatch('AAAA-BBBB-CCCC-DDDD-EEEE', hashed);
    expect(idx).toBe(-1);
  });

  it('ritorna -1 se plain e vuoto/null', async () => {
    const hashed = await twoFa.hashRecoveryCodes(['CODE-AAAA-BBBB-CCCC-DDDD']);
    expect(await twoFa.findRecoveryMatch('', hashed)).toBe(-1);
    expect(await twoFa.findRecoveryMatch(null, hashed)).toBe(-1);
    expect(await twoFa.findRecoveryMatch('   ', hashed)).toBe(-1);
  });

  it('cleanup: trim + uppercase prima del compare', async () => {
    const codes = ['ABCD-1234-EFAB-5678-9012'];
    const hashed = await twoFa.hashRecoveryCodes(codes);
    // Stesso codice ma lowercase + spazi.
    const idx = await twoFa.findRecoveryMatch('  abcd-1234-efab-5678-9012  ', hashed);
    expect(idx).toBe(0);
  });
});

describe('twoFa.maskEmail', () => {
  it('email standard: mostra prime 3 lettere + asterischi + dominio', () => {
    expect(twoFa.maskEmail('mario.rossi@example.it')).toBe('mar********@example.it');
  });

  it('email con locale corto (≤3 char): usa max(1, len-1) caratteri visibili', () => {
    expect(twoFa.maskEmail('a@x.it')).toBe('a*@x.it');
    expect(twoFa.maskEmail('ab@x.it')).toBe('a*@x.it');
    expect(twoFa.maskEmail('abc@x.it')).toBe('ab*@x.it');
  });

  it('ritorna stringa vuota su input invalidi', () => {
    expect(twoFa.maskEmail('')).toBe('');
    expect(twoFa.maskEmail(null)).toBe('');
    expect(twoFa.maskEmail(undefined)).toBe('');
    expect(twoFa.maskEmail('no-at-sign')).toBe('');
  });
});

describe('twoFa.signPre2faToken / verifyPre2faToken', () => {
  it('round-trip: il payload contiene { id, tfa: "pre" }', () => {
    const token = twoFa.signPre2faToken(42);
    const payload = twoFa.verifyPre2faToken(token);
    expect(payload.id).toBe(42);
    expect(payload.tfa).toBe('pre');
  });

  it('TWO_FA_BAD_TEMP_TOKEN se il token ha tfa diverso da "pre"', () => {
    // Costruiamo manualmente un JWT valido ma con claim tfa errato.
    const fakeToken = jwt.sign({ id: 1, tfa: 'full' }, getJwtSecret(), { expiresIn: '5m' });
    expect(() => twoFa.verifyPre2faToken(fakeToken)).toThrow(/Token pre2FA non valido/);
  });

  it('throw se token scaduto', async () => {
    // Forziamo un token scaduto firmando con expiresIn negativo.
    const expired = jwt.sign({ id: 1, tfa: 'pre' }, getJwtSecret(), { expiresIn: '-1s' });
    expect(() => twoFa.verifyPre2faToken(expired)).toThrow();
  });

  it('throw se token signature invalida', () => {
    const bad = jwt.sign({ id: 1, tfa: 'pre' }, 'wrong-secret', { expiresIn: '5m' });
    expect(() => twoFa.verifyPre2faToken(bad)).toThrow();
  });
});

describe('twoFa exports', () => {
  it('esporta le costanti TTL e MAX_ATTEMPTS', () => {
    expect(typeof twoFa.TWO_FA_TTL_MIN).toBe('number');
    expect(twoFa.TWO_FA_TTL_MIN).toBeGreaterThan(0);
    expect(typeof twoFa.TWO_FA_MAX_ATTEMPTS).toBe('number');
    expect(twoFa.TWO_FA_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(twoFa.RECOVERY_CODE_COUNT).toBe(10);
  });
});
