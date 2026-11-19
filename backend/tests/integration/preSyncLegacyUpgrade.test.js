'use strict';

/**
 * Aggiornamento da uno schema VECCHIO (SQLite).
 *
 * `tests/setup.js` crea lo schema con sync({force:true}): la suite non
 * proverebbe mai il percorso di produzione "DB esistente + nuova versione".
 * Qui partiamo da uno snapshot congelato (tests/fixtures/legacySchema.js),
 * eseguiamo runPreSyncMigrations() + sync() in modalità safe (come
 * server.js) e verifichiamo che ogni colonna dichiarata dai model esista.
 *
 * In più testiamo la capacità `addColumnIfMissing` (idempotenza, backfill,
 * rispetto del dialetto).
 */

const { sequelize } = require('../../models');
const {
  runPreSyncMigrations,
  addColumnIfMissing,
  columnTypes,
  PRE_SYNC_STEPS,
} = require('../../lib/preSyncMigrations');
const { createLegacySchema, LEGACY_TABLES } = require('../fixtures/legacySchema');

// Colonne storiche presenti nei DB legacy ma non (più) nei model.
const NOT_IN_MODEL = { bookings: ['checkInToken'], users: ['icalToken'] };

async function dropEverything() {
  await sequelize.query('PRAGMA foreign_keys = OFF;');
  await sequelize.getQueryInterface().dropAllTables();
  await sequelize.query('PRAGMA foreign_keys = ON;');
}

describe('preSync · aggiornamento da schema legacy congelato', () => {
  afterAll(async () => {
    await dropEverything();
    await globalThis.resetDatabase();
  });

  it('runPreSyncMigrations + sync(safe) allineano le colonne ai model', async () => {
    await dropEverything();
    await createLegacySchema(sequelize);
    const qi = sequelize.getQueryInterface();

    // Baseline: lo snapshot è davvero "vecchio".
    const usersBefore = await qi.describeTable('users');
    expect(usersBefore.status).toBeUndefined();
    expect(usersBefore.twoFaEnabled).toBeUndefined();
    expect(usersBefore.deletedAt).toBeUndefined();

    await runPreSyncMigrations();
    await sequelize.sync(); // come server.js in DB_SYNC_MODE=safe

    const missing = [];
    for (const model of Object.values(sequelize.models)) {
      const table = model.getTableName();
      const desc = await qi.describeTable(table);
      for (const attr of Object.values(model.rawAttributes)) {
        if (!desc[attr.field]) missing.push(`${table}.${attr.field}`);
      }
    }
    expect(missing).toEqual([]);

    // Le tabelle legacy mantengono le colonne storiche che i model non usano.
    for (const [table, cols] of Object.entries(NOT_IN_MODEL)) {
      const desc = await qi.describeTable(table);
      for (const c of cols) expect(desc[c]).toBeDefined();
    }
    expect(LEGACY_TABLES.length).toBeGreaterThan(10);
  });

  it('i dati esistenti ricevono default e backfill corretti', async () => {
    const [[user]] = await sequelize.query('SELECT * FROM users');
    expect(user.status).toBe('approved');
    expect(user.notifyOnConfirmation).toBe(1);
    expect(user.twoFaEnabled).toBe(0);
    expect(user.tokenVersion).toBe(0);
    // iCal: hash SHA-256 calcolato, plaintext azzerato
    expect(user.icalTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(user.icalToken).toBeNull();

    const [[reset]] = await sequelize.query('SELECT purpose FROM password_reset_tokens');
    expect(reset.purpose).toBe('reset');

    const [[inst]] = await sequelize.query('SELECT * FROM institutes');
    expect(inst.moduleMonteOreEnabled).toBe(1);
    expect(inst.initialSetupLinkTtlDays).toBe(14);

    const [[building]] = await sequelize.query('SELECT * FROM buildings');
    expect(building.displayViewMode).toBe('weekly');
    expect(building.displayIntervalSec).toBe(30);
  });

  it('una seconda esecuzione non cambia lo schema', async () => {
    const qi = sequelize.getQueryInterface();
    const snapshot = async () => {
      const out = {};
      for (const t of await qi.showAllTables()) {
        out[t] = Object.keys(await qi.describeTable(t)).sort();
      }
      return out;
    };
    const before = await snapshot();
    await runPreSyncMigrations();
    expect(await snapshot()).toEqual(before);
  });
});

describe('preSync · lista dei passi', () => {
  it('ogni passo ha un nome univoco e una funzione run', () => {
    const names = PRE_SYNC_STEPS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of PRE_SYNC_STEPS) expect(typeof s.run).toBe('function');
  });
});

