'use strict';

/**
 * Test per il toggle dei moduli (Monte Ore + Prestito strumenti).
 *
 * Garanzie verificate:
 *   - GET /api/structure/institutes/public espone i flag (default true).
 *   - GET /api/structure/module-settings richiede admin (401/403 negli altri casi).
 *   - PUT /api/structure/module-settings persiste i flag e li ritorna aggiornati.
 *   - Anche con il flag disattivato, le rotte di Monte Ore restano funzionanti
 *     (il toggle è soltanto di presentazione lato sidebar).
 *   - preSyncMigrations aggiunge idempotentemente le colonne nuove a un DB
 *     "legacy" (schema vecchio senza i due flag), evitando il crash dei
 *     SELECT su Institute.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { sequelize, Institute } = require('../../models');
const { createAdmin, createAuthedUser } = require('../factories');
const preSync = require('../../lib/preSyncMigrations');

const app = buildApp({ serveFrontend: false });

describe('moduleSettings toggle', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    // serve almeno un Institute (singleton) per i test.
    await Institute.create({ name: 'Test Conservatorio', city: 'Roma' });
  });

  it('public endpoint espone i due flag con default true', async () => {
    const res = await request(app).get('/api/structure/institutes/public');
    expect(res.status).toBe(200);
    expect(res.body.institute).toMatchObject({
      moduleMonteOreEnabled: true,
      moduleInstrumentLoansEnabled: true,
    });
  });

  it('GET /module-settings richiede autenticazione', async () => {
    const res = await request(app).get('/api/structure/module-settings');
    expect(res.status).toBe(401);
  });

  it('GET /module-settings rifiuta i non-admin', async () => {
    const { token } = await createAuthedUser({ role: 'docente', status: 'approved' });
    const res = await request(app)
      .get('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('GET /module-settings ritorna i flag al admin', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .get('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      moduleMonteOreEnabled: true,
      moduleInstrumentLoansEnabled: true,
    });
  });

  it('PUT /module-settings persiste i flag aggiornati', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .put('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ moduleMonteOreEnabled: false, moduleInstrumentLoansEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      moduleMonteOreEnabled: false,
      moduleInstrumentLoansEnabled: false,
    });

    // Verifica persistence
    const inst = await Institute.findOne({ order: [['id', 'ASC']] });
    expect(inst.moduleMonteOreEnabled).toBe(false);
    expect(inst.moduleInstrumentLoansEnabled).toBe(false);

    // Anche il public endpoint riflette l'aggiornamento
    const pub = await request(app).get('/api/structure/institutes/public');
    expect(pub.body.institute.moduleMonteOreEnabled).toBe(false);
    expect(pub.body.institute.moduleInstrumentLoansEnabled).toBe(false);
  });

  it('PUT accetta toggle parziale (solo un flag)', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .put('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ moduleMonteOreEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      moduleMonteOreEnabled: false,
      moduleInstrumentLoansEnabled: true,
    });
  });

  it('PUT rifiuta body vuoto / privo di flag validi', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .put('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('PUT rifiuta tipi non booleani', async () => {
    const { token } = await createAdmin();
    const res = await request(app)
      .put('/api/structure/module-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ moduleMonteOreEnabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('preSyncMigrations aggiunge le colonne se assenti (DB legacy)', async () => {
    // Simula un DB "legacy" rimuovendo le colonne aggiunte dal model.
    // SQLite ALTER TABLE DROP COLUMN funziona da 3.35; in alternativa
    // ricreiamo la tabella senza i flag.
    await sequelize.query('ALTER TABLE institutes DROP COLUMN moduleMonteOreEnabled');
    await sequelize.query('ALTER TABLE institutes DROP COLUMN moduleInstrumentLoansEnabled');

    // Verifica che le colonne siano sparite
    const qi = sequelize.getQueryInterface();
    let desc = await qi.describeTable('institutes');
    expect(desc.moduleMonteOreEnabled).toBeUndefined();
    expect(desc.moduleInstrumentLoansEnabled).toBeUndefined();

    // Run delle migrazioni pre-sync — deve ricreare le colonne con default true.
    await preSync.runPreSyncMigrations();

    desc = await qi.describeTable('institutes');
    expect(desc.moduleMonteOreEnabled).toBeDefined();
    expect(desc.moduleInstrumentLoansEnabled).toBeDefined();

    // Le righe esistenti devono avere il default true (non NULL).
    const inst = await Institute.findOne({ order: [['id', 'ASC']] });
    expect(inst.moduleMonteOreEnabled).toBe(true);
    expect(inst.moduleInstrumentLoansEnabled).toBe(true);

    // Doppia esecuzione = nessun errore (idempotenza).
    await preSync.runPreSyncMigrations();
  });

  it('le rotte di Monte Ore restano attive anche con flag disattivato', async () => {
    const { token: adminTok } = await createAdmin();
    // disattiva il modulo
    await request(app)
      .put('/api/structure/module-settings')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ moduleMonteOreEnabled: false, moduleInstrumentLoansEnabled: false });

    // GET /api/monte-ore/me deve continuare a rispondere (200/204/etc.,
    // NON 404). Il toggle è solo di presentazione.
    const res = await request(app)
      .get('/api/monte-ore/me')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(res.status).not.toBe(404);
    // E lo stesso per gli strumenti
    const res2 = await request(app)
      .get('/api/instruments')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(res2.status).not.toBe(404);
  });
});
