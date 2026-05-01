'use strict';

/**
 * Integrazione: Monte Ore — deroga per docenti a contratto orario.
 *
 * Copre:
 *   - PUT /api/users/:id/monte-ore-override (admin)
 *   - validazione: motivo obbligatorio, range 0-1500, ruolo docente
 *   - submit con override individuale: accetta < 324h, rifiuta < soglia personalizzata
 *   - bypass del vincolo 2-4 giorni per contratto orario monoday
 *   - snapshot personalizzato (minRequiredHoursSnapshot riflette il valore risolto)
 *   - GET /api/monte-ore/me/threshold restituisce la soglia risolta
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Institute, MonteOreSettings, MonteOreSlot, User } = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');

describe('Monte Ore — deroga docenti a contratto orario', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  /**
   * Setup helper: crea Institute + MonteOreSettings con minRequiredHours
   * di default 324, finestra di submit aperta. Restituisce il record.
   */
  async function setupSettings({ academicYear = '2025/2026', minRequiredHours = 324 } = {}) {
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
      // 30 settimane di lezione, ampie a sufficienza per coprire 324h con 2 giorni
      lessonsStartDate: '2025-11-03',
      lessonsEndDate: '2026-06-26',
      submissionWindowStart: '2025-09-01',
      submissionWindowEnd: '2030-12-31',
      minRequiredHours,
      maxAmendmentsPerYear: 3,
    });
  }

  it('PUT override richiede ruolo docente: 400 su studente', async () => {
    const { user: stud } = await createAuthedUser({ role: 'studente' });
    const { authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .put(`/api/users/${stud.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 60,
        monteOreOverrideReason: 'test',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WRONG_ROLE');
  });

  it('PUT override senza motivazione quando si imposta hours: 400', async () => {
    const { user: doc } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({ monteOreAnnualHoursOverride: 60 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OVERRIDE_REASON_REQUIRED');
  });

  it('PUT override fuori range (0-1500): 400', async () => {
    const { user: doc } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        monteOreAnnualHoursOverride: 2000,
        monteOreOverrideReason: 'troppo alto',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OVERRIDE_OUT_OF_RANGE');
  });

  it('PUT override valido: persiste hours, bypass, reason, setBy/setAt', async () => {
    const { user: doc } = await createAuthedUser({ role: 'docente' });
    const { user: admin, authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 60,
        monteOreBypassDayConstraint: true,
        monteOreOverrideReason: 'Contratto orario 60h - prot. 2026/123',
      });
    expect(res.status).toBe(200);

    const refreshed = await User.findByPk(doc.id);
    expect(Number(refreshed.monteOreAnnualHoursOverride)).toBe(60);
    expect(refreshed.monteOreBypassDayConstraint).toBe(true);
    expect(refreshed.contractType).toBe('contratto_orario');
    expect(refreshed.monteOreOverrideReason).toMatch(/prot\. 2026\/123/);
    expect(refreshed.monteOreOverrideSetBy).toBe(admin.id);
    expect(refreshed.monteOreOverrideSetAt).toBeTruthy();
  });

  it('GET /me/threshold senza override: source=institute_settings, minHours=324', async () => {
    await setupSettings();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    const res = await request(app)
      .get('/api/monte-ore/me/threshold?year=2025/2026')
      .set('Authorization', docHeader);
    expect(res.status).toBe(200);
    expect(res.body.minHours).toBe(324);
    expect(res.body.source).toBe('institute_settings');
    expect(res.body.bypassDayConstraint).toBe(false);
  });

  it('GET /me/threshold con override: source=user_override, minHours=60', async () => {
    await setupSettings();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 60,
        monteOreBypassDayConstraint: true,
        monteOreOverrideReason: 'Contratto 60h',
      });

    const res = await request(app)
      .get('/api/monte-ore/me/threshold?year=2025/2026')
      .set('Authorization', docHeader);
    expect(res.status).toBe(200);
    expect(res.body.minHours).toBe(60);
    expect(res.body.source).toBe('user_override');
    expect(res.body.bypassDayConstraint).toBe(true);
    expect(res.body.contractType).toBe('contratto_orario');
  });

  it('docente con override 60h e bypass: submit accetta pattern monoday < 324h', async () => {
    await setupSettings();
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    const room = await createRoom();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // Imposta override: 60h annue + bypass
    await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 60,
        monteOreBypassDayConstraint: true,
        monteOreOverrideReason: 'Contratto orario 60h',
      });

    // GET /me autocrea proposal
    const get = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    expect(get.status).toBe(200);

    // Aggiungi UN solo giorno (lunedì 14:00-16:00, 2h × ~30 settimane = 60h)
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({
        roomId: room.id,
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '16:00',
        bookingType: 'lezione',
      })
      .expect(201);

    // Rigenera slot per popolare la griglia (gli slot nascono inattivi per
    // design — vanno attivati uno per uno via toggleSlot dalla griglia. Per
    // velocità nel test li attiviamo tutti via UPDATE diretto).
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const proposal = (
      await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader)
    ).body.proposal;
    await MonteOreSlot.update(
      { isActive: true },
      { where: { proposalId: proposal.id, isLocked: false }, validate: false },
    );

    // Submit: deve passare anche se 1 solo giorno e <324h
    const submit = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({ academicYear: '2025/2026' });
    expect(submit.status).toBe(200);
    expect(submit.body.proposal.status).toBe('submitted');
    // Snapshot DEVE riflettere la soglia personalizzata, non 324
    expect(submit.body.proposal.minRequiredHoursSnapshot).toBe(60);
    // workingDaysCount deve essere null in modalità bypass
    expect(submit.body.proposal.workingDaysCount).toBe(null);
  });

  it('docente con override 60h: submit rifiuta proposta da 30h (< override)', async () => {
    // Settings con orizzonte breve (4 settimane) per limitare le ore generate
    const institute = await Institute.create({
      name: 'X',
      code: 'X',
      city: 'X',
      country: 'IT',
    });
    await MonteOreSettings.create({
      instituteId: institute.id,
      academicYear: '2025/2026',
      academicYearStart: '2025-11-01',
      academicYearEnd: '2026-10-31',
      lessonsStartDate: '2025-11-03',
      lessonsEndDate: '2025-11-30', // 4 settimane × 1h = ~4h
      submissionWindowStart: '2025-09-01',
      submissionWindowEnd: '2030-12-31',
      minRequiredHours: 4,
      maxAmendmentsPerYear: 3,
    });
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    const room = await createRoom();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // Override a 60h: > delle ~4h producibili in 4 settimane
    await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 60,
        monteOreBypassDayConstraint: true,
        monteOreOverrideReason: 'Contratto 60h',
      });

    await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader);
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({
        roomId: room.id,
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '15:00',
        bookingType: 'lezione',
      })
      .expect(201);
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});

    const submit = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({ academicYear: '2025/2026' });
    expect(submit.status).toBe(400);
    expect(submit.body.code).toBe('HOURS_BELOW_THRESHOLD');
    expect(submit.body.error).toMatch(/60/);
    // Messaggio deve indicare che è una soglia personalizzata
    expect(submit.body.error).toMatch(/personalizzata/i);
  });

  it('docente titolare senza override: vincolo 2-4 giorni resta attivo', async () => {
    await setupSettings({ minRequiredHours: 1 });
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });

    await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader);
    // Solo 1 giorno: dovrebbe fallire
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({
        roomId: room.id,
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '15:00',
        bookingType: 'lezione',
      })
      .expect(201);

    const submit = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({ academicYear: '2025/2026' });
    expect(submit.status).toBe(400);
    expect(submit.body.code).toBe('WORKING_DAYS_OUT_OF_RANGE');
  });

  it('rimozione override: nuovi submit usano soglia istituzionale, snapshot esistente immutato', async () => {
    await setupSettings({ minRequiredHours: 4 });
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    const room = await createRoom();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // Imposta override
    await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: 'contratto_orario',
        monteOreAnnualHoursOverride: 4,
        monteOreBypassDayConstraint: true,
        monteOreOverrideReason: 'tmp',
      });

    // Submit con override (snapshot=4)
    await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader);
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({
        roomId: room.id,
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '17:00',
        bookingType: 'lezione',
      })
      .expect(201);
    await request(app)
      .post('/api/monte-ore/me/regenerate-slots')
      .set('Authorization', docHeader)
      .send({});
    const propBefore = (
      await request(app).get('/api/monte-ore/me?year=2025/2026').set('Authorization', docHeader)
    ).body.proposal;
    await MonteOreSlot.update(
      { isActive: true },
      { where: { proposalId: propBefore.id, isLocked: false }, validate: false },
    );
    const submit1 = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({ academicYear: '2025/2026' });
    expect(submit1.status).toBe(200);
    expect(submit1.body.proposal.minRequiredHoursSnapshot).toBe(4);

    // Rimuovi override (passa null/undefined; il backend deve azzerare)
    const removeRes = await request(app)
      .put(`/api/users/${doc.id}/monte-ore-override`)
      .set('Authorization', adminHeader)
      .send({
        contractType: null,
        monteOreAnnualHoursOverride: null,
        monteOreBypassDayConstraint: false,
        monteOreOverrideReason: null,
      });
    expect(removeRes.status).toBe(200);

    // Snapshot della proposta già submitted resta 4 (immutabile)
    const refreshed = await request(app)
      .get('/api/monte-ore/me?year=2025/2026')
      .set('Authorization', docHeader);
    expect(refreshed.body.proposal.minRequiredHoursSnapshot).toBe(4);

    // GET threshold ora torna a istituzionale
    const th = await request(app)
      .get('/api/monte-ore/me/threshold?year=2025/2026')
      .set('Authorization', docHeader);
    expect(th.body.source).toBe('institute_settings');
    expect(th.body.minHours).toBe(4);
  });
});
