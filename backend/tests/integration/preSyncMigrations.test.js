'use strict';

/**
 * Verifica delle pre-sync migrations idempotenti.
 *
 * Scenario coperto: DB esistente (creato da una versione precedente) cui
 * manca una colonna che il modello attuale dichiara. `sequelize.sync()` in
 * modalità safe NON aggiunge colonne a tabelle esistenti → l'unica via per
 * sanare il gap è `runPreSyncMigrations()` invocato al boot.
 *
 * Il bug specifico tracciato qui: produzione su Postgres aveva `audit_log`
 * senza `rowHash`/`prevHash` (migration 20260519100000 non eseguita).
 * Ogni AuditLog.findAll esplodeva con "column 'rowHash' does not exist",
 * colpendo ad es. /api/users/me/gdpr/export.
 */

const { sequelize, AuditLog } = require('../../models');
const { runPreSyncMigrations } = require('../../lib/preSyncMigrations');

describe('preSyncMigrations · idempotenza + ricostruzione colonne mancanti', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('audit_log.rowHash/prevHash: dropdown + preSync → colonne ricreate, findAll funziona', async () => {
    const qi = sequelize.getQueryInterface();

    // Verifica baseline: la sync iniziale ha già creato le colonne.
    let desc = await qi.describeTable('audit_log');
    expect(desc.rowHash).toBeDefined();
    expect(desc.prevHash).toBeDefined();

    // Simula DB legacy: rimuove le colonne. SQLite supporta DROP COLUMN
    // dalla 3.35 (in-memory di Node usa la versione bundle, ok). Postgres
    // ha DROP COLUMN nativo.
    await qi.removeColumn('audit_log', 'rowHash');
    await qi.removeColumn('audit_log', 'prevHash');

    desc = await qi.describeTable('audit_log');
    expect(desc.rowHash).toBeUndefined();
    expect(desc.prevHash).toBeUndefined();

    // Esegui preSyncMigrations: deve ricreare le colonne.
    await runPreSyncMigrations();

    desc = await qi.describeTable('audit_log');
    expect(desc.rowHash).toBeDefined();
    expect(desc.prevHash).toBeDefined();

    // Smoke: AuditLog.findAll ora gira senza esplodere.
    const rows = await AuditLog.findAll({ limit: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('runPreSyncMigrations è idempotente: chiamarlo 2 volte non rompe nulla', async () => {
    await expect(runPreSyncMigrations()).resolves.not.toThrow();
    await expect(runPreSyncMigrations()).resolves.not.toThrow();
  });
});
