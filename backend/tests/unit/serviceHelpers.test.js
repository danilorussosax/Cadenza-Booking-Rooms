'use strict';

/**
 * Unit test su servizi puri/deterministici (no DB) per coverage.
 *   - templateRenderer: render variabili + condizionali
 *   - icalService: buildIcs su set realistico
 *   - structureImporter: parseCSV + rowsToObjects
 *   - quotaValidator + loanQuotaValidator: validazione payload
 *   - secrets: getJwtSecret + assertProductionSecrets
 */

describe('templateRenderer', () => {
  const { render, renderText, extractVariables } = require('../../services/templateRenderer');

  it('render sostituisce {{var}} con escape HTML default', () => {
    const out = render('Ciao {{name}}', { name: '<b>Mario</b>' });
    expect(out).toContain('&lt;b&gt;Mario&lt;/b&gt;');
  });

  it('renderText non fa escape', () => {
    const out = renderText('Ciao {{name}}', { name: '<b>Mario</b>' });
    expect(out).toBe('Ciao <b>Mario</b>');
  });

  it('render condizionale {{#if x}}...{{/if}}', () => {
    const yes = render('{{#if active}}ON{{/if}}', { active: true });
    const no = render('{{#if active}}ON{{/if}}', { active: false });
    expect(yes).toContain('ON');
    expect(no).not.toContain('ON');
  });

  it('extractVariables trova nomi variabili', () => {
    const vars = extractVariables('Ciao {{name}}, hai {{count}} prenotazioni');
    expect(vars).toContain('name');
    expect(vars).toContain('count');
  });

  it('lookup nested path con dot', () => {
    const out = renderText('{{user.firstName}}', { user: { firstName: 'Anna' } });
    expect(out).toBe('Anna');
  });
});

describe('icalService.buildIcs', () => {
  const { buildIcs } = require('../../services/icalService');

  function fakeBooking(id, startISO, endISO) {
    return {
      id,
      startTime: new Date(startISO),
      endTime: new Date(endISO),
      type: 'studio_individuale',
      purpose: 'Studio',
      status: 'confirmed',
      createdAt: new Date(),
      room: {
        id: 1,
        name: 'Aula 1',
        building: { id: 1, name: 'Sede' },
      },
    };
  }

  it('produce un buffer iCal valido per un set di booking', () => {
    const bookings = [
      fakeBooking(1, '2025-11-03T10:00:00Z', '2025-11-03T11:00:00Z'),
      fakeBooking(2, '2025-11-04T14:00:00Z', '2025-11-04T15:00:00Z'),
    ];
    const out = buildIcs(bookings);
    expect(typeof out).toBe('string');
    expect(out).toMatch(/BEGIN:VCALENDAR/);
    expect(out).toMatch(/END:VCALENDAR/);
    expect(out).toMatch(/BEGIN:VEVENT/);
  });

  it('gestisce array vuoto senza crashare', () => {
    const out = buildIcs([]);
    expect(out).toMatch(/BEGIN:VCALENDAR/);
    expect(out).toMatch(/END:VCALENDAR/);
  });

  it('emette DTSTART in UTC (suffix Z) corrispondente al timestamp originale', () => {
    // La libreria ics interpreta l'array [Y,M,D,h,m] come local-time del
    // processo Node e ri-converte in UTC. dayjs(d).hour() ritorna l'ora
    // nella stessa TZ del processo, quindi il round-trip e identita: per
    // 12:00 UTC l'output e sempre `T120000Z` indipendentemente da TZ.
    const bookings = [fakeBooking(1, '2026-05-12T12:00:00Z', '2026-05-12T13:00:00Z')];
    const out = buildIcs(bookings);
    expect(out).toMatch(/DTSTART:20260512T120000Z/);
    expect(out).toMatch(/DTEND:20260512T130000Z/);
  });
});

