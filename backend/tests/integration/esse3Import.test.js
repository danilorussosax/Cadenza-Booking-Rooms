'use strict';

/**
 * Integrazione: importazione anagrafica ESSE3 (CINECA) via XLSX.
 *
 * Verifica che gli stessi handler dell'engine Isidata, parametrizzati su
 * source='esse3', funzionino correttamente con header tipici ESSE3
 * (CodiceCdS, DescrizioneCdS, StatoIscrizione) e persistano
 * externalSource='esse3' separato dal pool Isidata.
 */

const request = require('supertest');
const ExcelJS = require('exceljs');
const { buildApp } = require('../../app');
const { User } = require('../../models');
const { createAdmin, createUser } = require('../factories');

async function buildXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ESSE3');
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('POST /api/admin/integrations/esse3-csv', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('preview: legge header tipici ESSE3 e classifica nuovi vs aggiornati', async () => {
    const { token: adminTok } = await createAdmin();

    // Utente già linkato a ESSE3 da un import precedente.
    await createUser({
      email: 'mario.rossi@studenti.unimi.it',
      firstName: 'Mario',
      lastName: 'Rossi',
      role: 'studente',
      matricola: 'STU2024-001',
      externalSource: 'esse3',
      externalId: 'STU2024-001',
    });

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email Istituzionale', 'CodiceCdS', 'StatoIscrizione'],
      ['STU2024-001', 'Rossi', 'Mario', 'mario.rossi@studenti.unimi.it', 'AFAM003', 'Attivo'],
      ['STU2024-002', 'Bianchi', 'Anna', 'anna.bianchi@studenti.unimi.it', 'AFAM003', 'Attivo'],
    ]);

    const res = await request(app)
      .post('/api/admin/integrations/esse3-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, {
        filename: 'esse3.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.fetched).toBe(2);
    expect(res.body.summary.toCreate).toBe(1);
    expect(res.body.token).toBeTruthy();
    expect(res.body.hash).toMatch(/^[a-f0-9]{64}$/);
    // L'effectiveMapping deve aver riconosciuto gli header ESSE3.
    expect(res.body.effectiveMapping.email).toMatch(/email/i);
    expect(res.body.effectiveMapping.courseCode).toMatch(/cd/i);
  });

  it('apply: persiste externalSource="esse3" distinto da "isidata"', async () => {
    const { token: adminTok } = await createAdmin();

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'StatoIscrizione'],
      ['ESSE3-100', 'Verdi', 'Giuseppe', 'verdi@example.it', 'Attivo'],
    ]);

    const previewRes = await request(app)
      .post('/api/admin/integrations/esse3-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, {
        filename: 'esse3.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(previewRes.status).toBe(200);

    const applyRes = await request(app)
      .post('/api/admin/integrations/esse3-csv/apply')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ token: previewRes.body.token, confirmedDiffHash: previewRes.body.hash });
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.summary.created).toBe(1);

    const user = await User.findOne({ where: { email: 'verdi@example.it' } });
    expect(user).toBeTruthy();
    expect(user.externalSource).toBe('esse3');
    expect(user.externalId).toBe('ESSE3-100');
  });

  it('coerce status: "Laureato" → isActive false', async () => {
    const { token: adminTok } = await createAdmin();

    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email', 'StatoIscrizione'],
      ['ESSE3-200', 'Neri', 'Carla', 'neri@example.it', 'Laureato'],
    ]);

    const previewRes = await request(app)
      .post('/api/admin/integrations/esse3-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, {
        filename: 'esse3.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    const applyRes = await request(app)
      .post('/api/admin/integrations/esse3-csv/apply')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ token: previewRes.body.token, confirmedDiffHash: previewRes.body.hash });
    expect(applyRes.status).toBe(201);

    const user = await User.findOne({ where: { email: 'neri@example.it' } });
    expect(user.isActive).toBe(false);
  });

  it('utenti ESSE3 non vengono trattati come orphan in un import Isidata', async () => {
    // Setup: utente ESSE3 esistente.
    const { token: adminTok } = await createAdmin();
    await createUser({
      email: 'esse3.user@example.it',
      firstName: 'E',
      lastName: 'U',
      role: 'studente',
      matricola: 'ESSE3-500',
      externalSource: 'esse3',
      externalId: 'ESSE3-500',
    });

    // Import Isidata che NON contiene quel utente.
    const buf = await buildXlsxBuffer([
      ['Matricola', 'Cognome', 'Nome', 'Email'],
      ['ISI-001', 'X', 'Y', 'isidata.user@example.it'],
    ]);
    const previewRes = await request(app)
      .post('/api/admin/integrations/isidata-csv/preview')
      .set('Authorization', `Bearer ${adminTok}`)
      .attach('file', buf, {
        filename: 'isidata.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(previewRes.status).toBe(200);
    // L'utente ESSE3 NON deve apparire in toOrphan: ha externalSource diverso.
    expect(previewRes.body.summary.toOrphan).toBe(0);
  });
});
