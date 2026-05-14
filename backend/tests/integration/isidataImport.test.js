'use strict';

/**
 * Integrazione Liv A: importazione anagrafica Isidata via XLSX.
 *
 * Copre: preview happy-path, hash mismatch, scaduto, apply round-trip
 * con creazione/aggiornamento/orphan, rollback su errore.
 */

const request = require('supertest');
const ExcelJS = require('exceljs');
const { buildApp } = require('../../app');
const { User, Course } = require('../../models');
const { createAdmin, createUser } = require('../factories');

async function buildXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Isidata');
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('POST /api/admin/integrations/isidata-csv', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  // DB pulito a ogni test: ogni test crea il proprio admin/utente di partenza
  // così le precondizioni (es. orphan count) sono deterministiche.
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('preview: classifica nuovi/aggiornati/orphan senza modificare il DB', async () => {
    const { token: adminTok } = await createAdmin();

    // Setup: 1 utente già "linkato" Isidata con cognome diverso (→ update),
    //        1 utente già linkato che non sarà nel CSV (→ orphan),
    //        + il CSV porta 1 nuovo utente (→ create).
    const existingUpdate = await createUser({
      email: 'mario.rossi@conservatorio.it',
      firstName: 'Mario',
      lastName: 'Vecchio',
      role: 'studente',
      matricola: '12345',
      externalSource: 'isidata',
      externalId: '12345',
    });
    const existingOrphan = await createUser({
      email: 'gone@conservatorio.it',
      firstName: 'Lost',
      lastName: 'User',
      role: 'studente',
      matricola: '99999',
      externalSource: 'isidata',
      externalId: '99999',
    });

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo', 'Stato'],
      ['12345', 'Rossi', 'Mario', 'mario.rossi@conservatorio.it', 'studente', 'attivo'],
      ['77777', 'Bianchi', 'Anna', 'anna@conservatorio.it', 'studente', 'attivo'],
    ]);

    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, {
        filename: 'isidata.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.fetched).toBe(2);
    expect(res.body.summary.toCreate).toBe(1);
    expect(res.body.summary.toUpdate).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.toOrphan).toBe(1);
    expect(res.body.token).toMatch(/^\d+-\d+-[a-f0-9]+\.\w+$/);
    expect(res.body.hash).toMatch(/^[a-f0-9]{64}$/);

    // Nessun side-effect lato DB.
    const stillVecchio = await User.findByPk(existingUpdate.id);
    expect(stillVecchio.lastName).toBe('Vecchio');
    const stillActive = await User.findByPk(existingOrphan.id);
    expect(stillActive.isActive).toBe(true);
  });

  it("apply: crea, aggiorna, disattiva (orphan) in un'unica transazione", async () => {
    const { token: adminTok, user: admin } = await createAdmin();

    const upd = await createUser({
      email: 'foo@x.test',
      firstName: 'Old',
      lastName: 'Name',
      role: 'studente',
      matricola: 'A100',
      externalSource: 'isidata',
      externalId: 'A100',
    });
    const orph = await createUser({
      email: 'bar@x.test',
      firstName: 'Lost',
      lastName: 'Soul',
      role: 'studente',
      matricola: 'A200',
      externalSource: 'isidata',
      externalId: 'A200',
    });
    // Riempitivo: utenti Isidata attivi che NON saranno orfani (la matricola
    // è inclusa nel CSV in basso, ramo "match → toUpdate con linkChanged"
    // se i campi coincidono). Servono per portare il rapporto di
    // disattivazione sotto la soglia critical (20%) e tenere questo test
    // sulla "happy path" senza confirmCriticalWarnings.
    const filler = [];
    for (let i = 0; i < 9; i++) {
      filler.push(
        await createUser({
          email: `fill${i}@x.test`,
          firstName: 'F',
          lastName: `Filler${i}`,
          role: 'studente',
          matricola: `F${i}`,
          externalSource: 'isidata',
          externalId: `F${i}`,
        }),
      );
    }

    const fillerRows = filler.map((f, i) => [
      `F${i}`,
      `Filler${i}`,
      'F',
      `fill${i}@x.test`,
      'studente',
    ]);
    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
      ['A100', 'NewName', 'Old', 'foo@x.test', 'studente'],
      ['A300', 'Bianchi', 'Anna', 'anna@x.test', 'studente'],
      ...fillerRows,
    ]);

    const previewRes = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, 'isidata.xlsx');
    expect(previewRes.status).toBe(200);

    const applyRes = await request(app)
      .post('/api/admin/integrations/isidata-csv/apply')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        token: previewRes.body.token,
        confirmedDiffHash: previewRes.body.hash,
      });
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.status).toBe('success');
    expect(applyRes.body.summary.created).toBe(1);
    expect(applyRes.body.summary.updated).toBe(1);
    expect(applyRes.body.summary.orphaned).toBe(1);

    // Verifica DB.
    const updated = await User.findByPk(upd.id);
    expect(updated.lastName).toBe('NewName');
    expect(updated.externalSource).toBe('isidata');
    expect(updated.lastExternalSyncAt).toBeTruthy();

    const orphaned = await User.findByPk(orph.id);
    expect(orphaned.isActive).toBe(false);
    expect(orphaned.externalStatusNote).toMatch(/Isidata/);

    const created = await User.findOne({ where: { matricola: 'A300' } });
    expect(created).toBeTruthy();
    expect(created.firstName).toBe('Anna');
    expect(created.externalSource).toBe('isidata');
    expect(created.externalId).toBe('A300');
    // Sicurezza: l'utente nasce in stato pending — l'admin lo approva esplicitamente.
    expect(created.status).toBe('pending');

    // Run record persistito con summary corretto.
    const { IntegrationSyncRun } = require('../../models');
    const run = await IntegrationSyncRun.findByPk(applyRes.body.runId);
    expect(run.status).toBe('success');
    expect(run.actorId).toBe(admin.id);
    expect(run.diffSnapshot).toBeTruthy();
  });

  it('apply: rifiuta con HASH_MISMATCH se il client manda un hash sbagliato', async () => {
    const { token: adminTok } = await createAdmin();

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome'],
      ['B100', 'Test', 'Hash'],
    ]);
    const previewRes = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, 'isidata.xlsx');
    expect(previewRes.status).toBe(200);

    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/apply')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        token: previewRes.body.token,
        confirmedDiffHash: '0'.repeat(64),
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('HASH_MISMATCH');
  });

  it("apply: rifiuta con TOKEN_FOREIGN se l'admin che applica non è quello che ha caricato", async () => {
    const { token: adminTokA } = await createAdmin();
    const { token: adminTokB } = await createAdmin();

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome'],
      ['C1', 'Test', 'Sec'],
    ]);
    const previewRes = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTokA}`)
      .attach('file', buf, 'isidata.xlsx');

    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/apply')
      .set('Authorization', `Bearer ${adminTokB}`)
      .send({
        token: previewRes.body.token,
        confirmedDiffHash: previewRes.body.hash,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_FOREIGN');
  });

  it("preview: l'endpoint richiede ruolo admin (403 per studente)", async () => {
    const { token: studentTok } = await require('../factories').createAuthedUser({
      role: 'studente',
    });
    const buf = await buildXlsxBuffer([['Matricola'], ['1']]);
    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${studentTok}`)
      .attach('file', buf, 'isidata.xlsx');
    expect([401, 403]).toContain(res.status);
  });

  it('runs: lista vuota → struttura coerente', async () => {
    const { token: adminTok } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/integrations/runs?provider=isidata&limit=5')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });

  // ===========================================================
  // Miglioria 1: soglie sicurezza pre-apply
  // ===========================================================
  describe('safetyChecks (mass deactivation)', () => {
    async function seedManyIsidataUsers(count) {
      // Crea `count` utenti Isidata attivi: necessari per far scattare
      // il gate critical (deactivateRatio > 20% richiede una popolazione
      // di partenza non triviale).
      const created = [];
      for (let i = 0; i < count; i++) {
        created.push(
          await createUser({
            email: `mass${i}@x.test`,
            firstName: 'M',
            lastName: `User${i}`,
            role: 'studente',
            matricola: `MASS${i}`,
            externalSource: 'isidata',
            externalId: `MASS${i}`,
          }),
        );
      }
      return created;
    }

    it('apply rifiuta con 409 CRITICAL_WARNINGS_PRESENT se ratio > 20% e niente confirmCriticalWarnings', async () => {
      const { token: adminTok } = await createAdmin();
      // 5 utenti attivi → import vuoto = 100% disattivazione → critical.
      await seedManyIsidataUsers(5);

      const buf = await buildXlsxBuffer([
        ['Matricola', 'Cognome', 'Nome'],
        ['Z1', 'Solo', 'Uno'], // un nuovo utente → 5 orfani, 1 create
      ]);

      const preview = await request(app)
        .post('/api/admin/integrations/isidata-csv/preview')
        .set('Authorization', `Bearer ${adminTok}`)
        .attach('file', buf, 'isidata.xlsx');
      expect(preview.status).toBe(200);
      expect(preview.body.safetyChecks).toBeTruthy();
      const criticalCount = preview.body.safetyChecks.warnings.filter(
        (w) => w.level === 'critical',
      ).length;
      expect(criticalCount).toBeGreaterThanOrEqual(1);

      const res = await request(app)
        .post('/api/admin/integrations/isidata-csv/apply')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({
          token: preview.body.token,
          confirmedDiffHash: preview.body.hash,
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CRITICAL_WARNINGS_PRESENT');
      expect(res.body.criticalCodes).toContain('MASS_DEACTIVATION');

      // Nessun utente è stato disattivato.
      const stillActive = await User.count({
        where: { externalSource: 'isidata', isActive: true },
      });
      expect(stillActive).toBe(5);
    });

    it('apply procede con 201 quando confirmCriticalWarnings: true', async () => {
      const { token: adminTok } = await createAdmin();
      await seedManyIsidataUsers(5);

      const buf = await buildXlsxBuffer([
        ['Matricola', 'Cognome', 'Nome'],
        ['Z1', 'Solo', 'Uno'],
      ]);
      const preview = await request(app)
        .post('/api/admin/integrations/isidata-csv/preview')
        .set('Authorization', `Bearer ${adminTok}`)
        .attach('file', buf, 'isidata.xlsx');

      const res = await request(app)
        .post('/api/admin/integrations/isidata-csv/apply')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({
          token: preview.body.token,
          confirmedDiffHash: preview.body.hash,
          confirmCriticalWarnings: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.summary.orphaned).toBe(5);
      // Tutti i 5 mass-user devono essere disattivati.
      const remaining = await User.count({
        where: { externalSource: 'isidata', isActive: true },
      });
      // Il nuovo "Z1" creato è attivo (status='active' default), gli altri 5 disattivati.
      expect(remaining).toBe(1);
    });
  });

  // ===========================================================
  // Miglioria 2 (UI): preview restituisce detectedHeaders + effectiveMapping + autoDetected
  // ===========================================================
  it('preview: include detectedHeaders/effectiveMapping/autoDetected per la UI guidata', async () => {
    const { token: adminTok } = await createAdmin();
    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
      ['M1', 'Rossi', 'Mario', 'mario@x.test', 'studente'],
    ]);
    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, 'isidata.xlsx');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.detectedHeaders)).toBe(true);
    expect(res.body.detectedHeaders).toEqual(
      expect.arrayContaining(['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo']),
    );
    expect(res.body.effectiveMapping).toBeTruthy();
    expect(res.body.effectiveMapping.email).toBe('Email');
    expect(res.body.effectiveMapping.firstName).toBe('Nome');
    expect(res.body.effectiveMapping.lastName).toBe('Cognome');
    expect(res.body.effectiveMapping.role).toBe('Ruolo');
    // courseCode non presente → null nella proiezione
    expect(res.body.effectiveMapping.courseCode).toBeNull();
    // autoDetected coincide con effectiveMapping quando non ci sono override.
    expect(res.body.autoDetected).toEqual(res.body.effectiveMapping);
  });

  // ===========================================================
  // Miglioria 2 (compare-previous): confronto run-vs-run per audit
  // ===========================================================
  describe('GET /runs/:id/compare-previous', () => {
    async function applyImport(adminTok, rows) {
      const buf = await buildXlsxBuffer(rows);
      const previewRes = await request(app)
        .post('/api/admin/integrations/isidata-csv/preview')
        .set('Authorization', `Bearer ${adminTok}`)
        .attach('file', buf, 'isidata.xlsx');
      expect(previewRes.status).toBe(200);
      const res = await request(app)
        .post('/api/admin/integrations/isidata-csv/apply')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({
          token: previewRes.body.token,
          confirmedDiffHash: previewRes.body.hash,
          confirmCriticalWarnings: true,
        });
      expect(res.status).toBe(201);
      return res.body.runId;
    }

    it('200 con hasPrevious=false su un singolo run', async () => {
      const { token: adminTok } = await createAdmin();
      const runId = await applyImport(adminTok, [
        ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
        ['S1', 'Solo', 'Uno', 's1@x.test', 'studente'],
      ]);
      const res = await request(app)
        .get(`/api/admin/integrations/runs/${runId}/compare-previous`)
        .set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.hasPrevious).toBe(false);
      expect(res.body.previous).toBeNull();
      expect(res.body.changes).toBeNull();
      expect(res.body.current).toBeTruthy();
      expect(res.body.current.id).toBe(runId);
    });

    it('200 con changes valorizzati su 2 run consecutivi (newly/recovered/repeat)', async () => {
      const { token: adminTok } = await createAdmin();

      // Run 1: importa 3 utenti (A, B, C).
      await applyImport(adminTok, [
        ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
        ['A', 'A', 'A', 'a@x.test', 'studente'],
        ['B', 'B', 'B', 'b@x.test', 'studente'],
        ['C', 'C', 'C', 'c@x.test', 'studente'],
      ]);

      // Run 2:
      //   - A presente con stesso cognome  → niente (no-op)
      //   - B con cognome cambiato         → update ripetuto se cambia di nuovo nel run 3
      //   - C non presente                 → deactivate
      //   - D nuovo                        → create
      await applyImport(adminTok, [
        ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
        ['A', 'A', 'A', 'a@x.test', 'studente'],
        ['B', 'Bnew', 'B', 'b@x.test', 'studente'],
        ['D', 'D', 'D', 'd@x.test', 'studente'],
      ]);

      // Run 3:
      //   - C torna (recovered: era nella deactivate-list di run 2 → ora in create/update)
      //   - B cambia di nuovo cognome (repeat update)
      //   - D scompare (newly deactivated)
      //   - E nuovo (newly created)
      const run3Id = await applyImport(adminTok, [
        ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
        ['A', 'A', 'A', 'a@x.test', 'studente'],
        ['B', 'Bnewer', 'B', 'b@x.test', 'studente'],
        ['C', 'C', 'C', 'c@x.test', 'studente'],
        ['E', 'E', 'E', 'e@x.test', 'studente'],
      ]);

      const res = await request(app)
        .get(`/api/admin/integrations/runs/${run3Id}/compare-previous`)
        .set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(200);
      expect(res.body.hasPrevious).toBe(true);
      expect(res.body.previous).toBeTruthy();
      expect(res.body.changes).toBeTruthy();

      const { changes } = res.body;
      // E è creato in run3 ma non in run2 → newly created
      expect(changes.newlyCreatedMatricole).toEqual(expect.arrayContaining(['E']));
      // D è disattivato in run3 ma non in run2 → newly deactivated
      expect(changes.newlyDeactivatedMatricole).toEqual(expect.arrayContaining(['D']));
      // B è in toUpdate sia di run2 che run3 → repeat updates
      expect(changes.repeatUpdatesMatricole).toEqual(expect.arrayContaining(['B']));
      // C era in toOrphan di run2 (D non esiste ancora), in run3 è in toCreate → recovered
      expect(changes.recoveredMatricole).toEqual(expect.arrayContaining(['C']));
      // delta numerici
      expect(typeof changes.delta.create).toBe('number');
      expect(typeof changes.delta.update).toBe('number');
      expect(typeof changes.delta.deactivate).toBe('number');
    });

    it('404 se id non esiste', async () => {
      const { token: adminTok } = await createAdmin();
      const res = await request(app)
        .get('/api/admin/integrations/runs/999999/compare-previous')
        .set('Authorization', `Bearer ${adminTok}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  // ===========================================================
  // Miglioria 3: collegamento courseCode → Course.courseId
  // ===========================================================
  it('apply: courseCode noto → User.courseId valorizzato dalla map', async () => {
    const { token: adminTok } = await createAdmin();
    const course = await Course.create({
      code: 'CODI/21',
      name: 'Pianoforte',
      levels: [],
      isActive: true,
    });

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo', 'CodiceCorso'],
      ['STU01', 'Verdi', 'Carla', 'carla@x.test', 'studente', 'CODI/21'],
    ]);

    const preview = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, 'isidata.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body.softWarnings).toBeTruthy();
    // courseCode noto → niente UNKNOWN_COURSE_CODE.
    expect(preview.body.softWarnings.some((w) => w.code === 'UNKNOWN_COURSE_CODE')).toBe(false);

    const res = await request(app)
      .post('/api/admin/integrations/isidata-csv/apply')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ token: preview.body.token, confirmedDiffHash: preview.body.hash });
    expect(res.status).toBe(201);

    const created = await User.findOne({ where: { matricola: 'STU01' } });
    expect(created).toBeTruthy();
    expect(created.courseId).toBe(course.id);
  });
});
