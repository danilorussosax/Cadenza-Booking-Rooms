'use strict';

const it_ = require('../../lib/institutionTime');
const { computeKioskStats, occupiedHours } = require('../../services/kioskStats');
const { audienceMatchesKiosk } = require('../../services/audienceMatcher');

// Istante di riferimento: 13/05/2026 12:00 Europe/Rome (CEST, UTC+2).
const NOW = new Date('2026-05-13T10:00:00Z');
const TODAY = '2026-05-13';

// Prenotazione con orari locali dell'istituto (HH:MM) su un giorno dato.
const bk = (start, end, extra = {}, day = TODAY, endDay = day) => ({
  id: 1,
  roomId: 1,
  type: 'studio',
  startTime: it_.atLocal(day, start),
  endTime: it_.atLocal(endDay, end),
  ...extra,
});

const byHour = (bookings) =>
  Object.fromEntries(
    computeKioskStats({ todayBookings: bookings, now: NOW }).bookingsByHour.map((b) => [
      b.hour,
      b.count,
    ]),
  );

describe('kioskStats — bookingsByHour (fasce occupate)', () => {
  it('copre le fasce 7-23', () => {
    const h = byHour([]);
    expect(Object.keys(h).map(Number)).toEqual([...Array(17).keys()].map((i) => i + 7));
  });

  it('fine a ora piena è esclusiva: 09:00-10:00 occupa solo la fascia 9', () => {
    const h = byHour([bk('09:00', '10:00')]);
    expect(h[9]).toBe(1);
    expect(h[10]).toBe(0);
  });

  it('fine a mezz’ora: 09:30-10:30 occupa le fasce 9 e 10', () => {
    const h = byHour([bk('09:30', '10:30')]);
    expect([h[9], h[10], h[11]]).toEqual([1, 1, 0]);
  });

  it('durata breve dentro un’ora: 09:00-09:20 occupa solo la fascia 9', () => {
    const h = byHour([bk('09:00', '09:20')]);
    expect([h[8], h[9], h[10]]).toEqual([0, 1, 0]);
  });

  it('più ore piene: 09:00-12:00 occupa 9, 10, 11', () => {
    const h = byHour([bk('09:00', '12:00')]);
    expect([h[8], h[9], h[10], h[11], h[12]]).toEqual([0, 1, 1, 1, 0]);
  });

  it('prenotazioni sovrapposte si sommano', () => {
    const h = byHour([bk('09:00', '10:00'), bk('09:30', '10:30')]);
    expect([h[9], h[10]]).toEqual([2, 1]);
  });

  it('a cavallo di mezzanotte: taglia a fine giornata (fino alla fascia 23)', () => {
    const h = byHour([bk('22:30', '01:00', {}, TODAY, '2026-05-14')]);
    expect([h[21], h[22], h[23]]).toEqual([0, 1, 1]);
  });

  it('iniziata ieri: parte da mezzanotte e le fasce <7 sono escluse dal payload', () => {
    const h = byHour([bk('23:00', '08:30', {}, '2026-05-12', TODAY)]);
    expect(h[7]).toBe(1);
    expect(h[8]).toBe(1);
    expect(h[9]).toBe(0);
    expect(h[6]).toBeUndefined();
  });

  it('inizio prima delle 07: conta solo le fasce visibili', () => {
    const h = byHour([bk('06:30', '07:30')]);
    expect([h[7], h[8]]).toEqual([1, 0]);
  });

  it('fine a mezzanotte esatta del giorno dopo: ultima fascia 23', () => {
    const h = byHour([bk('23:00', '00:00', {}, TODAY, '2026-05-14')]);
    expect(h[23]).toBe(1);
  });

  it('fine < inizio (dato incoerente): occupa solo la fascia di inizio', () => {
    expect(occupiedHours(bk('10:30', '09:00'), TODAY)).toEqual([10]);
    expect(occupiedHours(bk('10:00', '10:00'), TODAY)).toEqual([10]);
  });
});

describe('kioskStats — stesso payload di /stats', () => {
  const room = (id, name) => ({ id, name, building: { name: 'Sede' } });

  it('aggrega ore, aule in uso, top aule, tipi e prossimo concerto', () => {
    const today = [
      bk('11:00', '13:00', { id: 1, roomId: 1, room: room(1, 'A') }), // in corso (12:00)
      bk('15:00', '16:00', {
        id: 2,
        roomId: 2,
        type: 'concerto',
        purpose: 'Saggio',
        room: room(2, 'B'),
      }),
      bk('17:00', '18:00', { id: 3, roomId: 2, type: 'concerto', room: room(2, 'B') }),
    ];
    const week = [...today, bk('09:00', '10:00', { id: 4, roomId: 3, room: room(3, 'C') })];
    const s = computeKioskStats({
      todayBookings: today,
      weekBookings: week,
      now: NOW,
      roomsTotal: 4,
    });

    expect(s.timestamp).toBe(NOW.toISOString());
    expect(s.today).toEqual({ bookings: 3, inUse: 1, roomsTotal: 4, hours: 4, occupancyPct: 25 });
    expect(s.week).toEqual({ bookings: 4, hours: 5 });
    expect(s.topRooms.map((r) => [r.name, r.minutes, r.count])).toEqual([
      ['A', 120, 1],
      ['B', 120, 2],
      ['C', 60, 1],
    ]);
    expect(s.byType).toEqual([
      { type: 'concerto', count: 2 },
      { type: 'studio', count: 1 },
    ]);
    expect(s.nextConcert).toMatchObject({
      purpose: 'Saggio',
      room: { name: 'B', building: 'Sede' },
    });
  });

  it('senza dati: zeri e nextConcert null; occupancy 0 se roomsTotal 0', () => {
    const s = computeKioskStats({ now: NOW });
    expect(s.today).toEqual({ bookings: 0, inUse: 0, roomsTotal: 0, hours: 0, occupancyPct: 0 });
    expect(s.week).toEqual({ bookings: 0, hours: 0 });
    expect(s.nextConcert).toBeNull();
    expect(s.topRooms).toEqual([]);
  });
});

describe('audienceMatchesKiosk', () => {
  it('all e audience assente/malformata → sempre visibile (come il feed utente)', () => {
    for (const a of [
      { kind: 'all' },
      null,
      undefined,
      'x',
      { kind: 'inventato' },
      { kind: 'role', value: 'manager' },
      { kind: 'building', value: 'abc' },
    ]) {
      expect(audienceMatchesKiosk(a, { buildingId: 5 })).toBe(true);
    }
  });

  it('building: kiosk generico vede tutto, kiosk di edificio solo il proprio', () => {
    expect(audienceMatchesKiosk({ kind: 'building', value: 5 })).toBe(true);
    expect(audienceMatchesKiosk({ kind: 'building', value: 5 }, { buildingId: null })).toBe(true);
    expect(audienceMatchesKiosk({ kind: 'building', value: 5 }, { buildingId: 5 })).toBe(true);
    expect(audienceMatchesKiosk({ kind: 'building', value: '5' }, { buildingId: 5 })).toBe(true);
    expect(audienceMatchesKiosk({ kind: 'building', value: 5 }, { buildingId: 6 })).toBe(false);
    expect(audienceMatchesKiosk({ kind: 'building', value: 5 }, { buildingId: NaN })).toBe(false);
  });

  it('role e course non sono pertinenti per il kiosk', () => {
    expect(audienceMatchesKiosk({ kind: 'role', value: 'docente' })).toBe(false);
    expect(audienceMatchesKiosk({ kind: 'course', value: 3 }, { buildingId: 1 })).toBe(false);
  });
});
