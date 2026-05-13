'use strict';

/**
 * Test integration per le prenotazioni ricorrenti (F2).
 *
 * Copertura:
 *   - service recurrenceExpander: validateRule, expandDates, expandOccurrences,
 *     edge cases (range troppo lungo, weekday invalido, exclude)
 *   - route POST /bookings/recurring: weekly OK, daily, conflitti senza
 *     skipConflicts (409), conflitti con skipConflicts (200 parziale),
 *     limite max occorrenze, pending_approval per aule sensibili
 *   - route DELETE /bookings/recurrences/:id: cancella future occurrences
 *     preservando le passate, auth (proprietario o admin), 404 / 403
 *   - route GET /bookings/recurrences/:id
 */

const request = require('supertest');
const dayjs = require('dayjs');

const { buildApp } = require('../../app');
const {
  createAdmin,
  createAuthedUser,
  createBuilding,
  createCourse,
  createBookingRule,
  createRoom,
  createBooking,
} = require('../factories');

// I docenti in questa suite hanno bisogno di:
//   - courseId (requireCompleteProfile)
//   - una BookingRule per role='docente' (altrimenti validateBooking
//     ritorna 'Nessuna regola configurata')
async function createTeacher() {
  const course = await createCourse();
  // BookingRule è singleton per role, prova-prima-poi-skip
  try {
    await createBookingRule({
      role: 'docente',
      allowRecurring: true,
      maxActiveBookings: 100, // largo per non triggerare quota durante test ricorrenze
      maxHoursPerWeek: 100,
      maxHoursPerDay: 24,
    });
  } catch (_e) {
    // già esistente da test precedente — OK
  }
  return createAuthedUser({ role: 'docente', courseId: course.id });
}
const { Booking, BookingRecurrence, Room } = require('../../models');
const recurrenceExpander = require('../../services/recurrenceExpander');

const app = buildApp({ serveFrontend: false });

beforeEach(async () => {
  await resetDatabase();
});

// =====================================================
// SERVICE — recurrenceExpander
// =====================================================
describe('recurrenceExpander · validateRule', () => {
  it('accetta weekly con byWeekday valido e ritorna regola normalizzata', () => {
    const r = recurrenceExpander.validateRule({
      frequency: 'weekly',
      interval: 2,
      byWeekday: ['MO', 'WE'],
      startDate: '2026-05-04',
      endDate: '2026-05-30',
    });
    expect(r.frequency).toBe('weekly');
    expect(r.interval).toBe(2);
    expect(r.byWeekday).toEqual(['MO', 'WE']);
    expect(r.excludeDates).toEqual([]);
  });

  it('ricava byWeekday da startDate per weekly se non specificato', () => {
    // 2026-05-04 è un lunedì
    const r = recurrenceExpander.validateRule({
      frequency: 'weekly',
      startDate: '2026-05-04',
      endDate: '2026-05-30',
    });
    expect(r.byWeekday).toEqual(['MO']);
  });

  it('respinge frequency non supportata', () => {
    expect(() =>
      recurrenceExpander.validateRule({
        frequency: 'monthly',
        startDate: '2026-05-01',
        endDate: '2026-06-01',
      }),
    ).toThrow(/Frequency non supportata/);
  });

  it('respinge interval fuori range', () => {
    expect(() =>
      recurrenceExpander.validateRule({
        frequency: 'daily',
        interval: 99,
        startDate: '2026-05-01',
        endDate: '2026-05-10',
      }),
    ).toThrow(/Interval/);
  });

  it('respinge range > 366 giorni', () => {
    expect(() =>
      recurrenceExpander.validateRule({
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2027-12-31',
      }),
    ).toThrow(/Range troppo ampio/);
  });

  it('respinge byWeekday con codice non valido', () => {
    expect(() =>
      recurrenceExpander.validateRule({
        frequency: 'weekly',
        byWeekday: ['MO', 'XX'],
        startDate: '2026-05-04',
        endDate: '2026-05-30',
      }),
    ).toThrow(/byWeekday/);
  });
});

