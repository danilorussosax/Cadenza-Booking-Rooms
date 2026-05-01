'use strict';

/**
 * Unit test per lib/sanitize.js — pickAllowed + ValidationError.
 *
 * Copre:
 *   - filtraggio chiavi non in whitelist
 *   - coercizione tipi (string, integer, float, boolean, date, enum, json)
 *   - vincoli (maxLength, min, max, nullable)
 *   - throw ValidationError su tipo invalido
 */

// vitest globals abilitati in vitest.config.js
const { pickAllowed, ValidationError } = require('../../lib/sanitize');

describe('pickAllowed — modalità lista chiavi', () => {
  it('filtra chiavi non whitelistate', () => {
    const out = pickAllowed({ name: 'Mario', secret: 'h4ck', deletedAt: '2099-01-01' }, ['name']);
    expect(out).toEqual({ name: 'Mario' });
  });

  it('preserva null/undefined senza coerce', () => {
    const out = pickAllowed({ a: null, b: undefined, c: 'x' }, ['a', 'b', 'c']);
    expect(out).toEqual({ a: null, c: 'x' });
  });

  it('body non-object → empty', () => {
    expect(pickAllowed(null, ['a'])).toEqual({});
    expect(pickAllowed(undefined, ['a'])).toEqual({});
    expect(pickAllowed('string', ['a'])).toEqual({});
  });
});

describe('pickAllowed — modalità spec con coerce', () => {
  it('string: limita maxLength e rifiuta non-string', () => {
    const out = pickAllowed(
      { name: 'a'.repeat(200) },
      { name: { type: 'string', maxLength: 100 } },
    );
    expect(out.name).toHaveLength(100);

    expect(() => pickAllowed({ name: 42 }, { name: 'string' })).toThrow(ValidationError);
  });

  it('integer: coerce string → number, rifiuta non-int', () => {
    expect(pickAllowed({ x: '42' }, { x: 'integer' })).toEqual({ x: 42 });
    expect(() => pickAllowed({ x: 'abc' }, { x: 'integer' })).toThrow(ValidationError);
    expect(() => pickAllowed({ x: 1.5 }, { x: 'integer' })).toThrow(ValidationError);
  });

  it('integer: enforce min/max', () => {
    expect(() => pickAllowed({ x: -1 }, { x: { type: 'integer', min: 0 } })).toThrow(/minimo 0/);
    expect(() => pickAllowed({ x: 1500 }, { x: { type: 'integer', max: 1000 } })).toThrow(
      /massimo 1000/,
    );
  });

  it('boolean: accetta "true"/"false" string e bool, rifiuta altri', () => {
    expect(pickAllowed({ x: true }, { x: 'boolean' })).toEqual({ x: true });
    expect(pickAllowed({ x: 'true' }, { x: 'boolean' })).toEqual({ x: true });
    expect(pickAllowed({ x: 'false' }, { x: 'boolean' })).toEqual({ x: false });
    expect(() => pickAllowed({ x: 1 }, { x: 'boolean' })).toThrow(ValidationError);
    expect(() => pickAllowed({ x: 'yes' }, { x: 'boolean' })).toThrow(ValidationError);
  });

  it('enum: accetta solo valori whitelistati', () => {
    const spec = { role: { type: 'enum', values: ['admin', 'docente', 'studente'] } };
    expect(pickAllowed({ role: 'admin' }, spec)).toEqual({ role: 'admin' });
    expect(() => pickAllowed({ role: 'superadmin' }, spec)).toThrow(/non valido/);
    expect(() => pickAllowed({ role: 'admin OR 1=1' }, spec)).toThrow(ValidationError);
  });

  it('nullable: null consentito solo se nullable=true', () => {
    expect(pickAllowed({ a: null }, { a: 'string' })).toEqual({}); // skip
    expect(pickAllowed({ a: null }, { a: { type: 'string', nullable: true } })).toEqual({
      a: null,
    });
  });

  it('chiavi non in spec scartate silenziosamente', () => {
    const out = pickAllowed(
      { name: 'Mario', deletedAt: '2099', __proto__: { hack: 1 } },
      { name: 'string' },
    );
    expect(out).toEqual({ name: 'Mario' });
    expect(out.deletedAt).toBeUndefined();
  });

  it('campi assenti non finiscono nel risultato', () => {
    const out = pickAllowed({}, { name: 'string', age: 'integer' });
    expect(out).toEqual({});
  });

  it('date: accetta ISO string e Date', () => {
    const out = pickAllowed({ d: '2026-04-30T10:00:00Z' }, { d: 'date' });
    expect(out.d).toBeInstanceOf(Date);
    expect(() => pickAllowed({ d: 'not-a-date' }, { d: 'date' })).toThrow(ValidationError);
  });

  it('ValidationError espone status, code, field', () => {
    try {
      pickAllowed({ x: 'oops' }, { x: 'integer' });
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.status).toBe(400);
      expect(e.code).toBe('INVALID_TYPE');
      expect(e.field).toBe('x');
    }
  });
});

describe('pickAllowed — anti mass-assignment', () => {
  it('blocca tentativi di iniezione su campi sensibili tipici', () => {
    // Scenario reale: attaccante tenta di modificare role/passwordHash
    // tramite PUT /users/:id. La whitelist deve eliminarli silenziosamente.
    const malicious = {
      firstName: 'Mario',
      role: 'admin', // sì, è in whitelist (caso legittimo admin)
      passwordHash: '$2b$12$injectedhash',
      tokenVersion: 9999,
      twoFaSecretEncrypted: 'x',
      deletedAt: '2099-01-01',
      isActive: true,
    };
    const out = pickAllowed(malicious, {
      firstName: 'string',
      isActive: 'boolean',
      // role NON è in whitelist in questo scenario
    });
    expect(out).toEqual({ firstName: 'Mario', isActive: true });
    expect(out.role).toBeUndefined();
    expect(out.passwordHash).toBeUndefined();
    expect(out.tokenVersion).toBeUndefined();
    expect(out.deletedAt).toBeUndefined();
  });
});
