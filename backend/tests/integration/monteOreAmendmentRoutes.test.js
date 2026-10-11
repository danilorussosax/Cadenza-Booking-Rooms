'use strict';

/**
 * Integrazione: route docente delle variazioni (routes/monte-ore/teacherAmendments)
 * e vista admin globale (routes/monteOre/amendmentInbox).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const {
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSlot,
  MonteOreSettings,
  MonteOreAmendment,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');

const YEAR = '2027/2028';

describe('Monte Ore — route variazioni docente e inbox admin', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  // Docente con proposta a 3 slot (lunedì 1, 8, 15 nov; i primi due attivi),
  // contratto "collaborazione" 2h esatte e budget variazioni ampio.
  async function setup({ approved = true } = {}) {
    const teacher = await createAuthedUser({
      role: 'docente',
      contractType: 'collaborazione',
      monteOreAnnualHoursOverride: 2,
      monteOreBypassDayConstraint: true,
    });
    const admin = await createAdmin();
    const room = await createRoom();
    const otherRoom = await createRoom({ name: 'Altra aula' });
    const instituteId = (await room.getBuilding()).instituteId;
    await createBookingRule({ role: 'docente' });
    await MonteOreSettings.create({
      instituteId,
      academicYear: YEAR,
      academicYearStart: '2027-11-01',
      academicYearEnd: '2028-10-31',
      lessonsStartDate: '2027-11-01',
      lessonsEndDate: '2028-06-30',
      submissionWindowStart: '2026-01-01',
      submissionWindowEnd: '2028-10-31',
      maxAmendmentsPerYear: 20,
    });
    const proposal = await MonteOreProposal.create({
      userId: teacher.user.id,
      academicYear: YEAR,
      validFrom: '2027-11-01',
      validTo: '2028-06-30',
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
    const slots = await MonteOreSlot.bulkCreate(
      ['2027-11-01', '2027-11-08', '2027-11-15', '2027-11-22'].map((date, i) => ({
        proposalId: proposal.id,
        scheduleId: schedule.id,
        date,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        isActive: i < 2,
        isLocked: i === 3,
      })),
    );
    await proposal.update({ totalHoursPlanned: 2, totalHoursRequested: 2 });
    if (approved) {
      const r = await request(app)
        .post(`/api/admin/monte-ore/${proposal.id}/approve`)
        .set('Authorization', admin.authHeader)
        .send({});
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    return { teacher, admin, room, otherRoom, proposal, slots };
  }

  const post = (ctx, url, body = {}) =>
    request(app).post(url).set('Authorization', ctx.teacher.authHeader).send(body);

  describe('POST /me/slots/:id/change-time', () => {
    it('404 slot inesistente, 403 slot di un altro docente', async () => {
      const ctx = await setup();
      expect((await post(ctx, '/api/monte-ore/me/slots/999999/change-time', {})).status).toBe(404);
      const other = await createAuthedUser({ role: 'docente' });
      const res = await request(app)
        .post(`/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`)
        .set('Authorization', other.authHeader)
        .send({ startTime: '10:00' });
      expect(res.status).toBe(403);
    });

    it('400 INVALID_STATE se la proposta non è ancora approvata', async () => {
      const ctx = await setup({ approved: false });
      const res = await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`, {
        startTime: '10:00',
        endTime: '11:00',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_STATE');
    });

    it('400 SLOT_LOCKED su cella bloccata', async () => {
      const ctx = await setup();
      const res = await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[3].id}/change-time`, {
        startTime: '10:00',
      });
      expect(res.body.code).toBe('SLOT_LOCKED');
    });

    it('validazione orari', async () => {
      const ctx = await setup();
      const url = `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`;
      expect((await post(ctx, url, {})).status).toBe(400);
      expect((await post(ctx, url, { startTime: '9', endTime: '10:00' })).status).toBe(400);
      expect((await post(ctx, url, { startTime: '11:00', endTime: '10:00' })).status).toBe(400);
    });

    it('201 crea una variazione pendente con il payload completo', async () => {
      const ctx = await setup();
      const res = await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`, {
        startTime: '10:00',
        endTime: '11:00',
        notes: 'Esigenza didattica',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.amendment).toMatchObject({ status: 'pending' });
      const row = await MonteOreAmendment.findByPk(res.body.amendment.id);
      expect(row.proposalId).toBe(ctx.proposal.id);
    });
  });

  describe('POST /me/slots/:id/change-room', () => {
    it('400 se roomId non valido o aula inesistente', async () => {
      const ctx = await setup();
      const url = `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-room`;
      expect((await post(ctx, url, {})).status).toBe(400);
      expect((await post(ctx, url, { roomId: -3 })).status).toBe(400);
      const missing = await post(ctx, url, { roomId: 999999 });
      expect(missing.body.code).toBe('ROOM_NOT_FOUND');
    });

    it('201 con aula valida', async () => {
      const ctx = await setup();
      const res = await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-room`, {
        roomId: ctx.otherRoom.id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.amendment.status).toBe('pending');
    });
  });

  describe('POST /me/slots/:id/move-to', () => {
    const url = (ctx, i = 0) => `/api/monte-ore/me/slots/${ctx.slots[i].id}/move-to`;

    it('rifiuta sorgente non attiva, target mancante/uguale/inesistente/bloccato/attivo', async () => {
      const ctx = await setup();
      expect((await post(ctx, url(ctx, 2), { targetSlotId: ctx.slots[0].id })).body.code).toBe(
        'SOURCE_NOT_ACTIVE',
      );
      expect((await post(ctx, url(ctx, 0), {})).status).toBe(400);
      expect((await post(ctx, url(ctx, 0), { targetSlotId: ctx.slots[0].id })).status).toBe(400);
      expect((await post(ctx, url(ctx, 0), { targetSlotId: 999999 })).body.code).toBe(
        'TARGET_NOT_FOUND',
      );
      expect((await post(ctx, url(ctx, 0), { targetSlotId: ctx.slots[3].id })).body.code).toBe(
        'TARGET_LOCKED',
      );
      expect((await post(ctx, url(ctx, 0), { targetSlotId: ctx.slots[1].id })).body.code).toBe(
        'TARGET_ALREADY_ACTIVE',
      );
    });

    it('rifiuta un target di un’altra proposta', async () => {
      const ctx = await setup();
      const stranger = await MonteOreProposal.create({
        userId: (await createAuthedUser({ role: 'docente' })).user.id,
        academicYear: YEAR,
        validFrom: '2027-11-01',
        validTo: '2028-06-30',
        status: 'draft',
      });
      const foreign = await MonteOreSlot.create({
        proposalId: stranger.id,
        scheduleId: ctx.slots[0].scheduleId,
        date: '2027-11-29',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        isActive: false,
        isLocked: false,
      });
      const res = await post(ctx, url(ctx, 0), { targetSlotId: foreign.id });
      expect(res.body.code).toBe('TARGET_NOT_FOUND');
    });

    it('201 sposta su una cella libera', async () => {
      const ctx = await setup();
      const res = await post(ctx, url(ctx, 0), { targetSlotId: ctx.slots[2].id });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.amendment.status).toBe('pending');
    });
  });

  describe('POST /me/amendments/add-new-day', () => {
    const url = '/api/monte-ore/me/amendments/add-new-day';
    const valid = { year: YEAR, date: '2027-12-04', startTime: '09:00', endTime: '10:00' };

    it('404 senza proposta e 400 se non approvata', async () => {
      const ctx = await setup({ approved: false });
      expect((await post(ctx, url, { ...valid, year: '2040/2041' })).status).toBe(404);
      const res = await post(ctx, url, valid);
      expect(res.body.code).toBe('INVALID_STATE');
    });

    it('validazione campi, formati e ordine orari', async () => {
      const ctx = await setup();
      expect((await post(ctx, url, { year: YEAR })).status).toBe(400);
      expect((await post(ctx, url, { ...valid, date: '04/12/2027' })).status).toBe(400);
      expect((await post(ctx, url, { ...valid, startTime: '9am' })).status).toBe(400);
      expect((await post(ctx, url, { ...valid, startTime: '11:00' })).status).toBe(400);
    });

    it('400 se il piano risultante non rispetta le ore esatte del contratto', async () => {
      const ctx = await setup();
      const res = await post(ctx, url, valid);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('HOURS_NOT_MATCHING_CONTRACT');
    });

    it('201 crea la richiesta (aula opzionale) con contratto a ore minime', async () => {
      const ctx = await setup();
      await ctx.proposal.update({
        contractSnapshot: { mode: 'minimum', minHours: 2, bypassDayConstraint: true },
      });
      const res = await post(ctx, url, { ...valid, notes: 'Recupero' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.amendment.kind).toBe('add_new_day');
      expect(res.body.amendment.payload).toMatchObject({
        date: '2027-12-04',
        roomId: null,
        bookingType: 'lezione',
      });
    });
  });

  describe('POST /me/slots/select', () => {
    // Proposta editabile (non approvata) per poter selezionare in blocco.
    const url = '/api/monte-ore/me/slots/select';

    it('400 su periodo o selezione non validi', async () => {
      const ctx = await setup({ approved: false });
      await ctx.proposal.update({ status: 'draft' });
      const base = { academicYear: YEAR };
      expect(
        (await post(ctx, url, { ...base, dateFrom: 'x', dateTo: '2027-11-30', isActive: true }))
          .status,
      ).toBe(400);
      expect(
        (
          await post(ctx, url, {
            ...base,
            dateFrom: '2027-11-30',
            dateTo: '2027-11-01',
            isActive: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(ctx, url, {
            ...base,
            dateFrom: '2027-11-01',
            dateTo: '2027-11-30',
            isActive: 'si',
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('POST /me/slots/select (successo)', () => {
    it('attiva in blocco le celle sbloccate del periodo e ricalcola le ore', async () => {
      const ctx = await setup({ approved: false });
      await ctx.proposal.update({ status: 'draft' });
      const res = await post(ctx, '/api/monte-ore/me/slots/select', {
        academicYear: YEAR,
        dateFrom: '2027-11-01',
        dateTo: '2027-11-30',
        isActive: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const slots = await MonteOreSlot.findAll({ where: { proposalId: ctx.proposal.id } });
      expect(slots.filter((s) => s.isActive)).toHaveLength(3); // la cella bloccata resta inattiva
      expect(Number((await ctx.proposal.reload()).totalHoursPlanned)).toBe(3);
    });

    it('filtra per giorno della settimana e valida il valore', async () => {
      const ctx = await setup({ approved: false });
      await ctx.proposal.update({ status: 'draft' });
      const body = {
        academicYear: YEAR,
        dateFrom: '2027-11-01',
        dateTo: '2027-11-30',
        isActive: false,
      };
      expect(
        (await post(ctx, '/api/monte-ore/me/slots/select', { ...body, dayOfWeek: 7 })).status,
      ).toBe(400);
      const ok = await post(ctx, '/api/monte-ore/me/slots/select', { ...body, dayOfWeek: 1 });
      expect(ok.status).toBe(200);
      expect(Number((await ctx.proposal.reload()).totalHoursPlanned)).toBe(0);
    });
  });

  describe('GET /me/amendments', () => {
    it('lista vuota senza proposta', async () => {
      const ctx = await setup();
      const res = await request(app)
        .get('/api/monte-ore/me/amendments?year=2040/2041')
        .set('Authorization', ctx.teacher.authHeader);
      expect(res.body).toEqual({ amendments: [] });
    });

    it('elenca le variazioni con il budget residuo', async () => {
      const ctx = await setup();
      await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`, {
        startTime: '10:00',
        endTime: '11:00',
      });
      const res = await request(app)
        .get(`/api/monte-ore/me/amendments?year=${YEAR}`)
        .set('Authorization', ctx.teacher.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.amendments).toHaveLength(1);
      expect(res.body.budget).toMatchObject({ maximum: 20, used: 1, remaining: 19 });
    });
  });

  describe('Admin — vista globale variazioni', () => {
    it('lista con filtri status/proposalId e conteggio dei pendenti', async () => {
      const ctx = await setup();
      await post(ctx, `/api/monte-ore/me/slots/${ctx.slots[0].id}/change-time`, {
        startTime: '10:00',
        endTime: '11:00',
      });
      const admin = (u) => request(app).get(u).set('Authorization', ctx.admin.authHeader);

      const all = await admin('/api/admin/monte-ore/amendments');
      expect(all.status).toBe(200);
      expect(all.body.amendments).toHaveLength(1);
      expect(all.body.amendments[0]).toMatchObject({ status: 'pending' });

      expect(
        (await admin('/api/admin/monte-ore/amendments?status=pending')).body.amendments,
      ).toHaveLength(1);
      expect(
        (await admin('/api/admin/monte-ore/amendments?status=rejected')).body.amendments,
      ).toHaveLength(0);
      expect(
        (await admin(`/api/admin/monte-ore/amendments?proposalId=${ctx.proposal.id}`)).body
          .amendments,
      ).toHaveLength(1);
      expect(
        (await admin('/api/admin/monte-ore/amendments?proposalId=999999')).body.amendments,
      ).toHaveLength(0);

      expect((await admin('/api/admin/monte-ore/amendments/pending/count')).body).toEqual({
        count: 1,
      });
    });

    it('401 senza sessione e 403 per i docenti', async () => {
      const ctx = await setup();
      expect((await request(app).get('/api/admin/monte-ore/amendments')).status).toBe(401);
      const res = await request(app)
        .get('/api/admin/monte-ore/amendments/pending/count')
        .set('Authorization', ctx.teacher.authHeader);
      expect(res.status).toBe(403);
    });
  });
});
