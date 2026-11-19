'use strict';

// Il generatore monte ore passa da bookingLifecycle: nessuna mail per le lezioni
// generate/annullate dal piano; lista d'attesa promossa come prima.

const request = require('supertest');
const {
  sequelize,
  Booking,
  BookingWaitlist,
  MailOutbox,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');
const generator = require('../../services/monteOreBookingGenerator');

describe('Monte Ore — generatore via bookingLifecycle', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setup() {
    const teacher = await createAuthedUser({ role: 'docente' });
    const admin = await createAdmin();
    const room = await createRoom();
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    await createBookingRule({ role: 'admin' });
    const proposal = await MonteOreProposal.create({
      userId: teacher.user.id,
      academicYear: '2027/2028',
      validFrom: '2027-11-01',
      validTo: '2027-11-30',
      status: 'approved',
    });
    const schedule = await MonteOreSchedule.create({
      proposalId: proposal.id,
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      roomId: room.id,
      bookingType: 'lezione',
    });
    const slots = await MonteOreSlot.bulkCreate(
      ['2027-11-01', '2027-11-08'].map((date) => ({
        proposalId: proposal.id,
        scheduleId: schedule.id,
        date,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        isActive: true,
        isLocked: false,
      })),
    );
    const plan = { proposal, schedules: [schedule], user: teacher.user };
    return { teacher, admin, room, proposal, schedule, slots, plan };
  }

  // Gli effetti post-commit sono fire-and-forget: attende che si assestino.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  const run = (fn) => sequelize.transaction(fn);
  const reload = (ctx) =>
    MonteOreSlot.findAll({ where: { proposalId: ctx.proposal.id }, order: [['date', 'ASC']] });

  async function generate(ctx) {
    const slots = generator.resolveSlots(ctx.plan, await reload(ctx));
    return run((t) => generator.reconcile(ctx.plan, slots, t));
  }

  async function waitOn(ctx, slot) {
    const { userId } = {};
    void userId;
    const { user: waiting } = await createAuthedUser({ role: 'studente' });
    const { startTime, endTime } = generator.slotInstants(slot);
    return BookingWaitlist.create({
      userId: waiting.id,
      roomId: ctx.room.id,
      startTime,
      endTime,
      position: 0,
      type: 'studio_individuale',
    });
  }

  it('generazione e annullo: nessuna mail per le lezioni del piano', async () => {
    const ctx = await setup();
    const res = await generate(ctx);
    expect(res.created).toBe(2);
    const bookings = await Booking.findAll({ where: { userId: ctx.teacher.user.id } });
    expect(bookings.every((b) => b.origin === 'monte_ore' && b.status === 'confirmed')).toBe(true);

    await run(async (t) =>
      generator.cancelForSlots(await reload(ctx), t, { reason: 'Calendario sospeso' }),
    );
    await settle();
    await generate(ctx);
    await settle();
    await generator.releasePlan(ctx.proposal.id);
    expect(await Booking.count({ where: { status: 'cancelled' } })).toBe(4);
    await settle();
    expect(await MailOutbox.count()).toBe(0);
  });

  it('reconcile con annullo (slot disattivato): lista d attesa promossa', async () => {
    const ctx = await setup();
    await generate(ctx);
    const entry = await waitOn(ctx, ctx.slots[0]);
    const slots = generator.resolveSlots(ctx.plan, await reload(ctx));
    slots[0].isActive = false; // lo slot si libera e non viene ricreato
    await run((t) => generator.reconcile(ctx.plan, slots, t));
    await settle();
    await entry.reload();
    expect(entry.notifiedAt).not.toBeNull();
  });

  it('sospensione calendario (cancelForSlots): lista d attesa promossa', async () => {
    const ctx = await setup();
    await generate(ctx);
    const entry = await waitOn(ctx, ctx.slots[0]);
    await run(async (t) =>
      generator.cancelForSlots(await reload(ctx), t, { reason: 'Calendario sospeso' }),
    );
    await settle();
    await entry.reload();
    expect(entry.notifiedAt).not.toBeNull();
  });

  it('sblocco (releasePlan): lista d attesa NON promossa (update di massa, come prima)', async () => {
    const ctx = await setup();
    await generate(ctx);
    const entry = await waitOn(ctx, ctx.slots[0]);
    const r = await generator.releasePlan(ctx.proposal.id);
    expect(r.cleared).toBe(2);
    await settle();
    await entry.reload();
    expect(entry.notifiedAt).toBeNull();
    expect(await MailOutbox.count()).toBe(0);
  });

  it('conflitto in fail-mode: codice BOOKING_CONFLICT e transazione annullata', async () => {
    const ctx = await setup();
    const other = await createAuthedUser({ role: 'docente' });
    const { startTime, endTime } = generator.slotInstants(ctx.slots[1]);
    await Booking.create({
      userId: other.user.id,
      roomId: ctx.room.id,
      startTime,
      endTime,
      status: 'confirmed',
      type: 'lezione',
    });
    await expect(generate(ctx)).rejects.toMatchObject({ code: 'BOOKING_CONFLICT' });
    expect(await Booking.count({ where: { userId: ctx.teacher.user.id } })).toBe(0);
  });
});
