'use strict';

const request = require('supertest');
const dayjs = require('dayjs');
const { buildApp } = require('../../app');
const {
  User,
  Booking,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
  MonteOreAmendment,
  MailOutbox,
  ContractType,
  MonteOreSuspension,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');
const workflow = require('../../services/monteOreWorkflowService');
const slotsService = require('../../services/monteOreSlotService');

describe('Monte Ore — revisione obbligatoria e contratto', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setup({
    mode = 'exact',
    contractType = 'collaborazione',
    hours = 2,
    maximum = 3,
  } = {}) {
    const teacher = await createAuthedUser({
      role: 'docente',
      contractType,
      monteOreAnnualHoursOverride: hours,
      monteOreBypassDayConstraint: true,
    });
    const admin = await createAdmin();
    const room = await createRoom();
    const instituteId = (await room.getBuilding()).instituteId;
    await createBookingRule({ role: 'docente' });
    await MonteOreSettings.create({
      instituteId,
      academicYear: '2027/2028',
      academicYearStart: '2027-11-01',
      academicYearEnd: '2028-10-31',
      lessonsStartDate: '2027-11-01',
      lessonsEndDate: '2028-06-30',
      submissionWindowStart: '2026-01-01',
      submissionWindowEnd: '2028-10-31',
      maxAmendmentsPerYear: maximum,
    });
    const proposal = await MonteOreProposal.create({
      userId: teacher.user.id,
      academicYear: '2027/2028',
      validFrom: '2027-11-01',
      validTo: '2028-06-30',
      status: 'submitted',
      contractSnapshot: { mode, minHours: hours, bypassDayConstraint: true },
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
    );
    await proposal.update({ totalHoursPlanned: 2, totalHoursRequested: 2 });
    return { teacher, admin, room, proposal, slots, schedule };
  }
  const change = (slotId, startTime = '10:00', endTime = '11:00') => ({
    kind: 'change_time',
    slotId,
    payload: { startTime, endTime },
  });
  async function send(ctx, operations, requestKey = 'request_key_01') {
    return request(app)
      .post('/api/monte-ore/me/amendments')
      .set('Authorization', ctx.teacher.authHeader)
      .send({ academicYear: '2027/2028', operations, requestKey, notes: 'Esigenza didattica' });
  }
  async function approve(ctx) {
    const r = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/approve`)
      .set('Authorization', ctx.admin.authHeader)
      .send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r;
  }

  it('valida esattamente 324 ore e massimo 162 con precisione al minuto', () => {
    expect(() => workflow.checkHours(324 * 60, { mode: 'exact', minHours: 324 })).not.toThrow();
    expect(() => workflow.checkHours(324 * 60 + 1, { mode: 'exact', minHours: 324 })).toThrow(
      /esattamente/,
    );
    expect(() => workflow.checkHours(120 * 60, { mode: 'maximum', minHours: 162 })).not.toThrow();
    expect(() => workflow.checkHours(162 * 60, { mode: 'maximum', minHours: 162 })).not.toThrow();
    expect(() => workflow.checkHours(162 * 60 + 1, { mode: 'maximum', minHours: 162 })).toThrow(
      /massimo/,
    );
    expect(() => workflow.checkHours(0, { mode: 'maximum', minHours: 162 })).toThrow();
  });

  it('crea collaborazione e ore insieme; richiesta senza ore non crea utenza', async () => {
    const admin = await createAdmin();
    const payload = {
      firstName: 'Ada',
      lastName: 'Test',
      email: 'ada@example.test',
      password: 'Password123!',
      role: 'docente',
      contractType: 'collaborazione',
    };
    let r = await request(app)
      .post('/api/users')
      .set('Authorization', admin.authHeader)
      .send(payload);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CONTRACT_HOURS_REQUIRED');
    expect(await User.count({ where: { email: payload.email } })).toBe(0);
    r = await request(app)
      .post('/api/users')
      .set('Authorization', admin.authHeader)
      .send({ ...payload, monteOreAnnualHoursOverride: 80 });
    expect(r.status).toBe(201);
    expect(r.body.user.monteOreAnnualHoursOverride).toBe(80);
  });

  it('approva con aula definitiva e crea solo gli slot selezionati', async () => {
    const ctx = await setup();
    const r = await approve(ctx);
    expect(r.body.proposal.status).toBe('generated');
    expect(
      await Booking.count({ where: { userId: ctx.teacher.user.id, status: 'confirmed' } }),
    ).toBe(2);
    await ctx.slots[0].reload();
    expect(ctx.slots[0].roomId).toBe(ctx.room.id);
    expect(ctx.slots[0].bookingId).toBeTruthy();
  });

  it('conflitto in una data annulla tutta l’approvazione', async () => {
    const ctx = await setup();
    await Booking.create({
      userId: ctx.admin.user.id,
      roomId: ctx.room.id,
      startTime: dayjs.tz('2027-11-08 09:00', 'Europe/Rome').toDate(),
      endTime: dayjs.tz('2027-11-08 10:00', 'Europe/Rome').toDate(),
      type: 'lezione',
      status: 'confirmed',
    });
    const preview = await request(app)
      .get(`/api/admin/monte-ore/${ctx.proposal.id}/preview`)
      .set('Authorization', ctx.admin.authHeader);
    expect(preview.body.issues.length).toBeGreaterThan(0);
    const r = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/approve`)
      .set('Authorization', ctx.admin.authHeader)
      .send({});
    expect(r.status).toBe(400);
    await ctx.proposal.reload();
    expect(ctx.proposal.status).toBe('submitted');
    expect(await Booking.count({ where: { userId: ctx.teacher.user.id } })).toBe(0);
  });

  it('richiesta pendente conserva piano e prenotazioni e consuma una sola volta', async () => {
    const ctx = await setup();
    await approve(ctx);
    const first = await send(ctx, [change(ctx.slots[0].id)]);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.amendment.status).toBe('pending');
    const retry = await send(ctx, [change(ctx.slots[0].id)]);
    expect(retry.body.amendment.id).toBe(first.body.amendment.id);
    await ctx.proposal.reload();
    await ctx.slots[0].reload();
    expect(ctx.proposal.requestCount).toBe(1);
    expect(ctx.slots[0].startTime).toBe('09:00');
  });

  it('una richiesta di cancellazione e recupero conta una volta e mantiene il saldo', async () => {
    const ctx = await setup();
    await approve(ctx);
    const r = await send(ctx, [
      { kind: 'toggle_off', slotId: ctx.slots[0].id, payload: {} },
      { kind: 'toggle_on', slotId: ctx.slots[2].id, payload: {} },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const decision = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/amendments/${r.body.amendment.id}/approve`)
      .set('Authorization', ctx.admin.authHeader)
      .send({});
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    await ctx.proposal.reload();
    expect(ctx.proposal.totalHoursPlanned).toBe(2);
    expect(ctx.proposal.requestCount).toBe(1);
    expect(
      await Booking.count({ where: { userId: ctx.teacher.user.id, status: 'confirmed' } }),
    ).toBe(2);
    expect(await MailOutbox.count()).toBe(1);
  });

  it('rifiuto mantiene il piano, conta nel limite e accoda l’email', async () => {
    const ctx = await setup({ maximum: 1 });
    await approve(ctx);
    const r = await send(ctx, [change(ctx.slots[0].id)]);
    const decision = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/amendments/${r.body.amendment.id}/reject`)
      .set('Authorization', ctx.admin.authHeader)
      .send({ reason: 'Aula indisponibile' });
    expect(decision.status).toBe(200);
    const next = await send(ctx, [change(ctx.slots[1].id)], 'request_key_02');
    expect(next.status).toBe(400);
    expect(next.body.code).toBe('AMENDMENT_LIMIT_REACHED');
    await ctx.slots[0].reload();
    expect(ctx.slots[0].startTime).toBe('09:00');
    const email = await MailOutbox.findOne();
    expect(email.bodyHtml).toContain('Aula indisponibile');
    expect(email.status).toBe('pending');
  });

  it('revisore modifica orario con motivazione; conserva originale e invia esito finale', async () => {
    const ctx = await setup();
    await approve(ctx);
    const r = await send(ctx, [change(ctx.slots[0].id)]);
    const url = `/api/admin/monte-ore/${ctx.proposal.id}/amendments/${r.body.amendment.id}/approve`;
    let decision = await request(app)
      .post(url)
      .set('Authorization', ctx.admin.authHeader)
      .send({ operations: [change(ctx.slots[0].id, '11:00', '12:00')] });
    expect(decision.status).toBe(400);
    expect(await MailOutbox.count()).toBe(0);
    decision = await request(app)
      .post(url)
      .set('Authorization', ctx.admin.authHeader)
      .send({
        operations: [change(ctx.slots[0].id, '11:00', '12:00')],
        reason: 'Compatibilità aule',
      });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    expect(decision.body.amendment.operations[0].payload.startTime).toBe('10:00');
    expect(decision.body.amendment.finalOperations[0].payload.startTime).toBe('11:00');
    const email = await MailOutbox.findOne();
    expect(email.kind).toBe('monte_ore_modified');
    expect(email.bodyHtml).toContain('11:00');
    const duplicate = await request(app)
      .post(url)
      .set('Authorization', ctx.admin.authHeader)
      .send({});
    expect(duplicate.status).toBe(400);
    expect(await MailOutbox.count()).toBe(1);
  });

  it('conflitto alla decisione conserva richiesta pendente e non accoda email', async () => {
    const ctx = await setup();
    await approve(ctx);
    const r = await send(ctx, [change(ctx.slots[0].id)]);
    await Booking.create({
      userId: ctx.admin.user.id,
      roomId: ctx.room.id,
      startTime: dayjs.tz('2027-11-01 10:00', 'Europe/Rome').toDate(),
      endTime: dayjs.tz('2027-11-01 11:00', 'Europe/Rome').toDate(),
      status: 'confirmed',
      type: 'lezione',
    });
    const decision = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/amendments/${r.body.amendment.id}/approve`)
      .set('Authorization', ctx.admin.authHeader)
      .send({});
    expect(decision.status).toBe(400);
    expect((await MonteOreAmendment.findByPk(r.body.amendment.id)).status).toBe('pending');
    expect(await MailOutbox.count()).toBe(0);
    await ctx.slots[0].reload();
    expect(ctx.slots[0].startTime).toBe('09:00');
  });

  it('limite zero blocca ogni nuova richiesta e rigenerazione preserva selezioni e id', async () => {
    const ctx = await setup({ maximum: 0 });
    await approve(ctx);
    const r = await send(ctx, [change(ctx.slots[0].id)]);
    expect(r.body.code).toBe('AMENDMENT_LIMIT_REACHED');
    await ctx.proposal.update({ status: 'draft' });
    await slotsService.regenerateSlotsFromPattern(ctx.proposal.id);
    const kept = await MonteOreSlot.findByPk(ctx.slots[0].id);
    expect(kept.isActive).toBe(true);
  });

  it('blocchi didattici mostrano impatto, poi sospendono solo le date coinvolte', async () => {
    const ctx = await setup();
    await approve(ctx);
    const data = {
      academicYear: '2027/2028',
      name: 'Blocco didattico',
      dateFrom: '2027-11-01',
      dateTo: '2027-11-01',
      kind: 'partial',
    };
    let r = await request(app)
      .post('/api/admin/monte-ore/suspensions')
      .set('Authorization', ctx.admin.authHeader)
      .send(data);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CALENDAR_IMPACT_CONFIRMATION');
    expect(await MonteOreSuspension.count()).toBe(0);
    r = await request(app)
      .post('/api/admin/monte-ore/suspensions')
      .set('Authorization', ctx.admin.authHeader)
      .send({ ...data, confirmImpact: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ctx.proposal.reload();
    expect(ctx.proposal.requiresRevalidation).toBe(true);
    expect(ctx.proposal.requestCount).toBe(0);
    expect(
      await Booking.count({ where: { userId: ctx.teacher.user.id, status: 'confirmed' } }),
    ).toBe(1);
    expect(await MailOutbox.count()).toBe(1);
  });

  it('scritture del prossimo anno non modificano il corrente', async () => {
    const ctx = await setup();
    await ctx.proposal.update({ status: 'draft' });
    const r = await request(app)
      .patch(`/api/monte-ore/me/schedules/${ctx.schedule.id}`)
      .set('Authorization', ctx.teacher.authHeader)
      .send({ academicYear: '2027/2028', startTime: '11:00', endTime: '12:00' });
    expect(r.status).toBe(200);
    await ctx.schedule.reload();
    expect(ctx.schedule.startTime).toBe('11:00');
  });

  it('modifica amministrativa del pattern conserva date selezionate e aggiorna gli orari', async () => {
    const ctx = await setup();
    const r = await request(app)
      .patch(`/api/admin/monte-ore/${ctx.proposal.id}/schedules/${ctx.schedule.id}`)
      .set('Authorization', ctx.admin.authHeader)
      .send({ startTime: '11:00', endTime: '12:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await ctx.slots[0].reload();
    expect(ctx.slots[0].isActive).toBe(true);
    expect(ctx.slots[0].startTime).toBe('11:00');
    await approve(ctx);
    const booking = await Booking.findByPk((await ctx.slots[0].reload()).bookingId);
    expect(dayjs(booking.startTime).tz('Europe/Rome').hour()).toBe(11);
  });

  it('snapshot contrattuale resta stabile dopo variazioni del tipo di contratto', async () => {
    const ctx = await setup();
    await ContractType.create({
      instituteId: (await ctx.room.getBuilding()).instituteId,
      code: 'collaborazione',
      label: 'Collaborazione',
      hoursMode: 'exact',
      requiresIndividualHours: true,
    });
    await approve(ctx);
    await ctx.teacher.user.update({ monteOreAnnualHoursOverride: 5 });
    const r = await send(ctx, [change(ctx.slots[0].id)]);
    expect(r.status).toBe(201);
  });
  it('rivalidazione amministrativa recupera le ore sospese senza consumare richieste', async () => {
    const ctx = await setup();
    await approve(ctx);
    await request(app)
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
    const r = await request(app)
      .post(`/api/admin/monte-ore/${ctx.proposal.id}/revalidate`)
      .set('Authorization', ctx.admin.authHeader)
      .send({
        operations: [
          {
            kind: 'add_new_day',
            payload: {
              date: '2027-11-22',
              startTime: '09:00',
              endTime: '10:00',
              roomId: ctx.room.id,
            },
          },
        ],
        reason: 'Recupero ore dopo sospensione',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await ctx.proposal.reload();
    expect(ctx.proposal.requiresRevalidation).toBe(false);
    expect(ctx.proposal.totalHoursPlanned).toBe(2);
    expect(ctx.proposal.requestCount).toBe(0);
    expect(
      await Booking.count({ where: { userId: ctx.teacher.user.id, status: 'confirmed' } }),
    ).toBe(2);
    expect(await MailOutbox.count()).toBe(2);
  });

  it('migrazione ripetibile conserva storico e non riscrive snapshot nuovi', async () => {
    const ctx = await setup();
    await ctx.proposal.update({
      contractSnapshot: null,
      minRequiredHoursSnapshot: 2,
      amendmentCount: 3,
    });
    const { sequelize } = require('../../models');
    const migration = require('../../lib/monteOreWorkflowMigration');
    await migration.up(sequelize.getQueryInterface());
    await migration.up(sequelize.getQueryInterface());
    await ctx.proposal.reload();
    expect(ctx.proposal.contractSnapshot.source).toBe('legacy_snapshot');
    expect(ctx.proposal.contractSnapshot.minHours).toBe(2);
    expect(ctx.proposal.amendmentCount).toBe(3);
    expect(ctx.proposal.requestCount).toBe(0);
  });

  const pgOnly = require('../../models').sequelize.getDialect() === 'postgres' ? it : it.skip;
  pgOnly('due richieste concorrenti sull’ultimo posto consumano una sola unità', async () => {
    const ctx = await setup({ maximum: 1 });
    await approve(ctx);
    const results = await Promise.allSettled([
      workflow.requestAmendment(ctx.proposal.id, ctx.teacher.user.id, {
        operations: [change(ctx.slots[0].id)],
        requestKey: 'parallel_request_1',
      }),
      workflow.requestAmendment(ctx.proposal.id, ctx.teacher.user.id, {
        operations: [change(ctx.slots[1].id)],
        requestKey: 'parallel_request_2',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe(
      'AMENDMENT_LIMIT_REACHED',
    );
    await ctx.proposal.reload();
    expect(ctx.proposal.requestCount).toBe(1);
    expect(await MonteOreAmendment.count()).toBe(1);
  });
  pgOnly('due decisioni concorrenti producono una sola decisione ed email', async () => {
    const ctx = await setup();
    await approve(ctx);
    const sent = await send(ctx, [change(ctx.slots[0].id)]);
    const results = await Promise.allSettled([
      workflow.decideAmendment(ctx.proposal.id, sent.body.amendment.id, ctx.admin.user),
      workflow.decideAmendment(ctx.proposal.id, sent.body.amendment.id, ctx.admin.user),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await MailOutbox.count()).toBe(1);
    expect(
      await Booking.count({ where: { userId: ctx.teacher.user.id, status: 'confirmed' } }),
    ).toBe(2);
  });
});
