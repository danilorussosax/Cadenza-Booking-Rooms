'use strict';

/**
 * Integrazione: rilevamento overlap di prenotazioni preesistenti con una
 * BookingRuleException kind='block' (sovrapposizioni storiche al setup di
 * una nuova chiusura).
 *
 *   POST /api/rules/exceptions/preview-overlaps     → anteprima (no-write)
 *   POST /api/rules/exceptions/:id/cancel-overlapping → batch cancel
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const {
  createAuthedUser,
  createAdmin,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
} = require('../factories');
const { Booking, MonteOreProposal, MonteOreSlot } = require('../../models');

const app = buildApp({ serveFrontend: false });

async function studentWithBooking({ start, end, room, course }) {
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'M-' + Math.random().toString(36).slice(2, 8),
  });
  const booking = await createBooking({ user: auth.user, room, startTime: start, endTime: end });
  return { ...auth, booking };
}

describe('Exception overlap detection', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('preview-overlaps: ritorna le prenotazioni future nello scope di un block', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();

    // Prenotazione futura il giovedì prossimo 10:00–12:00
    const nextThursday = dayjs().add(1, 'week').day(4).hour(10).minute(0).second(0).millisecond(0);
    await studentWithBooking({
      course,
      room,
      start: nextThursday.toDate(),
      end: nextThursday.add(2, 'hour').toDate(),
    });

    // Block proposto: 09:00-13:00 dal lunedì 10gg fa al lunedì +20gg, daysOfWeek = [4] (giovedì)
    const dateFrom = dayjs().subtract(10, 'day').format('YYYY-MM-DD');
    const dateTo = dayjs().add(20, 'day').format('YYYY-MM-DD');

    const res = await request(app)
      .post('/api/rules/exceptions/preview-overlaps')
      .set('Authorization', adminHeader)
      .send({
        role: 'studente',
        name: 'Riunione collegio',
        kind: 'block',
        daysOfWeek: [4],
        dateFrom,
        dateTo,
        startTime: '09:00',
        endTime: '13:00',
      });
    expect(res.status).toBe(200);
    expect(res.body.overlapping).toHaveLength(1);
    expect(res.body.overlapping[0].user.role).toBe('studente');
    expect(res.body.overlapping[0].room.id).toBe(room.id);
  });

  it('preview-overlaps: filtro per ruolo esclude prenotazioni di altri ruoli', async () => {
    await createBookingRule({ role: 'studente' });
    await createBookingRule({ role: 'docente' });
    const course = await createCourse();
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();

    const slot = dayjs().add(1, 'week').day(2).hour(10);
    // Studente: il martedì 10–11
    const stu = await createAuthedUser({ role: 'studente', courseId: course.id, matricola: 'X1' });
    await createBooking({
      user: stu.user,
      room,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
    });
    // Docente: stesso giorno+ora 11–12
    const doc = await createAuthedUser({ role: 'docente' });
    await createBooking({
      user: doc.user,
      room,
      startTime: slot.add(1, 'hour').toDate(),
      endTime: slot.add(2, 'hour').toDate(),
    });

    // Block per soli docenti
    const res = await request(app)
      .post('/api/rules/exceptions/preview-overlaps')
      .set('Authorization', adminHeader)
      .send({
        role: 'docente',
        name: 'Solo docenti',
        kind: 'block',
        dateFrom: dayjs().format('YYYY-MM-DD'),
        dateTo: dayjs().add(30, 'day').format('YYYY-MM-DD'),
      });
    expect(res.status).toBe(200);
    expect(res.body.overlapping).toHaveLength(1);
    expect(res.body.overlapping[0].user.role).toBe('docente');
  });

  it('preview-overlaps: time_window non emette overlap (scope=block-only)', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();
    const slot = dayjs().add(2, 'day').hour(14);
    await studentWithBooking({
      course,
      room,
      start: slot.toDate(),
      end: slot.add(2, 'hour').toDate(),
    });

    const res = await request(app)
      .post('/api/rules/exceptions/preview-overlaps')
      .set('Authorization', adminHeader)
      .send({
        role: 'studente',
        name: 'Pausa pranzo',
        kind: 'time_window',
        startTime: '13:00',
        endTime: '15:00',
        maxHoursInWindow: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.overlapping).toHaveLength(0);
  });

  it('cancel-overlapping: cancella in batch e marca cancelReason', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();

    const slot = dayjs().add(3, 'day').hour(10);
    const { booking } = await studentWithBooking({
      course,
      room,
      start: slot.toDate(),
      end: slot.add(1, 'hour').toDate(),
    });

    // Crea il block, poi cancella overlap
    const create = await request(app)
      .post('/api/rules/exceptions')
      .set('Authorization', adminHeader)
      .send({
        role: 'studente',
        name: 'Sospensione didattica',
        kind: 'block',
        dateFrom: dayjs().format('YYYY-MM-DD'),
        dateTo: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      });
    expect(create.status).toBe(201);
    const excId = create.body.exception.id;

    const cancel = await request(app)
      .post(`/api/rules/exceptions/${excId}/cancel-overlapping`)
      .set('Authorization', adminHeader)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(1);

    const reloaded = await Booking.findByPk(booking.id);
    expect(reloaded.status).toBe('cancelled');
    expect(reloaded.cancelReason).toMatch(/sospensione didattica/i);
  });

  it('cancel-overlapping: NON cancella prenotazioni passate o checked-in', async () => {
    await createBookingRule({ role: 'studente' });
    const course = await createCourse();
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();

    // Prenotazione PASSATA (ieri) — non deve essere toccata.
    const past = dayjs().subtract(1, 'day').hour(10);
    const { booking: pastBooking } = await studentWithBooking({
      course,
      room,
      start: past.toDate(),
      end: past.add(1, 'hour').toDate(),
    });
    // Prenotazione FUTURA con check-in (consumata) — non deve essere toccata.
    const future = dayjs().add(2, 'day').hour(10);
    const { booking: checkedInBooking } = await studentWithBooking({
      course,
      room,
      start: future.toDate(),
      end: future.add(1, 'hour').toDate(),
    });
    await checkedInBooking.update({ checkedInAt: new Date() });

    const create = await request(app)
      .post('/api/rules/exceptions')
      .set('Authorization', adminHeader)
      .send({
        role: 'studente',
        name: 'Test',
        kind: 'block',
        dateFrom: dayjs().subtract(5, 'day').format('YYYY-MM-DD'),
        dateTo: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      });
    const excId = create.body.exception.id;

    const cancel = await request(app)
      .post(`/api/rules/exceptions/${excId}/cancel-overlapping`)
      .set('Authorization', adminHeader)
      .send({});
    expect(cancel.body.cancelled).toBe(0);

    const stillPast = await Booking.findByPk(pastBooking.id);
    const stillCheckedIn = await Booking.findByPk(checkedInBooking.id);
    expect(stillPast.status).toBe('confirmed');
    expect(stillCheckedIn.status).toBe('confirmed');
  });

  it('cancel-overlapping: sincronizza i MonteOreSlot collegati', async () => {
    await createBookingRule({ role: 'docente' });
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();
    const docente = await createAuthedUser({ role: 'docente' });

    // Simula prenotazione generata da Monte Ore (booking + slot linkato).
    const slot = dayjs().add(2, 'day').hour(10);
    const booking = await Booking.create({
      userId: docente.user.id,
      roomId: room.id,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
      type: 'lezione',
      status: 'confirmed',
    });
    // Crea una proposal + slot col link bookingId
    const proposal = await MonteOreProposal.create({
      userId: docente.user.id,
      academicYear: '2025/2026',
      validFrom: '2025-09-01',
      validTo: '2026-08-31',
      status: 'generated',
    });
    const moSlot = await MonteOreSlot.create({
      proposalId: proposal.id,
      scheduleId: null,
      date: slot.format('YYYY-MM-DD'),
      dayOfWeek: slot.day(),
      startTime: slot.format('HH:mm'),
      endTime: slot.add(1, 'hour').format('HH:mm'),
      isActive: true,
      isLocked: false,
      bookingId: booking.id,
      // slot fuori-pattern: roomId+bookingType obbligatori per validate
      roomId: room.id,
      bookingType: 'lezione',
    });

    // Crea block + cancel-overlapping
    const create = await request(app)
      .post('/api/rules/exceptions')
      .set('Authorization', adminHeader)
      .send({
        role: 'docente',
        name: 'Sospensione collegio docenti',
        kind: 'block',
        dateFrom: dayjs().format('YYYY-MM-DD'),
        dateTo: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      });
    const excId = create.body.exception.id;

    const cancel = await request(app)
      .post(`/api/rules/exceptions/${excId}/cancel-overlapping`)
      .set('Authorization', adminHeader)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(1);
    expect(cancel.body.monteOreSlotsSynced).toBe(1);

    const reloadedSlot = await MonteOreSlot.findByPk(moSlot.id);
    expect(reloadedSlot.isActive).toBe(false);
    expect(reloadedSlot.isLocked).toBe(true);
    expect(reloadedSlot.bookingId).toBeNull();
    expect(reloadedSlot.lockReason).toMatch(/sospensione/i);
  });

  it('preview: marca fromMonteOre=true per booking generati dal monte ore', async () => {
    await createBookingRule({ role: 'docente' });
    const room = await createRoom();
    const { authHeader: adminHeader } = await createAdmin();
    const docente = await createAuthedUser({ role: 'docente' });

    const slot = dayjs().add(3, 'day').hour(10);
    const moBooking = await Booking.create({
      userId: docente.user.id,
      roomId: room.id,
      startTime: slot.toDate(),
      endTime: slot.add(1, 'hour').toDate(),
      type: 'lezione',
      status: 'confirmed',
    });
    const manualBooking = await Booking.create({
      userId: docente.user.id,
      roomId: room.id,
      startTime: slot.add(2, 'hour').toDate(),
      endTime: slot.add(3, 'hour').toDate(),
      type: 'lezione',
      status: 'confirmed',
    });
    const proposal = await MonteOreProposal.create({
      userId: docente.user.id,
      academicYear: '2025/2026',
      validFrom: '2025-09-01',
      validTo: '2026-08-31',
      status: 'generated',
    });
    await MonteOreSlot.create({
      proposalId: proposal.id,
      scheduleId: null,
      date: slot.format('YYYY-MM-DD'),
      dayOfWeek: slot.day(),
      startTime: slot.format('HH:mm'),
      endTime: slot.add(1, 'hour').format('HH:mm'),
      isActive: true,
      bookingId: moBooking.id,
      roomId: room.id,
      bookingType: 'lezione',
    });

    const res = await request(app)
      .post('/api/rules/exceptions/preview-overlaps')
      .set('Authorization', adminHeader)
      .send({
        role: 'docente',
        name: 'Test',
        kind: 'block',
        dateFrom: dayjs().format('YYYY-MM-DD'),
        dateTo: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.overlapping.map((b) => [b.id, b]));
    expect(byId[moBooking.id].fromMonteOre).toBe(true);
    expect(byId[manualBooking.id].fromMonteOre).toBe(false);
  });

  it("non-admin riceve 403 sull'endpoint preview", async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const res = await request(app)
      .post('/api/rules/exceptions/preview-overlaps')
      .set('Authorization', authHeader)
      .send({ role: 'all', name: 'X', kind: 'block' });
    expect(res.status).toBe(403);
  });
});
