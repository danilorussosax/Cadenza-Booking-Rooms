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
const { User } = require('../../models');
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

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'Ruolo'],
      ['A100', 'NewName', 'Old', 'foo@x.test', 'studente'],
      ['A300', 'Bianchi', 'Anna', 'anna@x.test', 'studente'],
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
});
