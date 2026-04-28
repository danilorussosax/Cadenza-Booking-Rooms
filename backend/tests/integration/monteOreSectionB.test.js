'use strict';

/**
 * Integrazione: Monte Ore — flusso "Sezione B" (settings + griglia + amendments).
 *
 * Copre:
 *   - admin: GET/PUT settings, POST/DELETE suspensions
 *   - docente: GET calendar, POST regenerate-slots, GET slots, POST toggle
 *   - amendments auto-approved (originalActive=true) e pending (originalActive=false)
 *   - admin: approve/reject di amendments pending
 *   - submit con validazioni 2-4 giorni e soglia ore
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Institute, MonteOreSettings, MonteOreSuspension, MonteOreSlot } = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');

describe('Monte Ore — Sezione B (calendar + slots + amendments)', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setupSettings({ academicYear = '2025/2026', minRequiredHours = 8 } = {}) {
    const institute = await Institute.create({
      name: 'Test Inst',
      code: 'TI',
      city: 'X',
      country: 'IT',
    });
    return MonteOreSettings.create({
      instituteId: institute.id,
      academicYear,
      academicYearStart: '2025-11-01',
      academicYearEnd: '2026-10-31',
      lessonsStartDate: '2025-11-03', // lunedì
      lessonsEndDate: '2025-11-30', // 4 settimane
      submissionWindowStart: '2025-09-01',
      submissionWindowEnd: '2030-12-31',
      minRequiredHours,
      maxAmendmentsPerYear: 3,
    });
  }

  it('admin settings + suspensions: CRUD funzionante', async () => {
    await Institute.create({ name: 'X', code: 'X', city: 'X', country: 'IT' });
    const { authHeader: adminHeader } = await createAdmin();

    // GET autocrea le settings
    const get = await request(app)
      .get('/api/admin/monte-ore/settings?academicYear=2025/2026')
      .set('Authorization', adminHeader);
    expect(get.status).toBe(200);
    expect(get.body.settings.academicYear).toBe('2025/2026');

    // PUT aggiorna minRequiredHours
    const put = await request(app)
      .put('/api/admin/monte-ore/settings')
      .set('Authorization', adminHeader)
      .send({ academicYear: '2025/2026', minRequiredHours: 100, lessonsEndDate: '2026-06-30' });
    expect(put.status).toBe(200);
    expect(put.body.settings.minRequiredHours).toBe(100);

    // POST suspension
    const create = await request(app)
      .post('/api/admin/monte-ore/suspensions')
      .set('Authorization', adminHeader)
      .send({
        academicYear: '2025/2026',
        name: 'Natale',
        dateFrom: '2025-12-22',
        dateTo: '2026-01-06',
        kind: 'full_week',
      });
    expect(create.status).toBe(201);
    const suspId = create.body.suspension.id;

    // LIST
    const list = await request(app)
      .get('/api/admin/monte-ore/suspensions?academicYear=2025/2026')
      .set('Authorization', adminHeader);
    expect(list.body.suspensions).toHaveLength(1);

    // DELETE
    await request(app)
      .delete(`/api/admin/monte-ore/suspensions/${suspId}`)
      .set('Authorization', adminHeader)
      .expect(200);
  });

  it('docente: calendar + regenerate-slots + toggle in draft (logica additiva)', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    // 1) GET /me crea draft
    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    expect(me.status).toBe(200);

    // 2) Pattern: lun 10-12 e mer 14-16 (2 giorni → ok 2-4)
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' })
      .expect(201);
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' })
      .expect(201);

    // 3) GET /me/calendar — 4 settimane Lun-Ven dal 3 nov
    const cal = await request(app)
      .get('/api/monte-ore/me/calendar?year=2025/2026')
      .set('Authorization', docHeader);
    expect(cal.status).toBe(200);
    expect(cal.body.weeks.length).toBeGreaterThanOrEqual(4);

    // 4) Regenerate slots — TUTTI nascono INATTIVI
    const regen = await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    expect(regen.status).toBe(200);
    expect(regen.body.result.created).toBeGreaterThanOrEqual(7);

    // 5) GET slots — verifica default isActive=false
    const slotsResp = await request(app)
      .get('/api/monte-ore/me/slots?year=2025/2026')
      .set('Authorization', docHeader);
    const slots = slotsResp.body.slots;
    expect(slots.length).toBeGreaterThanOrEqual(7);
    expect(slots.every((s) => s.isActive === false)).toBe(true);

    // 6) Toggle 2 slot da inattivi → attivi (4h totali, sopra soglia)
    const tog1 = await request(app)
      .post(`/api/monte-ore/me/slots/${slots[0].id}/toggle`)
      .set('Authorization', docHeader)
      .send({});
    expect(tog1.status).toBe(200);
    expect(tog1.body.slot.isActive).toBe(true);

    await request(app)
      .post(`/api/monte-ore/me/slots/${slots[1].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);

    // 7) Submit con 4h ≥ soglia 4h → ok
    const sub = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({});
    expect(sub.status).toBe(200);
    expect(sub.body.proposal.status).toBe('submitted');
  });

  it('docente: submit fallisce se solo 1 giorno o ore < soglia', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 100 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader);
    // 1 solo giorno → WORKING_DAYS_OUT_OF_RANGE
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    const r1 = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({});
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe('WORKING_DAYS_OUT_OF_RANGE');

    // Aggiunge 2° giorno, regenera slot, ma ore totali < 100 → HOURS_BELOW_THRESHOLD
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const r2 = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({});
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('HOURS_BELOW_THRESHOLD');
  });

  it('amendments: toggle_off su slot originalActive=true → auto_approved', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});

    // Logica additiva: attivo 2 slot (4h, sopra soglia)
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    const activatedId = draftSlots[0].id;
    await request(app)
      .post(`/api/monte-ore/me/slots/${activatedId}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[1].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);

    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/admin/monte-ore/${id}/approve`)
      .set('Authorization', adminHeader)
      .send({})
      .expect(200);

    // Snapshot: solo gli slot attivati hanno originalActive=true
    const slotsAfterApprove = await MonteOreSlot.findAll({ where: { proposalId: id } });
    const activeAfterApprove = slotsAfterApprove.filter((s) => s.originalActive);
    expect(activeAfterApprove).toHaveLength(2);

    // Docente toggle_off su uno slot originalActive=true → auto_approved
    const tog = await request(app)
      .post(`/api/monte-ore/me/slots/${activatedId}/toggle`)
      .set('Authorization', docHeader)
      .send({});
    expect(tog.status).toBe(201);
    expect(tog.body.amendment.status).toBe('auto_approved');
    expect(tog.body.slot.isActive).toBe(false);
  });

  it('amendments: toggle_on su slot originalActive=false → pending, admin approva', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});

    // Logica additiva: attivo slot[1] e slot[2] (4h totali) ma LASCIO slot[0]
    // inattivo: dopo l'approve, slot[0].originalActive sarà false.
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    const targetId = draftSlots[0].id;
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[1].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[2].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);

    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/admin/monte-ore/${id}/approve`)
      .set('Authorization', adminHeader)
      .send({})
      .expect(200);

    const target = await MonteOreSlot.findByPk(targetId);
    expect(target.originalActive).toBe(false);

    // Docente vuole aggiungerlo → toggle_on con originalActive=false → pending
    const tog = await request(app)
      .post(`/api/monte-ore/me/slots/${targetId}/toggle`)
      .set('Authorization', docHeader)
      .send({ notes: 'recupero lezione' });
    expect(tog.status).toBe(201);
    expect(tog.body.amendment.status).toBe('pending');
    // Lo slot NON deve essere ancora attivato
    expect(tog.body.slot.isActive).toBe(false);

    // Admin lista pending
    const aid = tog.body.amendment.id;
    const list = await request(app)
      .get(`/api/admin/monte-ore/${id}/amendments`)
      .set('Authorization', adminHeader);
    expect(list.body.amendments).toHaveLength(1);

    // Admin approva
    const apv = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`)
      .set('Authorization', adminHeader)
      .send({});
    expect(apv.status).toBe(200);
    expect(apv.body.amendment.status).toBe('approved');

    // Lo slot ora è attivo
    const reload = await MonteOreSlot.findByPk(targetId);
    expect(reload.isActive).toBe(true);
  });

  it('amendments: admin reject', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});

    // Attivo 2 slot per superare la soglia (4h), lasciando target inattivo.
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    const targetId = draftSlots[0].id;
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[1].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[2].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);

    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/admin/monte-ore/${id}/approve`)
      .set('Authorization', adminHeader)
      .send({})
      .expect(200);

    // Toggle_on su target (originalActive=false) → pending
    const tog = await request(app)
      .post(`/api/monte-ore/me/slots/${targetId}/toggle`)
      .set('Authorization', docHeader)
      .send({});
    const aid = tog.body.amendment.id;

    const rej = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/reject`)
      .set('Authorization', adminHeader)
      .send({ reason: 'Aula non disponibile' });
    expect(rej.status).toBe(200);
    expect(rej.body.amendment.status).toBe('rejected');
    expect(rej.body.amendment.rejectionReason).toBe('Aula non disponibile');
  });

  it('suspension full_week nasconde settimana dalla griglia', async () => {
    await createBookingRule({ role: 'docente' });
    const settings = await setupSettings({ minRequiredHours: 8 });
    // Suspension full_week che copre la 1ª settimana (3-8 nov)
    await MonteOreSuspension.create({
      instituteId: settings.instituteId,
      academicYear: '2025/2026',
      name: 'Test full',
      dateFrom: '2025-11-03',
      dateTo: '2025-11-08',
      kind: 'full_week',
    });
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    const cal = await request(app)
      .get('/api/monte-ore/me/calendar?year=2025/2026')
      .set('Authorization', docHeader);
    expect(cal.status).toBe(200);
    // La 1ª settimana (3 nov) NON deve esserci
    const weekStarts = cal.body.weeks.map((w) => w.weekStart);
    expect(weekStarts).not.toContain('2025-11-03');
    expect(weekStarts).toContain('2025-11-10'); // 2ª settimana presente
  });

  it('suspension partial blocca giorno specifico (isLocked=true)', async () => {
    await createBookingRule({ role: 'docente' });
    const settings = await setupSettings({ minRequiredHours: 8 });
    await MonteOreSuspension.create({
      instituteId: settings.instituteId,
      academicYear: '2025/2026',
      name: 'Festa di prova',
      dateFrom: '2025-11-04',
      dateTo: '2025-11-04',
      kind: 'partial',
    });
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    const cal = await request(app)
      .get('/api/monte-ore/me/calendar?year=2025/2026')
      .set('Authorization', docHeader);
    const week1 = cal.body.weeks.find((w) => w.weekStart === '2025-11-03');
    expect(week1).toBeTruthy();
    const tue = week1.days.find((d) => d.date === '2025-11-04');
    expect(tue.isLocked).toBe(true);
    expect(tue.lockReason).toBe('Festa di prova');
  });
});
