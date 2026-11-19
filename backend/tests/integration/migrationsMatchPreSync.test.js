'use strict';

/**
 * Le migrazioni sequelize-cli che duplicavano un passo di PRE_SYNC_STEPS sono
 * wrapper sottili: su uno schema legacy (SQLite) l'esito di `up()` deve
 * coincidere con quello del passo pre-sync corrispondente (una sola fonte).
 */

const { sequelize } = require('../../models');
const { runPreSyncStep, PRE_SYNC_STEPS } = require('../../lib/preSyncMigrations');
const { createLegacySchema } = require('../fixtures/legacySchema');

const WRAPPERS = [
  ['20260508000000-add-roomid-to-booking-rule-exceptions', ['booking_rule_exceptions.roomId']],
  ['20260514083454-building-checkin-default', ['buildings.checkInDefault']],
  ['20260514100000-oauth-allowed-domains', ['oauth_settings.allowedEmailDomains']],
  ['20260519100000-audit-log-hash-chain', ['audit_log.rowHash', 'audit_log.prevHash']],
  ['20261010090000-monte-ore-workflow', ['monteOreWorkflowMigration']],
  ['20261011000000-academic-year-lifecycle', ['academicYearMigration']],
  ['20261011100000-booking-origin', ['bookingOriginMigration']],
];

async function resetLegacy() {
  await sequelize.query('PRAGMA foreign_keys = OFF;');
  await sequelize.getQueryInterface().dropAllTables();
  await sequelize.query('PRAGMA foreign_keys = ON;');
  await createLegacySchema(sequelize);
  // La migrazione check-in resetta rooms.requireCheckIn (colonna storica, assente
  // dallo snapshot più vecchio): la aggiungiamo identica per entrambi i percorsi.
  const desc = await sequelize.getQueryInterface().describeTable('rooms');
  if (!desc.requireCheckIn) {
    await sequelize.query('ALTER TABLE rooms ADD COLUMN requireCheckIn INTEGER NOT NULL DEFAULT 1');
  }
}

async function snapshot() {
  const qi = sequelize.getQueryInterface();
  const out = {};
  for (const t of (await qi.showAllTables()).sort()) out[t] = await qi.describeTable(t);
  return out;
}

describe('migrazioni sequelize-cli = passi pre-sync (SQLite legacy)', () => {
  afterAll(async () => {
    await sequelize.query('PRAGMA foreign_keys = OFF;');
    await sequelize.getQueryInterface().dropAllTables();
    await sequelize.query('PRAGMA foreign_keys = ON;');
    await globalThis.resetDatabase();
  });

  it('ogni passo referenziato esiste in PRE_SYNC_STEPS', () => {
    const names = new Set(PRE_SYNC_STEPS.map((s) => s.name));
    for (const [, steps] of WRAPPERS) for (const s of steps) expect(names.has(s)).toBe(true);
  });

  it('runPreSyncStep rifiuta un passo sconosciuto', async () => {
    await expect(runPreSyncStep('non.esiste')).rejects.toThrow(/sconosciuto/);
  });

  describe.each(WRAPPERS)('%s', (file, steps) => {
    const migration = require(`../../migrations/${file}`);

    it('up() produce lo stesso schema dei passi pre-sync ed è idempotente', async () => {
      await resetLegacy();
      const before = await snapshot();
      for (const s of steps) await runPreSyncStep(s);
      const viaPreSync = await snapshot();
      expect(viaPreSync).not.toEqual(before); // il passo ha davvero qualcosa da fare

      await resetLegacy();
      const qi = sequelize.getQueryInterface();
      await migration.up(qi, sequelize.Sequelize);
      const viaMigration = await snapshot();

      // Il confronto è sulle sole tabelle toccate dai passi pre-sync: le
      // migrazioni con logica extra (indici, reset dati) non alterano le colonne.
      for (const table of Object.keys(viaPreSync)) {
        if (JSON.stringify(viaPreSync[table]) !== JSON.stringify(before[table])) {
          expect(viaMigration[table]).toEqual(viaPreSync[table]);
        }
      }

      await migration.up(qi, sequelize.Sequelize); // idempotente
      expect(await snapshot()).toEqual(viaMigration);
    });
  });

  it('down() delle colonne duplicate resta reversibile', async () => {
    await resetLegacy();
    const qi = sequelize.getQueryInterface();
    const audit = require('../../migrations/20260519100000-audit-log-hash-chain');
    await audit.up(qi, sequelize.Sequelize);
    expect((await qi.describeTable('audit_log')).rowHash).toBeDefined();
    await audit.down(qi);
    const desc = await qi.describeTable('audit_log');
    expect(desc.rowHash).toBeUndefined();
    expect(desc.prevHash).toBeUndefined();

    const oauth = require('../../migrations/20260514100000-oauth-allowed-domains');
    await oauth.up(qi, sequelize.Sequelize);
    await oauth.down(qi);
    expect((await qi.describeTable('oauth_settings')).allowedEmailDomains).toBeUndefined();
  });
});