describe('structureImporter', () => {
  const { parseCSV, rowsToObjects, ROOM_TYPES } = require('../../services/structureImporter');

  it('parseCSV legge righe e separatore , o ;', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    const rows = parseCSV(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('parseCSV gestisce campi quotati con virgole', () => {
    const csv = 'a,b\n"Roma, IT","x"';
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe('Roma, IT');
  });

  it('rowsToObjects mappa header → record', () => {
    const matrix = [
      ['nome', 'codice'],
      ['Aula 1', 'A1'],
    ];
    const out = rowsToObjects(matrix);
    expect(out.headers).toBeDefined();
    expect(out.data.length).toBe(1);
    // Le chiavi specifiche dipendono da HEADER_MAP; verifichiamo solo presenza
    expect(out.data[0]).toHaveProperty('_line');
  });

  it('ROOM_TYPES è una lista non vuota', () => {
    expect(Array.isArray(ROOM_TYPES)).toBe(true);
    expect(ROOM_TYPES.length).toBeGreaterThan(0);
  });
});

describe('lib/secrets', () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.JWT_SECRET = original;
    delete require.cache[require.resolve('../../lib/secrets')];
  });

  it('getJwtSecret in test/dev usa fallback se mancante', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
    delete require.cache[require.resolve('../../lib/secrets')];
    const { getJwtSecret } = require('../../lib/secrets');
    expect(typeof getJwtSecret()).toBe('string');
  });

  it('getJwtSecret restituisce il valore impostato', () => {
    process.env.JWT_SECRET = 'mio-secret-test';
    delete require.cache[require.resolve('../../lib/secrets')];
    const { getJwtSecret } = require('../../lib/secrets');
    expect(getJwtSecret()).toBe('mio-secret-test');
  });

  it('assertProductionSecrets non fa nulla in non-prod', () => {
    process.env.NODE_ENV = 'test';
    delete require.cache[require.resolve('../../lib/secrets')];
    const { assertProductionSecrets } = require('../../lib/secrets');
    expect(() => assertProductionSecrets()).not.toThrow();
  });
});