describe('addColumnIfMissing', () => {
  const TABLE = 'tmp_add_column_probe';

  beforeEach(async () => {
    await sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await sequelize.query(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, label TEXT)`);
    await sequelize.query(`INSERT INTO ${TABLE} (label) VALUES ('a'), ('b')`);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  it('aggiunge la colonna con default e i record esistenti lo ereditano', async () => {
    const added = await addColumnIfMissing(TABLE, 'flag', columnTypes.boolean(true));
    expect(added).toBe(true);
    const [rows] = await sequelize.query(`SELECT flag FROM ${TABLE}`);
    expect(rows.map((r) => r.flag)).toEqual([1, 1]);
  });

  it('è idempotente: la seconda chiamata non fa nulla', async () => {
    expect(await addColumnIfMissing(TABLE, 'n', columnTypes.int(7))).toBe(true);
    expect(await addColumnIfMissing(TABLE, 'n', columnTypes.int(7))).toBe(false);
    const desc = await sequelize.getQueryInterface().describeTable(TABLE);
    expect(Object.keys(desc).filter((c) => c === 'n')).toHaveLength(1);
  });

  it('esegue il backfill solo quando la colonna viene aggiunta', async () => {
    const backfill = vi.fn(() => sequelize.query(`UPDATE ${TABLE} SET note = 'x'`));
    await addColumnIfMissing(TABLE, 'note', columnTypes.nullableString(10), { backfill });
    await addColumnIfMissing(TABLE, 'note', columnTypes.nullableString(10), { backfill });
    expect(backfill).toHaveBeenCalledTimes(1);
    const [rows] = await sequelize.query(`SELECT note FROM ${TABLE}`);
    expect(rows.map((r) => r.note)).toEqual(['x', 'x']);
  });

  it('tabella inesistente (primo avvio): nessuna azione, nessun errore', async () => {
    expect(await addColumnIfMissing('tabella_che_non_esiste', 'c', columnTypes.int(0))).toBe(false);
  });

  it('i tipi best-effort (nullableInt/Float) ignorano gli errori dell’ALTER', async () => {
    const qi = sequelize.getQueryInterface();
    vi.spyOn(qi, 'addColumn').mockRejectedValue(new Error('boom'));
    expect(await addColumnIfMissing(TABLE, 'x', columnTypes.nullableInt())).toBe(false);
    // ...mentre i tipi non best-effort propagano l'errore
    vi.spyOn(qi, 'describeTable').mockResolvedValue({});
    vi.spyOn(sequelize, 'query').mockRejectedValue(new Error('boom'));
    await expect(addColumnIfMissing(TABLE, 'y', columnTypes.boolean(false))).rejects.toThrow(
      'boom',
    );
  });

  describe('rispetto del dialetto', () => {
    function stub(dialect) {
      const qi = sequelize.getQueryInterface();
      vi.spyOn(sequelize, 'getDialect').mockReturnValue(dialect);
      vi.spyOn(qi, 'describeTable').mockResolvedValue({});
      const addColumn = vi.spyOn(qi, 'addColumn').mockResolvedValue();
      const query = vi.spyOn(sequelize, 'query').mockResolvedValue([[], 0]);
      return { addColumn, query };
    }

    it('postgres: DDL grezzo quotato per JSON, addColumn per i tipi standard', async () => {
      const { addColumn, query } = stub('postgres');
      await addColumnIfMissing('t', 'arr', columnTypes.jsonArray());
      expect(query).toHaveBeenCalledWith(
        `ALTER TABLE "t" ADD COLUMN "arr" JSON NOT NULL DEFAULT '[]'::json`,
      );
      await addColumnIfMissing('t', 's', columnTypes.nullableString(64));
      expect(addColumn).toHaveBeenCalledTimes(1);
      expect(addColumn.mock.calls[0].slice(0, 2)).toEqual(['t', 's']);
      expect(addColumn.mock.calls[0][2].allowNull).toBe(true);
    });

    it('mysql: JSON_ARRAY() per il default JSON, DDL non quotato', async () => {
      const { query } = stub('mysql');
      await addColumnIfMissing('t', 'arr', columnTypes.jsonArray());
      expect(query).toHaveBeenCalledWith(
        'ALTER TABLE t ADD COLUMN arr JSON NOT NULL DEFAULT (JSON_ARRAY())',
      );
    });

    it('sqlite: DDL grezzo con default (booleani come INTEGER 0/1)', async () => {
      const { query, addColumn } = stub('sqlite');
      await addColumnIfMissing('t', 'b', columnTypes.boolean(false));
      expect(query).toHaveBeenCalledWith('ALTER TABLE t ADD COLUMN b INTEGER NOT NULL DEFAULT 0');
      expect(addColumn).not.toHaveBeenCalled();
    });
  });
});
