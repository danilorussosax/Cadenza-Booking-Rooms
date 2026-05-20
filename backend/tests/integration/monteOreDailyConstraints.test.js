'use strict';

/**
 * Test: vincoli giornalieri Z2/Z3 (Regolamento Monte Ore Art. 2).
 *
 * Copre:
 *  - validateDailyConstraints come pura funzione (unit, no DB)
 *  - integrazione in POST /api/monte-ore/me/submit
 *  - coerenza cross-field su PUT /api/admin/monte-ore/settings
 *  - backward compat: settings con i nuovi campi NULL → nessun cambio comportamento
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Institute, MonteOreSettings, MonteOreProposal, MonteOreSchedule } = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');
const calendarService = require('../../services/monteOreCalendarService');
const { validateDailyConstraints } = require('../../services/monteOreDailyValidator');

describe('Monte Ore — vincoli giornalieri (Z2/Z3 Regolamento Art. 2)', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  // -----------------------------------------------------------------------
  // Unit test del validator puro (no DB, edge cases)
  // -----------------------------------------------------------------------

  describe('validateDailyConstraints (unit)', () => {
    it('schedules vuoti → ok=true, no violations', () => {
      expect(validateDailyConstraints([], { maxHoursPerDay: 9 })).toEqual({
        ok: true,
        violations: [],
      });
    });

    it('settings senza vincoli (tutto NULL) → ok=true anche con pattern violento', () => {
      const schedules = [
        { dayOfWeek: 1, startTime: '08:00', endTime: '20:00' }, // 12h lun
      ];
      const out = validateDailyConstraints(schedules, {
        maxHoursPerDay: null,
        dailyBreakAfterHours: null,
        dailyBreakMinutes: null,
      });
      expect(out.ok).toBe(true);
    });

    it('gap esattamente uguale a dailyBreakMinutes → blocco spezzato (no violazione)', () => {
      // 4h + 30min pausa esatta + 4h = 2 blocchi da 4h, entrambi < 7h
      const schedules = [
        { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 1, startTime: '13:30', endTime: '17:30' },
      ];
      const out = validateDailyConstraints(schedules, {
        dailyBreakAfterHours: 7,
        dailyBreakMinutes: 30,
      });
      expect(out.ok).toBe(true);
    });

    it('1 schedule singolo > soglia consecutiva → BREAK_REQUIRED', () => {
      const schedules = [{ dayOfWeek: 2, startTime: '09:00', endTime: '17:30' }]; // 8.5h
      const out = validateDailyConstraints(schedules, {
        dailyBreakAfterHours: 7,
        dailyBreakMinutes: 30,
      });
      expect(out.ok).toBe(false);
      expect(out.violations[0]).toMatchObject({
        code: 'BREAK_REQUIRED',
        dayOfWeek: 2,
        threshold: 7,
        breakNeeded: 30,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Integration: PUT /admin/monte-ore/settings (coerenza)
  // -----------------------------------------------------------------------

  describe('PUT /admin/monte-ore/settings — coerenza break-field', () => {
    async function setupSettings(academicYear = calendarService.currentAcademicYear()) {
      const institute = await Institute.create({ name: 'I', city: 'X', country: 'IT' });
      const [a] = academicYear.split('/').map(Number);
      return MonteOreSettings.create({
        instituteId: institute.id,
        academicYear,
        academicYearStart: `${a}-11-01`,
        academicYearEnd: `${a + 1}-10-31`,
        lessonsStartDate: `${a}-11-01`,
        lessonsEndDate: `${a + 1}-06-30`,
        submissionWindowStart: `${a}-09-01`,
        submissionWindowEnd: `${a + 1}-10-31`,
        minRequiredHours: 1,
        maxAmendmentsPerYear: 3,
      });
    }

    it('400 INVALID_SETTINGS se valorizzo solo dailyBreakAfterHours senza dailyBreakMinutes', async () => {
      await setupSettings();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/monte-ore/settings')
        .set('Authorization', authHeader)
        .send({ dailyBreakAfterHours: 7 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SETTINGS');
      expect(res.body.error).toMatch(/dailyBreakAfterHours.*dailyBreakMinutes|entrambi/i);
    });

    it('200 OK se valorizzo entrambi i break-field', async () => {
      await setupSettings();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/monte-ore/settings')
        .set('Authorization', authHeader)
        .send({ maxHoursPerDay: 9, dailyBreakAfterHours: 7, dailyBreakMinutes: 30 });
      expect(res.status).toBe(200);
      expect(res.body.settings.maxHoursPerDay).toBe(9);
      expect(res.body.settings.dailyBreakAfterHours).toBe(7);
      expect(res.body.settings.dailyBreakMinutes).toBe(30);
    });

    it('200 OK se azzero entrambi (null) i break-field', async () => {
      await setupSettings();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/admin/monte-ore/settings')
        .set('Authorization', authHeader)
        .send({ dailyBreakAfterHours: null, dailyBreakMinutes: null });
      expect(res.status).toBe(200);
      expect(res.body.settings.dailyBreakAfterHours).toBeNull();
      expect(res.body.settings.dailyBreakMinutes).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Integration: POST /me/submit con vincoli attivi
  // -----------------------------------------------------------------------

  describe('POST /me/submit — applica i vincoli giornalieri', () => {
    async function setupForSubmit({
      maxHoursPerDay = null,
      dailyBreakAfterHours = null,
      dailyBreakMinutes = null,
    } = {}) {
      const year = calendarService.currentAcademicYear();
      const [a] = year.split('/').map(Number);
      const institute = await Institute.create({ name: 'I', city: 'X', country: 'IT' });
      await MonteOreSettings.create({
        instituteId: institute.id,
        academicYear: year,
        academicYearStart: `${a}-11-01`,
        academicYearEnd: `${a + 1}-10-31`,
        lessonsStartDate: `${a}-11-01`,
        lessonsEndDate: `${a + 1}-06-30`,
        submissionWindowStart: `${a}-09-01`,
        submissionWindowEnd: `${a + 1}-10-31`,
        minRequiredHours: 1,
        maxAmendmentsPerYear: 3,
        maxHoursPerDay,
        dailyBreakAfterHours,
        dailyBreakMinutes,
      });
      await createBookingRule({ role: 'docente' });
      const doc = await createAuthedUser({ role: 'docente' });
      const room = await createRoom();
      const get = await request(app).get('/api/monte-ore/me').set('Authorization', doc.authHeader);
      return { proposalId: get.body.proposal.id, docAuth: doc.authHeader, roomId: room.id, year };
    }

    async function addSchedules(proposalId, roomId, schedules) {
      for (const s of schedules) {
        await MonteOreSchedule.create({ proposalId, roomId, ...s, bookingType: 'lezione' });
      }
    }

    it('DAILY_HOURS_EXCEEDED quando lun totale 10h con limite 9h', async () => {
      const { proposalId, docAuth, roomId } = await setupForSubmit({ maxHoursPerDay: 9 });
      await addSchedules(proposalId, roomId, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }, // 4h
        { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' }, // 6h → 10h totali
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }, // serve per il min 2 giorni
      ]);
      // Materializza gli slot via regenerate (necessario per recomputeTotals)
      await request(app).post('/api/monte-ore/me/regenerate-slots').set('Authorization', docAuth);
      // Attiva tutti gli slot
      const slotsRes = await request(app)
        .get('/api/monte-ore/me/slots')
        .set('Authorization', docAuth);
      for (const s of slotsRes.body.slots) {
        if (!s.isLocked && !s.isActive) {
          await request(app)
            .post(`/api/monte-ore/me/slots/${s.id}/toggle`)
            .set('Authorization', docAuth);
        }
      }

      const submit = await request(app)
        .post('/api/monte-ore/me/submit')
        .set('Authorization', docAuth);
      expect(submit.status).toBe(400);
      expect(submit.body.code).toBe('DAILY_HOURS_EXCEEDED');
      expect(submit.body.violations).toBeDefined();
      expect(submit.body.violations[0].dayOfWeek).toBe(1);
      expect(submit.body.violations[0].totalHours).toBe(10);
      expect(submit.body.violations[0].limit).toBe(9);
    });

    it('OK quando lun totale 7h con limite 9h (e min giorni rispettati)', async () => {
      const { proposalId, docAuth, roomId } = await setupForSubmit({ maxHoursPerDay: 9 });
      await addSchedules(proposalId, roomId, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }, // 3h
        { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' }, // 4h → 7h totali
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' },
      ]);
      await request(app).post('/api/monte-ore/me/regenerate-slots').set('Authorization', docAuth);
      const slotsRes = await request(app)
        .get('/api/monte-ore/me/slots')
        .set('Authorization', docAuth);
      for (const s of slotsRes.body.slots) {
        if (!s.isLocked && !s.isActive) {
          await request(app)
            .post(`/api/monte-ore/me/slots/${s.id}/toggle`)
            .set('Authorization', docAuth);
        }
      }

      const submit = await request(app)
        .post('/api/monte-ore/me/submit')
        .set('Authorization', docAuth);
      expect(submit.status).toBe(200);
      expect(submit.body.proposal.status).toBe('submitted');
    });

    it('BREAK_REQUIRED quando 8h consecutive con gap 15min e soglia 7h/30min', async () => {
      const { proposalId, docAuth, roomId } = await setupForSubmit({
        dailyBreakAfterHours: 7,
        dailyBreakMinutes: 30,
      });
      await addSchedules(proposalId, roomId, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }, // 4h
        { dayOfWeek: 1, startTime: '13:15', endTime: '17:15' }, // 4h, gap 15min → blocco 8h
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' },
      ]);
      await request(app).post('/api/monte-ore/me/regenerate-slots').set('Authorization', docAuth);
      const slotsRes = await request(app)
        .get('/api/monte-ore/me/slots')
        .set('Authorization', docAuth);
      for (const s of slotsRes.body.slots) {
        if (!s.isLocked && !s.isActive) {
          await request(app)
            .post(`/api/monte-ore/me/slots/${s.id}/toggle`)
            .set('Authorization', docAuth);
        }
      }

      const submit = await request(app)
        .post('/api/monte-ore/me/submit')
        .set('Authorization', docAuth);
      expect(submit.status).toBe(400);
      expect(submit.body.code).toBe('BREAK_REQUIRED');
    });

    it('settings senza vincoli (NULL) → submit passa anche con 12h continuative', async () => {
      const { proposalId, docAuth, roomId } = await setupForSubmit({
        maxHoursPerDay: null,
        dailyBreakAfterHours: null,
        dailyBreakMinutes: null,
      });
      await addSchedules(proposalId, roomId, [
        { dayOfWeek: 1, startTime: '08:00', endTime: '20:00' }, // 12h continuativi
        { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' },
      ]);
      await request(app).post('/api/monte-ore/me/regenerate-slots').set('Authorization', docAuth);
      const slotsRes = await request(app)
        .get('/api/monte-ore/me/slots')
        .set('Authorization', docAuth);
      for (const s of slotsRes.body.slots) {
        if (!s.isLocked && !s.isActive) {
          await request(app)
            .post(`/api/monte-ore/me/slots/${s.id}/toggle`)
            .set('Authorization', docAuth);
        }
      }

      const submit = await request(app)
        .post('/api/monte-ore/me/submit')
        .set('Authorization', docAuth);
      expect(submit.status).toBe(200);
    });
  });
});