describe('lib/sentry helpers', () => {
  const sentry = require('../../lib/sentry');

  it('anonymousUserId hashato deterministico', () => {
    const a = sentry.anonymousUserId(42);
    const b = sentry.anonymousUserId(42);
    const c = sentry.anonymousUserId(43);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('anonymousUserId(null) → undefined', () => {
    expect(sentry.anonymousUserId(null)).toBeUndefined();
  });

  it('scrubObject maschera campi sensibili', () => {
    const out = sentry.scrubObject({
      email: 'a@b.it',
      password: 'secret',
      nested: { token: 'abc', firstName: 'Mario' },
      ok: 'visible',
    });
    expect(out.password).toBe('[REDACTED]');
    expect(out.email).toBe('[PII]');
    expect(out.nested.token).toBe('[REDACTED]');
    expect(out.nested.firstName).toBe('[PII]');
    expect(out.ok).toBe('visible');
  });

  it('scrubEvent pulisce request.data + request.headers', () => {
    const event = {
      request: {
        data: { password: 'x', q: 'y' },
        headers: { authorization: 'Bearer a', 'x-trace': 't' },
        cookies: { session: 'a' },
      },
    };
    const out = sentry.scrubEvent(event);
    expect(out.request.data.password).toBe('[REDACTED]');
    expect(out.request.headers.authorization).toBe('[REDACTED]');
    expect(out.request.cookies).toBe('[REDACTED]');
  });

  it('isInitialized rispecchia stato (false per default in test)', () => {
    expect(typeof sentry.isInitialized()).toBe('boolean');
  });
});

describe('lib/dbErrors', () => {
  const { mapSequelizeError } = require('../../lib/dbErrors');
  it('mappa unique constraint errors', () => {
    const err = {
      name: 'SequelizeUniqueConstraintError',
      errors: [{ path: 'email', message: 'must be unique' }],
    };
    const mapped = mapSequelizeError(err);
    expect(mapped).toBeDefined();
    expect(mapped.status).toBe(409);
  });
  it('passa attraverso errori non sequelize', () => {
    const e = new Error('random');
    const out = mapSequelizeError(e);
    expect(out).toBeNull();
  });
});

describe('lib/network helpers', () => {
  const net = require('../../lib/network');

  it('è un oggetto con funzioni utility', () => {
    expect(typeof net).toBe('object');
    expect(typeof net.validateCidr).toBe('function');
    expect(typeof net.extractClientIp).toBe('function');
    expect(typeof net.isIpInCidrList).toBe('function');
    expect(typeof net.normalizeIp).toBe('function');
  });

  describe('validateCidr', () => {
    it('CIDR IPv4 valido → ok + normalized', () => {
      const r = net.validateCidr('192.168.1.0/24');
      expect(r.ok).toBe(true);
      expect(r.normalized).toMatch(/192\.168\.1\.0\/24/);
    });

    it('CIDR IPv6 valido → ok', () => {
      const r = net.validateCidr('2001:db8::/32');
      expect(r.ok).toBe(true);
      expect(r.normalized).toContain('/32');
    });

    it('senza "/" → error', () => {
      const r = net.validateCidr('192.168.1.1');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/CIDR/i);
    });

    it('input non stringa → error', () => {
      expect(net.validateCidr(null).ok).toBe(false);
      expect(net.validateCidr(42).ok).toBe(false);
      expect(net.validateCidr({}).ok).toBe(false);
    });

    it('CIDR malformato → error', () => {
      const r = net.validateCidr('999.999.999.999/24');
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });

    it('CIDR con whitespace ai bordi → trim e accetta', () => {
      const r = net.validateCidr('  10.0.0.0/8  ');
      expect(r.ok).toBe(true);
    });
  });

  describe('extractClientIp', () => {
    it('preferisce req.ip', () => {
      expect(net.extractClientIp({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    });

    it('fallback connection.remoteAddress', () => {
      expect(net.extractClientIp({ connection: { remoteAddress: '5.6.7.8' } })).toBe('5.6.7.8');
    });

    it('fallback socket.remoteAddress', () => {
      expect(net.extractClientIp({ socket: { remoteAddress: '9.9.9.9' } })).toBe('9.9.9.9');
    });

    it('niente disponibile → null', () => {
      expect(net.extractClientIp({})).toBeNull();
    });
  });

  describe('normalizeIp', () => {
    it('IPv4 mappato in IPv6 → IPv4 plain', () => {
      expect(net.normalizeIp('::ffff:192.168.1.234')).toBe('192.168.1.234');
    });

    it('IPv4 → invariato', () => {
      expect(net.normalizeIp('127.0.0.1')).toBe('127.0.0.1');
    });

    it('IPv6 puro → forma compatta', () => {
      expect(net.normalizeIp('::1')).toBe('::1');
    });

    it('null / vuoto → null', () => {
      expect(net.normalizeIp(null)).toBeNull();
      expect(net.normalizeIp('')).toBeNull();
    });

    it('input non parsabile → ritorna stringa originale', () => {
      expect(net.normalizeIp('not-an-ip')).toBe('not-an-ip');
    });
  });

  describe('isIpInCidrList', () => {
    it('IPv4 dentro range → true', () => {
      expect(net.isIpInCidrList('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
    });

    it('IPv4 fuori range → false', () => {
      expect(net.isIpInCidrList('10.0.0.1', ['192.168.1.0/24'])).toBe(false);
    });

    it('IPv4 mappato in IPv6 viene normalizzato e matchato', () => {
      expect(net.isIpInCidrList('::ffff:192.168.1.50', ['192.168.1.0/24'])).toBe(true);
    });

    it('lista vuota → false', () => {
      expect(net.isIpInCidrList('192.168.1.1', [])).toBe(false);
    });

    it('IP null/undefined → false', () => {
      expect(net.isIpInCidrList(null, ['10.0.0.0/8'])).toBe(false);
      expect(net.isIpInCidrList(undefined, ['10.0.0.0/8'])).toBe(false);
    });

    it('lista non-array → false', () => {
      expect(net.isIpInCidrList('1.2.3.4', null)).toBe(false);
      expect(net.isIpInCidrList('1.2.3.4', 'x')).toBe(false);
    });

    it('IP non parsabile → false', () => {
      expect(net.isIpInCidrList('not-an-ip', ['10.0.0.0/8'])).toBe(false);
    });

    it('CIDR malformati in lista vengono saltati silenziosamente', () => {
      expect(net.isIpInCidrList('10.0.0.5', ['malformed', '10.0.0.0/8'])).toBe(true);
    });

    it('family mismatch IPv4 ↔ IPv6 → continua (no match)', () => {
      expect(net.isIpInCidrList('10.0.0.5', ['2001:db8::/32'])).toBe(false);
      expect(net.isIpInCidrList('2001:db8::1', ['10.0.0.0/8'])).toBe(false);
    });
  });
});

describe('emailService.buildBookingContext — timezone', () => {
  // Stub minimale dei modelli per isolare buildBookingContext senza DB.
  // L'unica chiamata DB di buildBookingContext è Institute.findOne, che noi
  // mockiamo per ritornare la TZ desiderata.
  const path = require('path');
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  const origCache = { ...require.cache };

  function withMockedInstitute(timezone, fn) {
    const modelsKey = require.resolve('../../models');
    require.cache[modelsKey] = {
      id: modelsKey,
      filename: modelsKey,
      loaded: true,
      exports: {
        Institute: {
          findOne: async () => ({ name: 'Test', copyright: '', timezone }),
        },
      },
    };
    delete require.cache[require.resolve('../../services/emailService')];
    return fn(require('../../services/emailService'));
  }

  afterEach(() => {
    // Ripristina cache moduli per non sporcare altri test.
    for (const key of Object.keys(require.cache)) {
      if (!(key in origCache)) delete require.cache[key];
    }
  });

  it("formatta startTime/endTime nella TZ dell'istituto (Europe/Rome)", async () => {
    // 12:00 UTC d'estate (CEST UTC+2) → 14:00 Europe/Rome
    const booking = {
      type: 'studio_individuale',
      purpose: '',
      startTime: new Date('2026-05-12T12:00:00Z'),
      endTime: new Date('2026-05-12T13:00:00Z'),
      room: { name: 'A1', floor: '0', capacity: 8, building: { name: 'Sede' } },
    };
    const user = { firstName: 'M', lastName: 'R', email: 'm@x.it' };
    await withMockedInstitute('Europe/Rome', async (emailService) => {
      const ctx = await emailService.buildBookingContext({ user, booking });
      expect(ctx.booking.startTime).toBe('14:00');
      expect(ctx.booking.endTime).toBe('15:00');
      expect(ctx.booking.timeRange).toBe('14:00 – 15:00');
      expect(ctx.booking.duration).toBe('1h 0m');
    });
  });

  it('formatta con TZ diversa se Institute.timezone è diverso', async () => {
    const booking = {
      type: 'studio_individuale',
      purpose: '',
      startTime: new Date('2026-05-12T12:00:00Z'),
      endTime: new Date('2026-05-12T13:00:00Z'),
      room: { name: 'A1', floor: '0', capacity: 8, building: { name: 'Sede' } },
    };
    const user = { firstName: 'M', lastName: 'R', email: 'm@x.it' };
    // Honolulu è UTC-10 → 02:00
    await withMockedInstitute('Pacific/Honolulu', async (emailService) => {
      const ctx = await emailService.buildBookingContext({ user, booking });
      expect(ctx.booking.startTime).toBe('02:00');
    });
  });
});