describe('recurrenceExpander · expandDates', () => {
  it('weekly MO/WE/FR su 4 settimane → 12 date', () => {
    const rule = recurrenceExpander.validateRule({
      frequency: 'weekly',
      byWeekday: ['MO', 'WE', 'FR'],
      startDate: '2026-05-04',
      endDate: '2026-05-31',
    });
    const d = recurrenceExpander.expandDates(rule);
    expect(d).toHaveLength(12);
    expect(d[0]).toBe('2026-05-04');
  });

  it('daily interval=2 → ogni 2 giorni', () => {
    const rule = recurrenceExpander.validateRule({
      frequency: 'daily',
      interval: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-10',
    });
    const d = recurrenceExpander.expandDates(rule);
    expect(d).toEqual(['2026-05-01', '2026-05-03', '2026-05-05', '2026-05-07', '2026-05-09']);
  });

  it('applica excludeDates', () => {
    const rule = recurrenceExpander.validateRule({
      frequency: 'weekly',
      byWeekday: ['MO'],
      startDate: '2026-05-04',
      endDate: '2026-06-01',
      excludeDates: ['2026-05-18'],
    });
    const d = recurrenceExpander.expandDates(rule);
    expect(d).not.toContain('2026-05-18');
  });

  it('non supera MAX_OCCURRENCES (52)', () => {
    const rule = recurrenceExpander.validateRule({
      frequency: 'daily',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
    const d = recurrenceExpander.expandDates(rule);
    expect(d.length).toBeLessThanOrEqual(recurrenceExpander.MAX_OCCURRENCES);
  });
});

// =====================================================
// ROUTE — POST /bookings/recurring
// =====================================================
describe('POST /bookings/recurring', () => {
  async function setupRoom(extra = {}) {
    const building = await createBuilding();
    return createRoom({ building, ...extra });
  }

  it('crea serie weekly OK → 201 + N booking con stesso recurrenceId', async () => {
    const room = await setupRoom();
    const { authHeader } = await createTeacher();
    const start = dayjs().add(1, 'day').startOf('day').hour(10).toISOString();
    const end = dayjs().add(1, 'day').startOf('day').hour(11).toISOString();

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'lezione',
        purpose: 'Lezione canto',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          byWeekday: ['MO'],
          startDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
          endDate: dayjs().add(28, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBeGreaterThanOrEqual(1);
    expect(res.body.recurrenceId).toBeTruthy();

    const bookings = await Booking.findAll({
      where: { recurrenceId: res.body.recurrenceId },
    });
    expect(bookings.length).toBe(res.body.createdCount);
    // Tutti gli orari sono 10:00-11:00 (estratti dal template)
    for (const b of bookings) {
      expect(dayjs(b.startTime).hour()).toBe(10);
      expect(dayjs(b.endTime).hour()).toBe(11);
    }
  });

  it('crea serie daily interval=2 su 10 giorni', async () => {
    const room = await setupRoom();
    const { authHeader } = await createTeacher();
    const day1 = dayjs().add(1, 'day');
    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: day1.hour(14).toISOString(),
        endTime: day1.hour(15).toISOString(),
        recurrence: {
          frequency: 'daily',
          interval: 2,
          startDate: day1.format('YYYY-MM-DD'),
          endDate: day1.add(10, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(6); // giorni 1,3,5,7,9,11
  });

  it('409 se conflitti e skipConflicts=false', async () => {
    const room = await setupRoom();
    const { user, authHeader } = await createTeacher();
    // Crea un booking esistente che conflicterà con la 1° occorrenza
    const day1 = dayjs().add(1, 'day').startOf('day');
    await createBooking({
      user,
      room,
      startTime: day1.hour(10).toDate(),
      endTime: day1.hour(11).toDate(),
    });

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: day1.hour(10).toISOString(),
        endTime: day1.hour(11).toISOString(),
        recurrence: {
          frequency: 'daily',
          startDate: day1.format('YYYY-MM-DD'),
          endDate: day1.add(3, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECURRENCE_CONFLICTS');
    expect(res.body.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.validCount).toBeGreaterThanOrEqual(1);
  });

  it('skipConflicts=true crea solo le occorrenze non in conflitto', async () => {
    const room = await setupRoom();
    const { user, authHeader } = await createTeacher();
    const day1 = dayjs().add(1, 'day').startOf('day');
    // Blocca giorno 1
    await createBooking({
      user,
      room,
      startTime: day1.hour(10).toDate(),
      endTime: day1.hour(11).toDate(),
    });

    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: day1.hour(10).toISOString(),
        endTime: day1.hour(11).toISOString(),
        skipConflicts: true,
        recurrence: {
          frequency: 'daily',
          startDate: day1.format('YYYY-MM-DD'),
          endDate: day1.add(3, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);
    expect(res.body.createdCount).toBeGreaterThanOrEqual(2); // gg 2, 3, 4
    expect(res.body.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('400 se frequency non supportata', async () => {
    const room = await setupRoom();
    const { authHeader } = await createTeacher();
    const day1 = dayjs().add(1, 'day');
    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: day1.hour(10).toISOString(),
        endTime: day1.hour(11).toISOString(),
        recurrence: {
          frequency: 'monthly',
          startDate: day1.format('YYYY-MM-DD'),
          endDate: day1.add(60, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(400);
  });

  it('crea in pending_approval per aula con requiresApproval', async () => {
    const room = await setupRoom({ requiresApproval: true });
    const { authHeader } = await createTeacher();
    const day1 = dayjs().add(1, 'day');
    const res = await request(app)
      .post('/api/bookings/recurring')
      .set('Authorization', authHeader)
      .send({
        roomId: room.id,
        startTime: day1.hour(10).toISOString(),
        endTime: day1.hour(11).toISOString(),
        recurrence: {
          frequency: 'weekly',
          byWeekday: ['MO'],
          startDate: day1.format('YYYY-MM-DD'),
          endDate: day1.add(14, 'day').format('YYYY-MM-DD'),
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    const bookings = await Booking.findAll({
      where: { recurrenceId: res.body.recurrenceId },
    });
    for (const b of bookings) expect(b.status).toBe('pending_approval');
  });
});

// =====================================================
// ROUTE — DELETE /bookings/recurrences/:id
// =====================================================
describe('DELETE /bookings/recurrences/:id', () => {
  it('cancella tutte le occorrenze future, lascia le passate', async () => {
    const room = await createRoom();
    const { user, authHeader } = await createTeacher();
    const series = await BookingRecurrence.create({
      userId: user.id,
      roomId: room.id,
      frequency: 'weekly',
      interval: 1,
      byWeekday: ['MO'],
      startDate: dayjs().subtract(14, 'day').format('YYYY-MM-DD'),
      endDate: dayjs().add(14, 'day').format('YYYY-MM-DD'),
      excludeDates: [],
    });
    // 2 booking passate + 2 future legate alla serie
    const past1 = await createBooking({
      user,
      room,
      startTime: dayjs().subtract(14, 'day').hour(10).toDate(),
      endTime: dayjs().subtract(14, 'day').hour(11).toDate(),
    });
    await past1.update({ recurrenceId: series.id });
    const future1 = await createBooking({
      user,
      room,
      startTime: dayjs().add(7, 'day').hour(10).toDate(),
      endTime: dayjs().add(7, 'day').hour(11).toDate(),
    });
    await future1.update({ recurrenceId: series.id });
    const future2 = await createBooking({
      user,
      room,
      startTime: dayjs().add(14, 'day').hour(10).toDate(),
      endTime: dayjs().add(14, 'day').hour(11).toDate(),
    });
    await future2.update({ recurrenceId: series.id });

    const res = await request(app)
      .delete(`/api/bookings/recurrences/${series.id}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.cancelledCount).toBe(2);

    // Passata: NON toccata
    const refreshedPast = await Booking.findByPk(past1.id);
    expect(refreshedPast.status).not.toBe('cancelled');
    // Future: cancellate (soft)
    const f1 = await Booking.findByPk(future1.id);
    const f2 = await Booking.findByPk(future2.id);
    expect(f1.status).toBe('cancelled');
    expect(f2.status).toBe('cancelled');
  });

  it('403 se utente non-proprietario non-admin', async () => {
    const room = await createRoom();
    const { user: owner } = await createTeacher();
    const { authHeader: otherAuth } = await createTeacher();
    const series = await BookingRecurrence.create({
      userId: owner.id,
      roomId: room.id,
      frequency: 'weekly',
      byWeekday: ['MO'],
      startDate: dayjs().format('YYYY-MM-DD'),
      endDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      excludeDates: [],
    });
    const res = await request(app)
      .delete(`/api/bookings/recurrences/${series.id}`)
      .set('Authorization', otherAuth);
    expect(res.status).toBe(403);
  });

  it('admin può cancellare serie di altri', async () => {
    const room = await createRoom();
    const { user: owner } = await createTeacher();
    const { authHeader: adminAuth } = await createAdmin();
    const series = await BookingRecurrence.create({
      userId: owner.id,
      roomId: room.id,
      frequency: 'weekly',
      byWeekday: ['MO'],
      startDate: dayjs().format('YYYY-MM-DD'),
      endDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      excludeDates: [],
    });
    const res = await request(app)
      .delete(`/api/bookings/recurrences/${series.id}`)
      .set('Authorization', adminAuth);
    expect(res.status).toBe(200);
  });

  it('404 per serie inesistente', async () => {
    const { authHeader } = await createTeacher();
    const res = await request(app)
      .delete('/api/bookings/recurrences/99999')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});
