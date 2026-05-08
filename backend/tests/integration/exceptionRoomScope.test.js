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
 */

const dayjs = require('dayjs');
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

    // Lunedì future a un orario che cade nella finestra (14:30-15:30)
    const nextMonday = dayjs().add(1, 'week').day(1).hour(14).minute(30).second(0).millisecond(0);
    const start = nextMonday.toDate();
    const end = nextMonday.add(1, 'hour').toDate();

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

    const tue = dayjs().add(1, 'week').day(2);
    const slot1310 = {
      startTime: tue.hour(13).minute(15).second(0).millisecond(0).toDate(),
      endTime: tue.hour(13).minute(45).second(0).millisecond(0).toDate(),
    };
    const slot1015 = {
      startTime: tue.hour(10).minute(15).second(0).millisecond(0).toDate(),
      endTime: tue.hour(10).minute(45).second(0).millisecond(0).toDate(),
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

    const nextWed = dayjs().add(1, 'week').day(3).hour(15).minute(0).second(0).millisecond(0);

    // Booking su entrambe le aule, stesso orario
    await createBooking({
      user: studentA,
      room: targetRoom,
      startTime: nextWed.toDate(),
      endTime: nextWed.add(1, 'hour').toDate(),
    });
    await createBooking({
      user: studentB,
      room: otherRoom,
      startTime: nextWed.toDate(),
      endTime: nextWed.add(1, 'hour').toDate(),
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
