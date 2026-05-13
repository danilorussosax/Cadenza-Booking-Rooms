'use strict';

/**
 * Integrazione: POST /api/admin/monte-ore/import — import Excel del Monte
 * Ore compilato dal docente, caricato dall'admin.
 *
 * Copre:
 *   - happy path: 201, proposal con status='submitted' e source='admin_import',
 *     schedules creati con roomId=null
 *   - 404 quando l'email del docente non corrisponde ad alcun utente
 *   - 400 quando il file non è un .xlsx (multer fileFilter)
 *   - idempotenza: secondo import con overwrite=true (default) sostituisce
 *     le righe esistenti, mantiene il source='admin_import' e azzera/ricrea
 *     gli schedule.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const {
  Institute,
  MonteOreSettings,
  MonteOreProposal,
  MonteOreSchedule,
  User,
} = require('../../models');
const { buildTemplateWorkbook } = require('../../services/monteOreTemplateService');
const { createAuthedUser, createAdmin } = require('../factories');

const baseSettings = {
  academicYear: '2026/2027',
  lessonsStartDate: '2026-11-02',
  lessonsEndDate: '2027-10-31',
  minRequiredHours: 324,
};

/**
 * Genera un buffer .xlsx popolato con l'anagrafica dei parametri e con due
 * fasce orarie in due celle diverse del foglio Orario:
 *   - Lunedì (col C)  → "14:00-16:00 (A12)"
 *   - Martedì (col D) → "09:00-10:30"
 * Tutte e due le celle vengono scelte tra quelle libere (non rosse / non
 * sospensioni). Ritorna anche le ore totali del pattern per assert.
 */
