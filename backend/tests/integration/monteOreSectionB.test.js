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
const {
  Institute,
  MonteOreSettings,
  MonteOreSuspension,
  MonteOreSlot,
  MonteOreProposal,
} = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');

describe('Monte Ore — Sezione B (calendar + slots + amendments)', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setupSettings({
    academicYear = '2025/2026',
    minRequiredHours = 8,
    maxAmendmentsPerYear = 3,
  } = {}) {
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
      maxAmendmentsPerYear,
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

  it('amendments: toggle_on su slot del pattern settimanale (originalActive=false) → auto_approved', async () => {
    // Nuova logica: il docente può sostituire un giorno deselezionato con un
    // altro giorno dello STESSO pattern settimanale (stesso dayOfWeek + stesso
    // slot orario, varia solo la data) senza coinvolgere il coordinatore.
    // Usato p.es. per riassorbire ore dopo un toggle_off di un giorno del piano.
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

    // Attivo 2 slot, lascio gli altri inattivi: dopo l'approve, gli slot non
    // selezionati avranno originalActive=false ma scheduleId valorizzato.
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
    expect(target.scheduleId).not.toBeNull();

    // toggle_on su slot dentro il pattern (scheduleId valorizzato): auto-approved
    const tog = await request(app)
      .post(`/api/monte-ore/me/slots/${targetId}/toggle`)
      .set('Authorization', docHeader)
      .send({});
    expect(tog.status).toBe(201);
    expect(tog.body.amendment.status).toBe('auto_approved');
    expect(tog.body.slot.isActive).toBe(true);
  });

  it('add_new_day: docente richiede giorno fuori pattern → pending; admin approva → slot creato', async () => {
    // Caso "fuori pattern": il docente richiede un giorno+orario non incluso
    // nel pattern settimanale approvato. Va sempre via richiesta al coordinatore.
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
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
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

    // Richiesta add_new_day: venerdì 09-11, fuori dal pattern (lun + mer)
    const req1 = await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({
        date: '2025-11-07', // venerdì
        startTime: '09:00',
        endTime: '11:00',
        roomId: room.id,
        bookingType: 'lezione',
        notes: 'recupero',
      });
    expect(req1.status).toBe(201);
    expect(req1.body.amendment.status).toBe('pending');
    expect(req1.body.amendment.kind).toBe('add_new_day');
    expect(req1.body.amendment.slotId).toBeNull();

    const aid = req1.body.amendment.id;
    const apv = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`)
      .set('Authorization', adminHeader)
      .send({});
    expect(apv.status).toBe(200);
    expect(apv.body.amendment.status).toBe('approved');

    // Verifica che lo slot fuori-pattern sia stato creato
    const newSlots = await MonteOreSlot.findAll({
      where: { proposalId: id, scheduleId: null },
    });
    expect(newSlots).toHaveLength(1);
    expect(newSlots[0].date).toBe('2025-11-07');
    expect(newSlots[0].startTime).toBe('09:00');
    expect(newSlots[0].endTime).toBe('11:00');
    expect(newSlots[0].isActive).toBe(true);
    expect(newSlots[0].originalActive).toBe(false);
    expect(newSlots[0].roomId).toBe(room.id);
  });

  it('amendmentCount: deselezioni non consumano budget; aggiunte sì (sostituzione = 1)', async () => {
    // La sostituzione "deseleziono A + seleziono B" deve contare come UNA
    // sola modifica, non due. Le deselezioni liberano ore e non spendono
    // il budget annuale.
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
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    // Approve con 2 slot attivi
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
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

    // Sostituzione: deseleziono draftSlots[0] (toggle_off) + seleziono
    // draftSlots[2] (toggle_on, stesso pattern). Conta come 1 modifica.
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(201);
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[2].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(201);
    let p = await MonteOreProposal.findByPk(id);
    expect(p.amendmentCount).toBe(1);

    // Una seconda sostituzione → 2
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[1].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(201);
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[3].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(201);
    p = await MonteOreProposal.findByPk(id);
    expect(p.amendmentCount).toBe(2);
  });

  it('amendmentCount: rifiuta toggle_on quando si supera maxAmendmentsPerYear (atomic UPDATE)', async () => {
    // Setup con limite stretto = 1: il secondo toggle_on (sostituzione) deve
    // essere rifiutato con AMENDMENT_LIMIT_REACHED, atomicamente.
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4, maxAmendmentsPerYear: 1 });
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
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
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

    // 1ª aggiunta: passa
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[2].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(201);
    // 2ª aggiunta: limite raggiunto
    const r2 = await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[3].id}/toggle`)
      .set('Authorization', docHeader)
      .send({});
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('AMENDMENT_LIMIT_REACHED');
    // Counter resta a 1 (atomic update non ha incrementato sulla 2ª)
    const p = await MonteOreProposal.findByPk(id);
    expect(p.amendmentCount).toBe(1);
  });

  it('add_new_day: rifiuta payload incompleto', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    // Due pattern (mar + gio) per soddisfare la regola "almeno 2 giorni"
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 2, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 4, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const slots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    await request(app)
      .post(`/api/monte-ore/me/slots/${slots[0].id}/toggle`)
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/monte-ore/me/slots/${slots[1].id}/toggle`)
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

    // Mancante data
    await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({ startTime: '09:00', endTime: '11:00', roomId: room.id })
      .expect(400);

    // Orario inverso
    await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({
        date: '2025-11-07',
        startTime: '11:00',
        endTime: '09:00',
        roomId: room.id,
      })
      .expect(400);

    // roomId opzionale: senza aula passa (sarà l'admin ad assegnarla)
    await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({ date: '2025-11-07', startTime: '09:00', endTime: '11:00' })
      .expect(201);
  });

  it('model validators: MonteOreSlot scheduleId NULL richiede roomId+bookingType', async () => {
    const settings = await setupSettings({ minRequiredHours: 4 });
    const { user } = await createAuthedUser({ role: 'docente' });
    const proposal = await require('../../models').MonteOreProposal.create({
      userId: user.id,
      academicYear: settings.academicYear,
      validFrom: settings.lessonsStartDate,
      validTo: settings.lessonsEndDate,
      status: 'draft',
    });
    // scheduleId NULL + roomId/bookingType NULL → throw del validator
    await expect(
      MonteOreSlot.create({
        proposalId: proposal.id,
        scheduleId: null,
        date: '2025-11-07',
        dayOfWeek: 5,
        startTime: '09:00',
        endTime: '11:00',
        isActive: true,
        isLocked: false,
        originalActive: false,
      }),
    ).rejects.toThrow(/roomId e bookingType obbligatori/);
  });

  it('model validators: MonteOreAmendment add_new_day richiede payload completo', async () => {
    const settings = await setupSettings({ minRequiredHours: 4 });
    const { user } = await createAuthedUser({ role: 'docente' });
    const { MonteOreProposal, MonteOreAmendment: AmendmentModel } = require('../../models');
    const proposal = await MonteOreProposal.create({
      userId: user.id,
      academicYear: settings.academicYear,
      validFrom: settings.lessonsStartDate,
      validTo: settings.lessonsEndDate,
      status: 'approved',
    });
    await expect(
      AmendmentModel.create({
        proposalId: proposal.id,
        requesterId: user.id,
        kind: 'add_new_day',
        payload: { date: '2025-11-07' }, // mancano startTime/endTime
        status: 'pending',
      }),
    ).rejects.toThrow(/add_new_day.*date, startTime, endTime/);
  });

  it('add_new_day: admin assegna aula in fase di approvazione', async () => {
    // Docente richiede un nuovo giorno SENZA indicare l'aula. L'admin la
    // assegna passando roomId nel body dell'approve.
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const room1 = await createRoom();
    const room2 = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room1.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room1.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
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

    // Richiesta SENZA roomId
    const r1 = await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({ date: '2025-11-07', startTime: '09:00', endTime: '11:00' });
    expect(r1.status).toBe(201);
    expect(r1.body.amendment.payload.roomId).toBeNull();
    const aid = r1.body.amendment.id;

    // Approve senza roomId → 400 (servirebbe aula)
    const noRoom = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`)
      .set('Authorization', adminHeader)
      .send({});
    expect(noRoom.status).toBe(400);
    expect(noRoom.body.code).toBe('ROOM_REQUIRED');

    // Approve con roomId nel body → ok
    const ok = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`)
      .set('Authorization', adminHeader)
      .send({ roomId: room2.id });
    expect(ok.status).toBe(200);
    expect(ok.body.amendment.status).toBe('approved');
    expect(ok.body.amendment.payload.roomId).toBe(room2.id);

    // Slot creato con l'aula assegnata dall'admin
    const newSlots = await MonteOreSlot.findAll({
      where: { proposalId: id, scheduleId: null },
    });
    expect(newSlots).toHaveLength(1);
    expect(newSlots[0].roomId).toBe(room2.id);
  });

  it('add_new_day: admin override aula proposta dal docente', async () => {
    await createBookingRule({ role: 'docente' });
    await setupSettings({ minRequiredHours: 4 });
    const roomDoc = await createRoom();
    const roomAdmin = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const me = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    const id = me.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: roomDoc.id, dayOfWeek: 1, startTime: '10:00', endTime: '12:00' });
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: roomDoc.id, dayOfWeek: 3, startTime: '14:00', endTime: '16:00' });
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
    await request(app)
      .post(`/api/monte-ore/me/slots/${draftSlots[0].id}/toggle`)
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

    // Docente propone roomDoc; admin sovrascrive con roomAdmin
    const r1 = await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({
        date: '2025-11-07',
        startTime: '09:00',
        endTime: '11:00',
        roomId: roomDoc.id,
      });
    const aid = r1.body.amendment.id;

    const ok = await request(app)
      .post(`/api/admin/monte-ore/${id}/amendments/${aid}/approve`)
      .set('Authorization', adminHeader)
      .send({ roomId: roomAdmin.id });
    expect(ok.status).toBe(200);
    expect(ok.body.amendment.payload.roomId).toBe(roomAdmin.id);
    expect(ok.body.amendment.payload.roomIdAssignedBy).toBe('admin');

    const newSlot = await MonteOreSlot.findOne({
      where: { proposalId: id, scheduleId: null },
    });
    expect(newSlot.roomId).toBe(roomAdmin.id);
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

    const draftSlots = await MonteOreSlot.findAll({
      where: { proposalId: id },
      order: [['date', 'ASC']],
    });
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

    // Richiesta add_new_day (sempre pending → testiamo il reject)
    const req1 = await request(app)
      .post('/api/monte-ore/me/amendments/add-new-day')
      .set('Authorization', docHeader)
      .send({
        date: '2025-11-07',
        startTime: '09:00',
        endTime: '11:00',
        roomId: room.id,
      });
    const aid = req1.body.amendment.id;

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
