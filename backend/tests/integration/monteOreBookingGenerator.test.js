'use strict';

// Stato del piano → insieme di prenotazioni, attraverso l'unico generatore.

const request = require('supertest');
const { buildApp } = require('../../app');
const {
  Booking,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');
const workflow = require('../../services/monteOreWorkflowService');
const generator = require('../../services/monteOreBookingGenerator');

describe('Monte Ore — generatore unico slot → prenotazioni', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setup({ withSettings = true } = {}) {
    const teacher = await createAuthedUser({
      role: 'docente',
      contractType: 'collaborazione',
      monteOreAnnualHoursOverride: 2,
      monteOreBypassDayConstraint: true,
    });
    const admin = await createAdmin();
    const room = await createRoom();
    const instituteId = (await room.getBuilding()).instituteId;
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    await createBookingRule({ role: 'admin' });
    if (withSettings)
      await MonteOreSettings.create({
        instituteId,
        academicYear: '2027/2028',
        academicYearStart: '2027-11-01',
        academicYearEnd: '2028-10-31',
        lessonsStartDate: '2027-11-01',
        lessonsEndDate: '2028-06-30',
        submissionWindowStart: '2026-01-01',
        submissionWindowEnd: '2028-10-31',
        maxAmendmentsPerYear: 3,
      });
    const proposal = await MonteOreProposal.create({
      userId: teacher.user.id,
      academicYear: '2027/2028',
      validFrom: '2027-11-01',
      validTo: '2027-11-30',
      status: 'submitted',
      contractSnapshot: { mode: 'exact', minHours: 2, bypassDayConstraint: true },
    });
    const schedule = await MonteOreSchedule.create({
      proposalId: proposal.id,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      roomId: room.id,
      bookingType: 'lezione',
    });
    const slots = withSettings
      ? await MonteOreSlot.bulkCreate(
          ['2027-11-01', '2027-11-08', '2027-11-15'].map((date, i) => ({
            proposalId: proposal.id,
            scheduleId: schedule.id,
            date,
            dayOfWeek: 1,
            startTime: '09:00',
            endTime: '10:00',
            isActive: i < 2,
            isLocked: false,
          })),
        )
      : [];
    await proposal.update({ totalHoursPlanned: 2, totalHoursRequested: 2 });
    return { teacher, admin, room, proposal, slots, schedule };
  }
  const post = (ctx, path, body = {}) =>
    request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/${path}`)
      .set('Authorization', ctx.admin.authHeader)
      .send(body);
  const confirmed = (ctx) =>
    Booking.findAll({
      where: { userId: ctx.teacher.user.id, status: 'confirmed' },
      order: [['startTime', 'ASC']],
    });
  const reloadSlots = (ctx) =>
    MonteOreSlot.findAll({ where: { proposalId: ctx.proposal.id }, order: [['date', 'ASC']] });

  it('approva: una prenotazione monte_ore per slot attivo, legame solo su slot.bookingId', async () => {
    const ctx = await setup();
    const r = await post(ctx, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bookings = await confirmed(ctx);
    expect(bookings).toHaveLength(2);
    expect(bookings.every((b) => b.origin === 'monte_ore')).toBe(true);
    const slots = await reloadSlots(ctx);
    expect(slots.map((s) => s.bookingId)).toEqual([bookings[0].id, bookings[1].id, null]);
    await ctx.schedule.reload();
    expect(ctx.schedule.generatedBookingIds).toEqual([]);
  });

  it('sblocca → ri-approva: vecchie prenotazioni annullate, nuove collegate agli slot', async () => {
    const ctx = await setup();
    await post(ctx, 'approve');
    const first = (await confirmed(ctx)).map((b) => b.id);

    const unlock = await post(ctx, 'unlock');
    expect(unlock.status, JSON.stringify(unlock.body)).toBe(200);
    expect(unlock.body.cleared.cleared).toBe(2);
    expect(await confirmed(ctx)).toHaveLength(0);
    expect((await reloadSlots(ctx)).every((s) => s.bookingId === null)).toBe(true);

    const again = await post(ctx, 'approve');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const second = await confirmed(ctx);
    expect(second).toHaveLength(2);
    expect(second.some((b) => first.includes(b.id))).toBe(false);
    const slots = await reloadSlots(ctx);
    expect(slots.filter((s) => s.bookingId).map((s) => s.bookingId)).toEqual(
      second.map((b) => b.id),
    );
    expect(await Booking.count({ where: { status: 'cancelled' } })).toBe(2);
  });

  it('override aula sullo slot: la prenotazione usa l’aula dello slot, non quella del pattern', async () => {
    const ctx = await setup();
    const other = await createRoom({ name: 'Aula override' });
    const r = await post(ctx, 'approve', {
      assignments: [{ slotId: ctx.slots[1].id, roomId: other.id }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bookings = await confirmed(ctx);
    expect(bookings.map((b) => b.roomId)).toEqual([ctx.room.id, other.id]);
  });

  it('decisione variazione su piano generato: cambio aula sposta la prenotazione', async () => {
    const ctx = await setup();
    await post(ctx, 'approve');
    const other = await createRoom({ name: 'Aula nuova' });
    const amendment = await workflow.requestAmendment(ctx.proposal.id, ctx.teacher.user.id, {
      operations: [{ kind: 'change_room', slotId: ctx.slots[0].id, payload: { roomId: other.id } }],
      requestKey: 'generator_key_1',
    });
    await workflow.decideAmendment(ctx.proposal.id, amendment.id, ctx.admin.user, {});
    const bookings = await confirmed(ctx);
    expect(bookings.map((b) => b.roomId)).toEqual([other.id, ctx.room.id]);
    const slots = await reloadSlots(ctx);
    expect(slots[0].bookingId).toBe(bookings[0].id);
  });

  it('sospensione calendario: annulla le prenotazioni dei soli slot coinvolti e azzera il legame', async () => {
    const ctx = await setup();
    await post(ctx, 'approve');
    const r = await request(app)
      .post('/api/admin/monte-ore/suspensions')
      .set('Authorization', ctx.admin.authHeader)
      .send({
        academicYear: '2027/2028',
        name: 'Blocco',
        dateFrom: '2027-11-01',
        dateTo: '2027-11-01',
        kind: 'partial',
        confirmImpact: true,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await confirmed(ctx)).toHaveLength(1);
    const slots = await reloadSlots(ctx);
    expect(slots[0].bookingId).toBeNull();
    expect(slots[0].isLocked).toBe(true);
    expect(slots[1].bookingId).toBeTruthy();
  });

  it('percorso legacy (anno senza calendario): salta i conflitti e collega gli slot creati', async () => {
    const ctx = await setup({ withSettings: false });
    await ctx.proposal.update({ status: 'approved' });
    // Occupa l'aula il 2027-11-08 per forzare un conflitto
    const { user: other } = await createAuthedUser({ role: 'docente' });
    await Booking.create({
      userId: other.id,
      roomId: ctx.room.id,
      startTime: generator.toInstant('2027-11-08', '09:00'),
      endTime: generator.toInstant('2027-11-08', '10:00'),
      type: 'lezione',
      status: 'confirmed',
    });
    const res = await generator.generateForProposal(ctx.proposal.id, { actorUser: ctx.admin.user });
    // Lunedì di novembre 2027: 1, 8, 15, 22, 29
    expect(res.created).toBe(4);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].date).toBe('2027-11-08');
    const slots = await reloadSlots(ctx);
    expect(slots).toHaveLength(5);
    expect(slots.filter((s) => s.bookingId)).toHaveLength(4);
    await ctx.proposal.reload();
    expect(ctx.proposal.status).toBe('generated');
    expect(ctx.proposal.generationSummary.skipped).toBe(1);

    const cleared = await generator.releasePlan(ctx.proposal.id);
    expect(cleared.cleared).toBe(4);
    expect((await reloadSlots(ctx)).every((s) => s.bookingId === null)).toBe(true);
  });
});