async function buildImportBuffer({ academicYear = '2026/2027', email, materia, note } = {}) {
  const wb = await buildTemplateWorkbook({
    academicYear,
    settings: { ...baseSettings, academicYear },
    suspensions: [],
  });
  // Anagrafica
  const sAna = wb.getWorksheet('Anagrafica');
  for (let r = 1; r <= 12; r++) {
    const label = String(sAna.getCell(`A${r}`).value || '')
      .toLowerCase()
      .trim();
    if (label === 'email' && email) sAna.getCell(`B${r}`).value = email;
    if (label === 'materia' && materia) sAna.getCell(`B${r}`).value = materia;
    if (label === 'note' && note) sAna.getCell(`B${r}`).value = note;
  }
  // Cerca prima riga libera (cella C non rossa, no sospensione)
  const ws = wb.getWorksheet('Orario');
  const isLockedRow = (r) => {
    const cText = String(ws.getRow(r).getCell(3).value || '').toLowerCase();
    return cText.includes('sospensione') || cText.includes('sessione');
  };
  const isRed = (cell) => cell.fill?.fgColor?.argb === 'FFC0392B';

  let firstFree = null;
  for (let r = 2; r <= 60; r++) {
    if (!ws.getRow(r).getCell(2).value) continue;
    if (isLockedRow(r)) continue;
    if (isRed(ws.getRow(r).getCell(3))) continue;
    if (isRed(ws.getRow(r).getCell(4))) continue;
    firstFree = r;
    break;
  }
  if (!firstFree) throw new Error('Nessuna riga libera nel template');

  ws.getRow(firstFree).getCell(3).value = '14:00-16:00 (A12)'; // Lunedì
  ws.getRow(firstFree).getCell(4).value = '09:00-10:30'; // Martedì

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function setupSettings(academicYear = '2026/2027') {
  const institute = await Institute.create({
    name: 'Test Inst',
    code: 'TI',
    city: 'X',
    country: 'IT',
  });
  return MonteOreSettings.create({
    instituteId: institute.id,
    academicYear,
    academicYearStart: '2026-11-01',
    academicYearEnd: '2027-10-31',
    lessonsStartDate: '2026-11-02',
    lessonsEndDate: '2027-10-31',
    submissionWindowStart: '2026-09-01',
    submissionWindowEnd: '2030-12-31',
    minRequiredHours: 324,
    maxAmendmentsPerYear: 3,
  });
}

describe('POST /api/admin/monte-ore/import', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('happy path: crea proposta con source=admin_import e schedules con roomId=null', async () => {
    await setupSettings('2026/2027');
    const { user: doc } = await createAuthedUser({
      role: 'docente',
      email: 'test@x.it',
      firstName: 'Mario',
      lastName: 'Rossi',
    });
    const { authHeader: adminHeader } = await createAdmin();

    const buf = await buildImportBuffer({
      email: 'test@x.it',
      materia: 'Pianoforte 3°',
      note: 'Test import',
    });

    const res = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', buf, {
        filename: 'monteore-mario.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.status).toBe('submitted');
    expect(res.body.proposal.source).toBe('admin_import');
    expect(res.body.proposal.userId).toBe(doc.id);
    expect(res.body.proposal.importSourceRef).toBe('monteore-mario.xlsx');
    expect(res.body.proposal.importedAt).toBeTruthy();
    expect(res.body.user.email).toBe('test@x.it');
    expect(res.body.summary.schedulesCreated).toBe(2);
    expect(res.body.summary.totalHoursPattern).toBeCloseTo(3.5, 1);

    // Verifica DB: schedules con roomId=null e bookingType='lezione'
    const sch = await MonteOreSchedule.findAll({
      where: { proposalId: res.body.proposal.id },
    });
    expect(sch).toHaveLength(2);
    sch.forEach((s) => {
      expect(s.roomId).toBeNull();
      expect(s.bookingType).toBe('lezione');
      expect(s.purpose).toBe('Pianoforte 3°');
    });
    // Una delle due deve avere la nota con A12 (Lunedì 14:00-16:00)
    const withRoom = sch.find((s) => s.notes && /A12/.test(s.notes));
    expect(withRoom).toBeTruthy();
    expect(withRoom.dayOfWeek).toBe(1);
    expect(withRoom.startTime).toBe('14:00');
    expect(withRoom.endTime).toBe('16:00');
  });

  it('404 se email non corrisponde a nessun User', async () => {
    await setupSettings('2026/2027');
    const { authHeader: adminHeader } = await createAdmin();

    const buf = await buildImportBuffer({ email: 'nessuno@x.it' });
    const res = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', buf, {
        filename: 'monteore.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEACHER_NOT_FOUND');
  });

  it('400 se file non è xlsx (multer fileFilter)', async () => {
    await setupSettings('2026/2027');
    const { authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', Buffer.from('hello world'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non supportato/i);
  });

  it('400 se manca il file (no upload)', async () => {
    await setupSettings('2026/2027');
    const { authHeader: adminHeader } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_FILE');
  });

  it('400 se AA non configurato (no MonteOreSettings)', async () => {
    // Settings per AA diverso da quello del file
    await setupSettings('2025/2026');
    await createAuthedUser({ role: 'docente', email: 'test@x.it' });
    const { authHeader: adminHeader } = await createAdmin();

    const buf = await buildImportBuffer({
      academicYear: '2026/2027',
      email: 'test@x.it',
    });
    const res = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', buf, {
        filename: 'monteore.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('YEAR_NOT_CONFIGURED');
  });

  it('idempotente: secondo import (overwrite=true default) sostituisce le righe', async () => {
    await setupSettings('2026/2027');
    const { user: doc } = await createAuthedUser({
      role: 'docente',
      email: 'test@x.it',
    });
    const { authHeader: adminHeader } = await createAdmin();

    // Primo import
    const buf1 = await buildImportBuffer({ email: 'test@x.it' });
    const r1 = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', buf1, {
        filename: 'first.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(r1.status).toBe(201);
    const proposalId = r1.body.proposal.id;
    const schedulesBefore = await MonteOreSchedule.findAll({
      where: { proposalId },
    });
    expect(schedulesBefore).toHaveLength(2);

    // Secondo import — stesso docente, stesso AA. Il nuovo file ha 2 fasce
    // identiche di buildImportBuffer (idempotente).
    const buf2 = await buildImportBuffer({ email: 'test@x.it' });
    const r2 = await request(app)
      .post('/api/admin/monte-ore/import')
      .set('Authorization', adminHeader)
      .attach('file', buf2, {
        filename: 'second.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(r2.status).toBe(201);
    expect(r2.body.proposal.id).toBe(proposalId); // stessa proposta (UPSERT logico)
    expect(r2.body.proposal.importSourceRef).toBe('second.xlsx');

    // Una sola proposta in DB
    const all = await MonteOreProposal.findAll({ where: { userId: doc.id } });
    expect(all).toHaveLength(1);

    // Le righe schedule del primo import sono state distrutte → 2 nuove
    const schedulesAfter = await MonteOreSchedule.findAll({
      where: { proposalId },
    });
    expect(schedulesAfter).toHaveLength(2);
    // Niente "duplicazione" (4 righe).
  });
});
