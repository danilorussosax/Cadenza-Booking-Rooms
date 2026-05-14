'use strict';

/**
 * Integrazione: scope per aula su BookingRuleException.
 *
 * Verifica che un'eccezione kind='block' con roomId valorizzato:
 *   - blocchi le prenotazioni sull'aula configurata,
 *   - lasci passare le prenotazioni sulle altre aule,
 *   - co-esista con eccezioni globali (roomId=null) senza interferenze.
 *
 * Verifica anche che findOverlappingBookings rispetti il filtro per aula.
 *
 * NOTA TZ: le finestre orarie nelle eccezioni sono interpretate in
 * Europe/Rome (vedi services/bookingValidator.js DEFAULT_TZ). Le date
 * di test vanno quindi costruite forzando il fuso istituzionale,
 * altrimenti su CI con TZ=UTC `dayjs().hour(14)` produce 14:00 UTC
 * = 16:00 CEST → finestra 14:00-16:00 esclusa e il test fallisce
 * con un off-by-2h.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Europe/Rome';

const { BookingRuleException } = require('../../models');
const { validateBooking } = require('../../services/bookingValidator');
const { findOverlappingBookings } = require('../../services/exceptionOverlapService');
const {
  createAuthedUser,
  createBookingRule,
  createCourse,
  createRoom,
  createBooking,
} = require('../factories');

describe('BookingRuleException — scope per aula', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('block scoped a una specifica aula non blocca prenotazioni su altre aule', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const targetRoom = await createRoom({ name: 'Aula Pianoforte 12' });
    const otherRoom = await createRoom({ name: 'Aula 3' });
    const { user } = await createAuthedUser({ role: 'studente', courseId: course.id });

    // Eccezione block "manutenzione tecnica" SOLO su targetRoom, lunedì 14-16
    await BookingRuleException.create({
      role: 'all',
      name: 'Manutenzione tecnica',
      kind: 'block',
      daysOfWeek: [1], // lunedì
      startTime: '14:00',
      endTime: '16:00',
      isActive: true,
      roomId: targetRoom.id,
    });

    // Lunedì future a un orario che cade nella finestra (14:30-15:30).
    // Date costruite in Europe/Rome esplicito: l'eccezione è in ora locale
    // istituzionale, e su CI con TZ=UTC `dayjs().hour(14)` produrrebbe 14 UTC.
    const nextMondayDate = dayjs().tz(TZ).add(1, 'week').day(1).format('YYYY-MM-DD');
    const start = dayjs.tz(`${nextMondayDate} 14:30`, TZ).toDate();
    const end = dayjs.tz(`${nextMondayDate} 15:30`, TZ).toDate();

    // Sull'aula target: BLOCCATA
    const onTarget = await validateBooking({
      user,
      roomId: targetRoom.id,
      startTime: start,
      endTime: end,
      type: 'studio',
    });
    expect(onTarget.valid).toBe(false);
    expect(onTarget.errors.some((e) => /Manutenzione tecnica/.test(e))).toBe(true);

    // Sull'altra aula: OK (l'eccezione non si applica)
    const onOther = await validateBooking({
      user,
      roomId: otherRoom.id,
      startTime: start,
      endTime: end,
      type: 'studio',
    });
    expect(onOther.valid).toBe(true);
  });

  it("eccezione globale (roomId=null) blocca su tutte le aule, l'eccezione scoped solo sulla sua", async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const roomA = await createRoom();
    const roomB = await createRoom();
    const { user } = await createAuthedUser({ role: 'studente', courseId: course.id });

    // Eccezione globale: martedì pomeriggio chiusura sede (13-14)
    await BookingRuleException.create({
      role: 'all',
      name: 'Pausa sede',
      kind: 'block',
      daysOfWeek: [2],
      startTime: '13:00',
      endTime: '14:00',
      isActive: true,
      roomId: null,
    });
    // Eccezione scoped roomA: martedì mattina (10-11)
    await BookingRuleException.create({
      role: 'all',
      name: 'Aula A inutilizzabile',
      kind: 'block',
      daysOfWeek: [2],
      startTime: '10:00',
      endTime: '11:00',
      isActive: true,
      roomId: roomA.id,
    });

    // Stesso pattern: date forzate in Europe/Rome così la finestra
    // dell'eccezione (13-14, 10-11 locale) viene correttamente colpita
    // anche con TZ=UTC nel processo Node.
    const nextTueDate = dayjs().tz(TZ).add(1, 'week').day(2).format('YYYY-MM-DD');
    const slot1310 = {
      startTime: dayjs.tz(`${nextTueDate} 13:15`, TZ).toDate(),
      endTime: dayjs.tz(`${nextTueDate} 13:45`, TZ).toDate(),
    };
    const slot1015 = {
      startTime: dayjs.tz(`${nextTueDate} 10:15`, TZ).toDate(),
      endTime: dayjs.tz(`${nextTueDate} 10:45`, TZ).toDate(),
    };

    // Slot 13:15-13:45 → bloccato OVUNQUE per "Pausa sede" globale
    const onA13 = await validateBooking({ user, roomId: roomA.id, type: 'studio', ...slot1310 });
    const onB13 = await validateBooking({ user, roomId: roomB.id, type: 'studio', ...slot1310 });
    expect(onA13.valid).toBe(false);
    expect(onB13.valid).toBe(false);

    // Slot 10:15-10:45 → bloccato SOLO su roomA
    const onA10 = await validateBooking({ user, roomId: roomA.id, type: 'studio', ...slot1015 });
    const onB10 = await validateBooking({ user, roomId: roomB.id, type: 'studio', ...slot1015 });
    expect(onA10.valid).toBe(false);
    expect(onA10.errors.some((e) => /Aula A inutilizzabile/.test(e))).toBe(true);
    expect(onB10.valid).toBe(true);
  });

  it('findOverlappingBookings filtra i booking per roomId quando l’eccezione è scoped', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const targetRoom = await createRoom();
    const otherRoom = await createRoom();
    const { user: studentA } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      matricola: 'A001',
    });
    const { user: studentB } = await createAuthedUser({
      role: 'studente',
      courseId: course.id,
      matricola: 'B002',
    });

    // Mercoledì future, 15:00-16:00 Europe/Rome (rientra nella finestra
    // 14-17 dell'eccezione che cercheremo).
    const nextWedDate = dayjs().tz(TZ).add(1, 'week').day(3).format('YYYY-MM-DD');
    const wedStart = dayjs.tz(`${nextWedDate} 15:00`, TZ);

    // Booking su entrambe le aule, stesso orario
    await createBooking({
      user: studentA,
      room: targetRoom,
      startTime: wedStart.toDate(),
      endTime: wedStart.add(1, 'hour').toDate(),
    });
    await createBooking({
      user: studentB,
      room: otherRoom,
      startTime: wedStart.toDate(),
      endTime: wedStart.add(1, 'hour').toDate(),
    });

    const dateFrom = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const dateTo = dayjs().add(20, 'day').format('YYYY-MM-DD');

    // Eccezione "scoped" simulata: deve trovare SOLO il booking su targetRoom
    const overlapping = await findOverlappingBookings(
      {
        role: 'all',
        kind: 'block',
        daysOfWeek: [3],
        dateFrom,
        dateTo,
        startTime: '14:00',
        endTime: '17:00',
        roomId: targetRoom.id,
      },
      { onlyFuture: true },
    );

    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].roomId).toBe(targetRoom.id);
  });
});
