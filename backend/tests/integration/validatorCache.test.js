'use strict';

/**
 * P0-4 — verifica che `createValidationCache()` riduca le query DB quando
 * validateBooking() viene chiamata N volte ravvicinate (use-case ricorrenze).
 *
 * Test: contiamo le query Sequelize emesse, con e senza cache.
 *   - SENZA cache: ogni call ricarica BookingRule, BookingQuota[], BookingRuleException[]
 *   - CON cache: vengono caricate UNA volta, poi il cache hit fa 0 query
 */

const { sequelize, BookingQuota, BookingRuleException } = require('../../models');
const { validateBooking, createValidationCache } = require('../../services/bookingValidator');
const { createAuthedUser, createBookingRule, createCourse, createRoom } = require('../factories');

describe('validateBooking — cache request-scoped (P0-4)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  /**
   * Wrapper che intercetta le query SQL emesse durante il blocco passato.
   */
  async function countQueries(fn) {
    let count = 0;
    const origLogger = sequelize.options.logging;
    sequelize.options.logging = (sql) => {
      // Filtra solo i SELECT — gli INSERT non rilevano per quote di query lette
      if (/^\s*Executed/i.test(sql) || /^\s*SELECT/i.test(sql)) {
        count += 1;
      }
    };
    try {
      await fn();
    } finally {
      sequelize.options.logging = origLogger;
    }
    return count;
  }

  it('cache riduce le query su 5 validate ravvicinate', async () => {
    const course = await createCourse();
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 240,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxActiveBookings: 100,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    // Add some quotas + exceptions to make caching meaningful
    await BookingQuota.create({
      role: 'docente',
      scopeKind: 'global',
      scopeValue: '*',
      isActive: true,
      maxHoursPerWeek: 1000,
    });
    await BookingRuleException.create({
      role: 'docente',
      kind: 'block',
      name: 'Excl1',
      isActive: true,
      dateFrom: '1900-01-01',
      dateTo: '1901-01-01',
    });

    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente', courseId: course.id });

    const baseStart = new Date('2030-09-02T14:00:00.000Z');
    const baseEnd = new Date('2030-09-02T16:00:00.000Z');

    const opts = (i) => ({
      user,
      roomId: room.id,
      startTime: new Date(baseStart.getTime() + i * 7 * 86400000),
      endTime: new Date(baseEnd.getTime() + i * 7 * 86400000),
      type: 'lezione',
    });

    // SENZA cache: 5 chiamate
    const noCache = await countQueries(async () => {
      for (let i = 0; i < 5; i++) await validateBooking(opts(i));
    });

    // CON cache condivisa
    const cache = createValidationCache();
    const withCache = await countQueries(async () => {
      for (let i = 0; i < 5; i++) await validateBooking({ ...opts(i), cache });
    });

    // Atteso: con cache facciamo strettamente meno query (Rule, Quotas,
    // Exceptions, Room caricati 1× invece di 5×).
    // Se non c'è riduzione, il cache è rotto.
    expect(withCache).toBeLessThan(noCache);
    // Sanity: la differenza deve essere significativa (almeno 8 query in meno)
    expect(noCache - withCache).toBeGreaterThanOrEqual(8);
  });

  it('cache: validate con cache produce gli stessi esiti di senza cache', async () => {
    const course = await createCourse();
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 240,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxActiveBookings: 100,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente', courseId: course.id });

    const opts = {
      user,
      roomId: room.id,
      startTime: new Date('2030-09-02T14:00:00.000Z'),
      endTime: new Date('2030-09-02T16:00:00.000Z'),
      type: 'lezione',
    };

    const noCacheRes = await validateBooking(opts);
    const cache = createValidationCache();
    const withCacheRes = await validateBooking({ ...opts, cache });

    expect(withCacheRes.valid).toBe(noCacheRes.valid);
    expect(withCacheRes.errors).toEqual(noCacheRes.errors);
  });

  it('cache: rifiuta correttamente prenotazioni invalide (no false positive)', async () => {
    const course = await createCourse();
    await createBookingRule({
      role: 'docente',
      maxBookingDurationMinutes: 60, // limite stretto
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxActiveBookings: 100,
      maxAdvanceDays: 9999,
      allowRecurring: true,
    });
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente', courseId: course.id });

    const cache = createValidationCache();

    // Prima call: 30 minuti → OK
    const ok = await validateBooking({
      user,
      roomId: room.id,
      startTime: new Date('2030-09-02T14:00:00.000Z'),
      endTime: new Date('2030-09-02T14:30:00.000Z'),
      type: 'lezione',
      cache,
    });
    expect(ok.valid).toBe(true);

    // Seconda call con la STESSA cache: 120 minuti → durata > maxBookingDurationMinutes
    const tooLong = await validateBooking({
      user,
      roomId: room.id,
      startTime: new Date('2030-09-09T14:00:00.000Z'),
      endTime: new Date('2030-09-09T16:00:00.000Z'),
      type: 'lezione',
      cache,
    });
    expect(tooLong.valid).toBe(false);
    expect(tooLong.errors.join(' ')).toMatch(/Durata massima/);
  });
});
