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

  it('groupRecurrences: rileva serie settimanale (RRULE WEEKLY)', () => {
    const bookings = [
      fakeBooking(10, '2026-05-04T10:00:00Z', '2026-05-04T11:00:00Z'),
      fakeBooking(11, '2026-05-11T10:00:00Z', '2026-05-11T11:00:00Z'),
      fakeBooking(12, '2026-05-18T10:00:00Z', '2026-05-18T11:00:00Z'),
    ];
    const out = buildIcs(bookings);
    expect(out).toMatch(/RRULE:FREQ=WEEKLY;COUNT=3;INTERVAL=1/);
  });

  it('groupRecurrences: 2 booking con delta non-settimanale → no RRULE', () => {
    const bookings = [
      fakeBooking(20, '2026-05-04T10:00:00Z', '2026-05-04T11:00:00Z'),
      fakeBooking(21, '2026-05-09T10:00:00Z', '2026-05-09T11:00:00Z'),
    ];
    const out = buildIcs(bookings);
    expect(out).not.toMatch(/RRULE:/);
  });

  it('groupRecurrences: bucket diverso per type diverso', () => {
    const bookings = [
      { ...fakeBooking(30, '2026-05-04T10:00:00Z', '2026-05-04T11:00:00Z'), type: 'lezione' },
      {
        ...fakeBooking(31, '2026-05-11T10:00:00Z', '2026-05-11T11:00:00Z'),
        type: 'studio_individuale',
      },
    ];
    const out = buildIcs(bookings);
    expect(out).not.toMatch(/RRULE:/);
  });

  it('bookingSummary include room name + label tipo', () => {
    const out = buildIcs([fakeBooking(1, '2026-05-12T10:00:00Z', '2026-05-12T11:00:00Z')]);
    expect(out).toMatch(/Aula 1/);
    expect(out).toMatch(/Studio/);
  });

  it('bookingLocation con building + floor + room', () => {
    const bk = fakeBooking(1, '2026-05-12T10:00:00Z', '2026-05-12T11:00:00Z');
    bk.room = { id: 1, name: 'Sala A', floor: 'Piano 1', building: { id: 1, name: 'Edificio X' } };
    const out = buildIcs([bk]);
    expect(out).toMatch(/Edificio X/);
  });

  it('bookingDescription unisce purpose + notes', () => {
    const bk = fakeBooking(1, '2026-05-12T10:00:00Z', '2026-05-12T11:00:00Z');
    bk.purpose = 'Lezione di violino';
    bk.notes = 'Portare spartito';
    const out = buildIcs([bk]);
    expect(out).toMatch(/Lezione di violino/);
  });

  it('buildIcs con opts.calName custom', () => {
    const out = buildIcs([], { calName: 'Mio Calendario' });
    expect(out).toMatch(/Mio Calendario/);
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

describe('lib/withTransaction', () => {
  const { withTransaction } = require('../../lib/withTransaction');
  const { sequelize } = require('../../models');

  it('success path: ritorna il valore della callback', async () => {
    const out = await withTransaction(async () => 42);
    expect(out).toBe(42);
  });

  it('propaga gli errori non-deadlock immediatamente (no retry)', async () => {
    const boom = new Error('boom');
    await expect(
      withTransaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('rispetta opts.retries=0 → non ritenta su 40001', async () => {
    // Simuliamo manualmente l'errore 40001 mockando sequelize.transaction
    const spy = vi.spyOn(sequelize, 'transaction').mockImplementation(async () => {
      const e = new Error('serialization');
      e.parent = { code: '40001' };
      throw e;
    });
    try {
      await expect(withTransaction(async () => null, { retries: 0 })).rejects.toMatchObject({
        parent: { code: '40001' },
      });
      // Una sola chiamata: no retry
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('retry su 40001 fino a esaurimento', async () => {
    const spy = vi.spyOn(sequelize, 'transaction').mockImplementation(async () => {
      const e = new Error('serialization');
      e.original = { code: '40001' };
      throw e;
    });
    try {
      await expect(
        withTransaction(async () => null, { retries: 2, baseDelayMs: 1 }),
      ).rejects.toMatchObject({ original: { code: '40001' } });
      // 1 tentativo iniziale + 2 retry = 3
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('retry su 40001: 2° tentativo successo → ritorna risultato', async () => {
    let calls = 0;
    const spy = vi.spyOn(sequelize, 'transaction').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        const e = new Error('serialization');
        e.parent = { code: '40001' };
        throw e;
      }
      return 'ok-after-retry';
    });
    try {
      const out = await withTransaction(async () => 'noop', {
        retries: 2,
        baseDelayMs: 1,
      });
      expect(out).toBe('ok-after-retry');
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('opts.isolation custom viene passato a sequelize.transaction', async () => {
    const spy = vi.spyOn(sequelize, 'transaction').mockResolvedValue('done');
    try {
      const { Transaction } = require('sequelize');
      await withTransaction(async () => 'x', {
        isolation: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
      });
      const callArgs = spy.mock.calls[0];
      expect(callArgs[0]).toMatchObject({
        isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('services/monteOreService.iterateOccurrences', () => {
  const { iterateOccurrences } = require('../../services/monteOreService');

  function collect(iter) {
    return Array.from(iter);
  }

  it('iterazione settimanale tra due date inclusive', () => {
    // 2026-01-05 è un lunedì (dayOfWeek=1)
    const out = collect(iterateOccurrences('2026-01-05', '2026-01-26', 1, []));
    expect(out).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('rispetta dayOfWeek diverso da quello di "from"', () => {
    // from=lunedì, dayOfWeek=3 (mercoledì)
    const out = collect(iterateOccurrences('2026-01-05', '2026-01-26', 3, []));
    expect(out).toEqual(['2026-01-07', '2026-01-14', '2026-01-21']);
  });

  it('exclude esclude le date matching', () => {
    const out = collect(
      iterateOccurrences('2026-01-05', '2026-01-26', 1, ['2026-01-12', '2026-01-26']),
    );
    expect(out).toEqual(['2026-01-05', '2026-01-19']);
  });

  it('exclude tollera input non-stringa (toString slice)', () => {
    const date = new Date('2026-01-12T00:00:00Z');
    const out = collect(iterateOccurrences('2026-01-05', '2026-01-26', 1, [date.toISOString()]));
    expect(out).toContain('2026-01-05');
    expect(out).not.toContain('2026-01-12');
  });

  it('range vuoto (from > to) → nessuna occorrenza', () => {
    const out = collect(iterateOccurrences('2026-02-01', '2026-01-01', 1, []));
    expect(out).toEqual([]);
  });

  it('to identico al primo dayOfWeek match → include single', () => {
    const out = collect(iterateOccurrences('2026-01-05', '2026-01-05', 1, []));
    expect(out).toEqual(['2026-01-05']);
  });

  it('excludeDates null/undefined funziona (default [])', () => {
    const out1 = collect(iterateOccurrences('2026-01-05', '2026-01-12', 1, undefined));
    const out2 = collect(iterateOccurrences('2026-01-05', '2026-01-12', 1, null));
    expect(out1).toEqual(['2026-01-05', '2026-01-12']);
    expect(out2).toEqual(['2026-01-05', '2026-01-12']);
  });
});

describe('services/audienceMatcher', () => {
  const {
    normalizeAudience,
    audienceMatchesUser,
    audienceMatchesUserWhere,
    VALID_KINDS,
  } = require('../../services/audienceMatcher');

  describe('normalizeAudience', () => {
    it('input null/undefined → {kind:all}', () => {
      expect(normalizeAudience(null)).toEqual({ kind: 'all' });
      expect(normalizeAudience(undefined)).toEqual({ kind: 'all' });
    });

    it('input non-object → {kind:all}', () => {
      expect(normalizeAudience('all')).toEqual({ kind: 'all' });
      expect(normalizeAudience(42)).toEqual({ kind: 'all' });
    });

    it('kind sconosciuto → fallback all', () => {
      expect(normalizeAudience({ kind: 'inventato', value: 1 })).toEqual({ kind: 'all' });
    });

    it('kind=role con ruolo valido', () => {
      expect(normalizeAudience({ kind: 'role', value: 'docente' })).toEqual({
        kind: 'role',
        value: 'docente',
      });
    });

    it('kind=role con ruolo invalido → fallback all', () => {
      expect(normalizeAudience({ kind: 'role', value: 'manager' })).toEqual({ kind: 'all' });
    });

    it('kind=course con id valido', () => {
      expect(normalizeAudience({ kind: 'course', value: 42 })).toEqual({
        kind: 'course',
        value: 42,
      });
    });

    it('kind=course con id stringa-numerica', () => {
      expect(normalizeAudience({ kind: 'course', value: '7' })).toEqual({
        kind: 'course',
        value: 7,
      });
    });

    it('kind=course con id invalido → fallback all', () => {
      expect(normalizeAudience({ kind: 'course', value: -1 })).toEqual({ kind: 'all' });
      expect(normalizeAudience({ kind: 'course', value: 'abc' })).toEqual({ kind: 'all' });
      expect(normalizeAudience({ kind: 'course', value: 0 })).toEqual({ kind: 'all' });
    });

    it('kind=building con id valido', () => {
      expect(normalizeAudience({ kind: 'building', value: 3 })).toEqual({
        kind: 'building',
        value: 3,
      });
    });

    it('VALID_KINDS contiene almeno i 4 kind base', () => {
      expect(VALID_KINDS).toEqual(expect.arrayContaining(['all', 'role', 'course', 'building']));
    });
  });

  describe('audienceMatchesUser', () => {
    it('user null → false', () => {
      expect(audienceMatchesUser({ kind: 'all' }, null)).toBe(false);
    });

    it('audience=all → true per chiunque', () => {
      expect(audienceMatchesUser({ kind: 'all' }, { role: 'studente', courseId: 1 })).toBe(true);
      expect(audienceMatchesUser({ kind: 'all' }, { role: 'admin' })).toBe(true);
    });

    it('audience=role match', () => {
      expect(audienceMatchesUser({ kind: 'role', value: 'docente' }, { role: 'docente' })).toBe(
        true,
      );
      expect(audienceMatchesUser({ kind: 'role', value: 'docente' }, { role: 'studente' })).toBe(
        false,
      );
    });

    it('audience=course match courseId', () => {
      expect(
        audienceMatchesUser({ kind: 'course', value: 5 }, { role: 'studente', courseId: 5 }),
      ).toBe(true);
      expect(
        audienceMatchesUser({ kind: 'course', value: 5 }, { role: 'studente', courseId: 7 }),
      ).toBe(false);
    });

    it('audience=building → sempre false nel feed user', () => {
      expect(audienceMatchesUser({ kind: 'building', value: 1 }, { role: 'admin' })).toBe(false);
    });
  });

  describe('audienceMatchesUserWhere', () => {
    it('audience=all → {} (tutti)', () => {
      expect(audienceMatchesUserWhere({ kind: 'all' })).toEqual({});
    });

    it('audience=role → {role: x}', () => {
      expect(audienceMatchesUserWhere({ kind: 'role', value: 'docente' })).toEqual({
        role: 'docente',
      });
    });

    it('audience=course → {courseId: x}', () => {
      expect(audienceMatchesUserWhere({ kind: 'course', value: 5 })).toEqual({ courseId: 5 });
    });

    it('audience=building → null (no destinatari email)', () => {
      expect(audienceMatchesUserWhere({ kind: 'building', value: 1 })).toBeNull();
    });

    it('audience invalida normalizza ad all → {}', () => {
      expect(audienceMatchesUserWhere(null)).toEqual({});
      expect(audienceMatchesUserWhere({ kind: 'wrong' })).toEqual({});
    });
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
