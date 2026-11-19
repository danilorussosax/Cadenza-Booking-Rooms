'use strict';

/**
 * Adeguamenti di schema "manuali" da eseguire PRIMA di sequelize.sync().
 * Servono quando si aggiunge una colonna a un model: in modalità sync({safe})
 * Sequelize non altera tabelle esistenti, e se sulla nuova colonna è definito
 * un indice, sync() prova a crearlo e fallisce con "no such column".
 *
 * Le procedure qui dentro devono essere idempotenti.
 *
 * Struttura:
 *   - `addColumnIfMissing` è l'UNICA capacità "aggiungi colonna se manca":
 *     tabella, colonna e una definizione per dialetto (vedi `columnTypes`).
 *   - `PRE_SYNC_STEPS` è la lista ordinata dei passi, dichiarati una volta
 *     ciascuno; `runPreSyncMigrations` li esegue con un esecutore unico che
 *     emette il log di successo quando il passo ha modificato lo schema.
 *   Per aggiungere una colonna a un model basta una riga in `PRE_SYNC_STEPS`.
 */

const { sequelize } = require('../models');
const logger = require('./logger').child({ scope: 'preSyncMigrations' });

/**
 * Definizioni di colonna per dialetto. Ogni factory restituisce una spec:
 *   - sqlite / postgres / other: DDL grezzo del tipo (dopo "ADD COLUMN nome");
 *     se assente per il dialetto in uso si ricade su `attributes`;
 *   - attributes(DataTypes): definizione per `queryInterface.addColumn`;
 *   - swallowErrors: ogni errore (anche dell'ALTER) diventa "nessuna modifica".
 */
const columnTypes = {
  /** Boolean NOT NULL con default. SQLite: INTEGER 0/1. */
  boolean: (defaultValue = true) => ({
    sqlite: `INTEGER NOT NULL DEFAULT ${defaultValue ? 1 : 0}`,
    attributes: (DataTypes) => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue }),
  }),
  /** Intero NOT NULL con default. */
  int: (defaultValue = 0) => ({
    sqlite: `INTEGER NOT NULL DEFAULT ${Number(defaultValue)}`,
    attributes: (DataTypes) => ({ type: DataTypes.INTEGER, allowNull: false, defaultValue }),
  }),
  /** DATETIME nullable. */
  nullableDate: () => ({
    sqlite: 'DATETIME',
    attributes: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
  }),
  /** Stringa nullable (su SQLite TEXT, la lunghezza non è enforced). */
  nullableString: (length = 500) => ({
    sqlite: 'TEXT',
    attributes: (DataTypes) => ({ type: DataTypes.STRING(length), allowNull: true }),
  }),
  /** TEXT nullable su tutti i dialetti. */
  nullableText: () => ({ sqlite: 'TEXT', postgres: 'TEXT', other: 'TEXT' }),
  /** JSON NOT NULL con default '[]' (SQLite: TEXT). */
  jsonArray: () => ({
    sqlite: "TEXT NOT NULL DEFAULT '[]'",
    postgres: "JSON NOT NULL DEFAULT '[]'::json",
    // MySQL/MariaDB: JSON con DEFAULT richiede sintassi specifica
    other: 'JSON NOT NULL DEFAULT (JSON_ARRAY())',
  }),
  /** JSON nullable (SQLite: TEXT). */
  nullableJson: () => ({ sqlite: 'TEXT', postgres: 'JSON', other: 'JSON' }),
  /** Intero nullable; best-effort: qualunque errore è ignorato. */
  nullableInt: () => ({
    swallowErrors: true,
    attributes: (DataTypes) => ({ type: DataTypes.INTEGER, allowNull: true }),
  }),
  /** Float nullable; best-effort: qualunque errore è ignorato. */
  nullableFloat: () => ({
    swallowErrors: true,
    attributes: (DataTypes) => ({ type: DataTypes.FLOAT, allowNull: true }),
  }),
  /** ENUM NOT NULL con default (SQLite non ha ENUM: TEXT con default). */
  enumColumn: (values, defaultValue) => ({
    sqlite: `TEXT NOT NULL DEFAULT '${defaultValue}'`,
    attributes: (DataTypes) => ({
      type: DataTypes.ENUM(...values),
      allowNull: false,
      defaultValue,
    }),
  }),
};

/**
 * Aggiunge `table.name` se la colonna manca. Idempotente.
 *
 * - Tabella inesistente (primo avvio): non fa nulla, sync() la creerà.
 * - `opts.backfill`: funzione async eseguita subito dopo l'aggiunta (solo se
 *   la colonna è stata effettivamente aggiunta).
 *
 * @returns {Promise<boolean>} true se la colonna è stata aggiunta.
 */
async function addColumnIfMissing(table, name, spec, opts = {}) {
  const attempt = async () => {
    const qi = sequelize.getQueryInterface();
    let desc;
    try {
      desc = await qi.describeTable(table);
    } catch {
      return false;
    }
    if (desc[name]) return false;

    const dialect = sequelize.getDialect();
    let raw;
    if (dialect === 'sqlite') raw = spec.sqlite;
    else if (dialect === 'postgres') raw = spec.postgres;
    else raw = spec.other;

    if (raw !== undefined) {
      await sequelize.query(
        dialect === 'postgres'
          ? `ALTER TABLE "${table}" ADD COLUMN "${name}" ${raw}`
          : `ALTER TABLE ${table} ADD COLUMN ${name} ${raw}`,
      );
    } else {
      await qi.addColumn(table, name, spec.attributes(sequelize.Sequelize.DataTypes));
    }
    if (opts.backfill) await opts.backfill();
    return true;
  };

  if (!spec.swallowErrors) return attempt();
  try {
    return await attempt();
  } catch {
    return false;
  }
}

// Wrapper storici (esportati e usati da test e da altri moduli).
function ensureUserStatusColumn() {
  return addColumnIfMissing(
    'users',
    'status',
    columnTypes.enumColumn(['pending', 'approved', 'rejected'], 'approved'),
  );
}

function ensureUserBooleanColumn(name) {
  return addColumnIfMissing('users', name, columnTypes.boolean(true));
}

function ensureNullableStringColumn(table, name, length = 500) {
  return addColumnIfMissing(table, name, columnTypes.nullableString(length));
}

// ---------------------------------------------------------------------------
// Operazioni dedicate (Postgres-only / difese runtime)
// ---------------------------------------------------------------------------

/**
 * Difesa runtime per installazioni che non hanno eseguito `db:cli:migrate`
 * dopo l'introduzione della cascata Building→Room per il check-in QR.
 * Verifica `rooms.requireCheckIn`: se è ancora NOT NULL la rilassa a NULLABLE.
 * Idempotente.
 */
async function relaxRoomsRequireCheckInNullable() {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    // SQLite non supporta ALTER COLUMN. Le tabelle test girano già sul
    // modello aggiornato; nessuna azione necessaria.
    return false;
  }
  try {
    const [rows] = await sequelize.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'rooms' AND column_name = 'requireCheckIn'`,
    );
    if (!rows.length || rows[0].is_nullable !== 'NO') return false;
    await sequelize.query('ALTER TABLE rooms ALTER COLUMN "requireCheckIn" DROP NOT NULL');
    await sequelize.query('ALTER TABLE rooms ALTER COLUMN "requireCheckIn" DROP DEFAULT');
    return true;
  } catch (err) {
    logger.warn(`  ⚠ Impossibile rilassare rooms.requireCheckIn a NULLABLE: ${err.message}`);
    return false;
  }
}

async function ensurePostgresEnumValue(enumTypeName, value) {
  if (sequelize.getDialect() !== 'postgres') return false;
  try {
    const [rows] = await sequelize.query(
      'SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = :type AND e.enumlabel = :val',
      { replacements: { type: enumTypeName, val: value } },
    );
    if (rows.length > 0) return false;
    await sequelize.query(
      `ALTER TYPE "${enumTypeName}" ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}'`,
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Passi "custom" (backfill, cleanup, operazioni Postgres-only)
// ---------------------------------------------------------------------------

/**
 * Per-instrument course allowlist (sostituisce InstrumentLoanRule per-famiglia).
 * Backfill idempotente delle allowedCourseIds dagli InstrumentLoanRule
 * legacy. Riguarda SOLO gli strumenti con allowedCourseIds vuoto (default
 * della colonna): se gli admin hanno già configurato esplicitamente, il
 * valore viene preservato.
 */
async function backfillInstrumentCourseAllowlist() {
  try {
    const { Instrument, InstrumentLoanRule } = require('../models');
    const legacyRules = await InstrumentLoanRule.findAll().catch(() => []);
    let migrated = 0;
    for (const rule of legacyRules) {
      const ids = Array.isArray(rule.allowedCourseIds) ? rule.allowedCourseIds : [];
      if (ids.length === 0) continue;
      // Idempotente: aggiorna solo gli strumenti che hanno allowedCourseIds
      // vuoto (== JSON di array vuoto, oppure NULL). Gli admin che avessero
      // già personalizzato lo strumento non vengono toccati.
      const allInstruments = await Instrument.findAll({
        where: { family: rule.family },
        attributes: ['id', 'allowedCourseIds'],
      });
      for (const instr of allInstruments) {
        const current = Array.isArray(instr.allowedCourseIds) ? instr.allowedCourseIds : [];
        if (current.length > 0) continue; // già personalizzato
        await Instrument.update({ allowedCourseIds: ids }, { where: { id: instr.id } });
        migrated += 1;
      }
    }
    if (migrated > 0) {
      logger.info(`  ✓ Migrate regole prestito legacy → ${migrated} strumenti aggiornati`);
    }
  } catch (err) {
    // Non blocca lo startup: la migration legacy è best-effort.
    if (!/no such table|does not exist|relation .* does not exist/i.test(err.message)) {
      logger.warn(`  ⚠ Migrazione regole prestito legacy fallita: ${err.message}`);
    }
  }
}

/**
 * Monte Ore — pulizia delle proposte orfane: utenti soft-deleted (paranoid)
 * di cui in passato non era stata cancellata la proposta dalla DELETE route.
 * La cascade FK non scatta sul soft-delete, quindi i record restano orfani
 * e compaiono in "Gestione Monte ore" con user=null. Hard-delete idempotente
 * delle proposte i cui userId puntano a un utente con deletedAt valorizzato.
 * Schedules/slots/amendments seguono via CASCADE FK (tabelle non paranoid).
 */
async function cleanupOrphanMonteOreProposals() {
  try {
    const { MonteOreProposal, User } = require('../models');
    const orphans = await MonteOreProposal.findAll({
      attributes: ['id'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id'],
          paranoid: false,
          required: true,
          where: { deletedAt: { [require('sequelize').Op.ne]: null } },
        },
      ],
    });
    if (orphans.length > 0) {
      const ids = orphans.map((o) => o.id);
      await MonteOreProposal.destroy({ where: { id: ids } });
      logger.info(`  ✓ Rimosse ${ids.length} proposte Monte Ore orfane (utenti cancellati)`);
    }
  } catch (err) {
    if (!/no such table|does not exist|relation .* does not exist/i.test(err.message)) {
      logger.warn(`  ⚠ Cleanup proposte Monte Ore orfane fallito: ${err.message}`);
    }
  }
}

/**
 * iCal token — hash SHA-256 al rest, plaintext rimosso dal DB.
 * Sequenza idempotente (la colonna legacy `icalToken` non è più nel modello,
 * quindi tutto via raw SQL):
 *   1. backfill: hash dei token in chiaro che non hanno ancora l'hash
 *      (zero-rottura per i client già subscribed: il lookup è via hash);
 *   2. wipe: azzera il plaintext residuo;
 *   3. drop colonna (solo Postgres: su SQLite removeColumn ricostruisce la
 *      tabella, rischioso — la colonna vuota resta, inerte).
 */
async function migrateIcalTokenToHash() {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('users');
    if (desc.icalToken) {
      const cryptoMod = require('crypto');
      const [rows] = await sequelize.query(
        'SELECT id, "icalToken" AS plain FROM users WHERE "icalToken" IS NOT NULL AND "icalTokenHash" IS NULL',
      );
      for (const u of rows) {
        const hash = cryptoMod.createHash('sha256').update(u.plain).digest('hex');
        await sequelize.query('UPDATE users SET "icalTokenHash" = $hash WHERE id = $id', {
          bind: { hash, id: u.id },
        });
      }
      if (rows.length > 0) {
        logger.info(`  ✓ Backfill icalTokenHash per ${rows.length} utenti esistenti`);
      }
      await sequelize.query('UPDATE users SET "icalToken" = NULL WHERE "icalToken" IS NOT NULL');
      if (sequelize.getDialect() === 'postgres') {
        await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS "icalToken"');
        logger.info('  ✓ Colonna legacy users.icalToken droppata');
      } else {
        logger.info('  ✓ Plaintext iCal azzerato (colonna legacy lasciata vuota su sqlite)');
      }
    }
  } catch (err) {
    if (!/no such table|does not exist|relation .* does not exist/i.test(err.message)) {
      logger.warn(`  ⚠ Migrazione icalToken→hash fallita: ${err.message}`);
    }
  }
}

/**
 * Step 4: scope ampliati per BookingQuota.scopeKind (Postgres only).
 * SQLite non enforce ENUM (i valori passano comunque). Su Postgres serve
 * ALTER TYPE per aggiungere i nuovi valori.
 */
async function extendBookingQuotaScopeKindEnum() {
  if (sequelize.getDialect() !== 'postgres') return;
  try {
    await sequelize.query(`
        ALTER TYPE "enum_booking_quotas_scopeKind" ADD VALUE IF NOT EXISTS 'room';
      `);
    await sequelize.query(`
        ALTER TYPE "enum_booking_quotas_scopeKind" ADD VALUE IF NOT EXISTS 'building';
      `);
  } catch (err) {
    // Se l'enum type non esiste ancora (DB nuovo), verrà creato da sync()
    // con i 5 valori dal model. Non fatale.
    logger.warn(`  ⚠ ALTER TYPE scopeKind: ${err.message}`);
  }
}

/**
 * rooms.qrToken: indice UNIQUE WHERE qrToken IS NOT NULL — Postgres supporta
 * partial unique; SQLite (test) non lo richiede perché test seed non popola
 * il campo.
 */
async function createRoomQrTokenUniqueIndex() {
  if (sequelize.getDialect() !== 'postgres') return;
  try {
    await sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS rooms_qr_token_unique ON rooms ("qrToken") WHERE "qrToken" IS NOT NULL',
    );
  } catch (err) {
    logger.warn(`  ⚠ Indice rooms_qr_token_unique non creato: ${err.message}`);
  }
}

/**
 * Indici compositi additivi su tabelle ad alta lettura (Postgres). I model
 * dichiarano gli stessi indici per le installazioni fresche; qui li
 * aggiungiamo a DB esistenti che hanno solo i vecchi indici a colonna
 * singola. CREATE INDEX IF NOT EXISTS è idempotente: no-op se l'indice
 * esiste già. I vecchi indici single-column non vengono droppati in
 * automatico (write overhead trascurabile sulle tabelle interessate); per
 * consolidare basta una migration manuale una tantum.
 */
async function ensureCompositeIndexes() {
  if (sequelize.getDialect() !== 'postgres') return;
  const compositeIndexes = [
    {
      name: 'announcements_active_feed_idx',
      sql: 'CREATE INDEX IF NOT EXISTS announcements_active_feed_idx ON announcements ("isActive", "publishedAt", "expiresAt")',
      table: 'announcements',
    },
    {
      name: 'monte_ore_schedules_proposal_day_idx',
      sql: 'CREATE INDEX IF NOT EXISTS monte_ore_schedules_proposal_day_idx ON monte_ore_schedules ("proposalId", "dayOfWeek")',
      table: 'monte_ore_schedules',
    },
    {
      // Hot-path della generate booking + recomputeTotals: filtro per
      // proposta + stato attivo/locked su tabella ~15k righe per istituto.
      name: 'monte_ore_slots_proposal_active_locked_idx',
      sql: 'CREATE INDEX IF NOT EXISTS monte_ore_slots_proposal_active_locked_idx ON monte_ore_slots ("proposalId", "isActive", "isLocked")',
      table: 'monte_ore_slots',
    },
    {
      name: 'integration_sync_runs_config_created_idx',
      sql: 'CREATE INDEX IF NOT EXISTS integration_sync_runs_config_created_idx ON integration_sync_runs ("configId", "createdAt")',
      table: 'integration_sync_runs',
    },
    {
      name: 'integration_sync_runs_provider_status_started_idx',
      sql: 'CREATE INDEX IF NOT EXISTS integration_sync_runs_provider_status_started_idx ON integration_sync_runs ("provider", "status", "startedAt")',
      table: 'integration_sync_runs',
    },
  ];
  for (const idx of compositeIndexes) {
    try {
      const [existing] = await sequelize.query(
        `SELECT 1 FROM pg_class WHERE relname = '${idx.name}' AND relkind = 'i'`,
      );
      if (existing.length > 0) continue;
      await sequelize.query(idx.sql);
      logger.info(`  ✓ Indice composito ${idx.name} creato su ${idx.table}`);
    } catch (err) {
      logger.warn(`  ⚠ Indice ${idx.name} non creato: ${err.message}`);
    }
  }
}

/**
 * Postgres-only: aggiunge `bookings_no_overlap` come EXCLUDE constraint.
 *
 *   CREATE EXTENSION IF NOT EXISTS btree_gist;
 *   ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
 *     EXCLUDE USING gist (
 *       "roomId" WITH =,
 *       tstzrange("startTime", "endTime", '[)') WITH &&
 *     ) WHERE (status = 'confirmed' AND "deletedAt" IS NULL);
 *
 * NB su tstzrange vs tsrange: Sequelize mappa DataTypes.DATE → TIMESTAMPTZ
 * (timestamp WITH TIME ZONE). `tsrange()` accetta solo `timestamp` senza TZ
 * e fallisce con "function tsrange(timestamp with time zone, ...) does not
 * exist". `tstzrange` è la variante TZ-aware e gestisce correttamente i
 * confronti tra istanti astronomici, indipendentemente dalla timezone client.
 *
 * Comportamento:
 *   - Se non siamo su Postgres → no-op silenzioso.
 *   - Se la constraint esiste già → no-op.
 *   - Se l'extension è già attiva → riusa.
 *   - Se l'ALTER fallisce per dati pre-esistenti che già si sovrappongono
 *     (ERRCODE 23P01 = exclusion_violation), logga un warn e prosegue:
 *     lo startup non viene bloccato. L'amministratore vedrà il warn e
 *     potrà ripulire i duplicati a mano via psql / UI admin booking.
 *
 * Idempotente: rieseguibile.
 */
async function ensureBookingsNoOverlapConstraint() {
  if (sequelize.getDialect() !== 'postgres') return;

  const CONSTRAINT_NAME = 'bookings_no_overlap';

  // Verifica esistenza constraint
  const [rows] = await sequelize.query(`SELECT 1 FROM pg_constraint WHERE conname = $name`, {
    bind: { name: CONSTRAINT_NAME },
  });
  if (rows.length > 0) return; // già presente

  try {
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
  } catch (err) {
    // Senza permessi di SUPERUSER su shared databases (alcuni provider
    // managed) la CREATE EXTENSION fallisce. In quel caso la constraint
    // a sua volta fallirà: il blocco `try` sotto se ne occupa.
    logger.warn(`  ⚠ btree_gist non installabile (${err.message}); provo comunque...`);
  }

  try {
    // L'identificatore va doppio-quotato (camelCase). Postgres distingue
    // maiuscole/minuscole per gli identificatori solo se quotati.
    await sequelize.query(`
      ALTER TABLE bookings
        ADD CONSTRAINT ${CONSTRAINT_NAME}
        EXCLUDE USING gist (
          "roomId" WITH =,
          tstzrange("startTime", "endTime", '[)') WITH &&
        ) WHERE (status = 'confirmed' AND "deletedAt" IS NULL)
    `);
    logger.info(`  ✓ Constraint ${CONSTRAINT_NAME} aggiunta su bookings (rete sicurezza DB-level)`);
  } catch (err) {
    // Possibili cause:
    //  - dati esistenti che si sovrappongono → ERRCODE 23P01 / 23505
    //  - btree_gist non installato e non installabile
    //  - permessi insufficienti
    // Non bloccante: il validator applicativo resta la prima linea.
    logger.warn(`  ⚠ Impossibile aggiungere ${CONSTRAINT_NAME}: ${err.message}`);
    logger.warn(
      '  ⚠ Lo startup prosegue. La validazione overlap resta gestita solo dal validator applicativo.',
    );
    logger.warn(
      '  ⚠ Per riprovare in seguito: ripulisci i duplicati overlapping e rilancia lo startup.',
    );
  }
}

/**
 * Postgres-only: ripristina ON DELETE CASCADE sulle FK di monte_ore_slots
 * verso monte_ore_schedules e monte_ore_proposals.
 *
 * Quando sequelize.sync() crea le tabelle la prima volta usa la cascade
 * dichiarata in models/index.js. Ma se il DB esisteva PRIMA che venisse
 * dichiarata la cascade (o se sync è stato eseguito in modalità safe senza
 * alter), le FK in produzione restano NO ACTION → cancellando una riga
 * MonteOreSchedule la DELETE fallisce con FK violation, oppure (in assenza
 * di FK reale) gli slot restano orfani.
 *
 * Idempotente: ad ogni avvio rileva il nome della constraint esistente,
 * la droppa solo se NON ha già ON DELETE CASCADE, e la ricrea.
 * No-op sui dialetti non-Postgres (SQLite non supporta ALTER per FK; MySQL
 * userà sintassi diversa, non coperto qui — il deploy di produzione è PG).
 */
async function ensureMonteOreSlotsCascadeFk() {
  if (sequelize.getDialect() !== 'postgres') return;

  // Verifica che la tabella esista (primo avvio: sync la creerà dopo).
  try {
    await sequelize.getQueryInterface().describeTable('monte_ore_slots');
  } catch {
    return;
  }

  const targets = [
    { column: 'scheduleId', refTable: 'monte_ore_schedules' },
    { column: 'proposalId', refTable: 'monte_ore_proposals' },
  ];

  for (const { column, refTable } of targets) {
    // Trova il nome reale della FK su (monte_ore_slots, column) e la sua
    // delete_rule attuale. Se manca, la creiamo; se c'è ma non CASCADE, la
    // droppiamo e la ricreiamo.
    const [rows] = await sequelize.query(
      `SELECT tc.constraint_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.table_name = 'monte_ore_slots'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = $col`,
      { bind: { col: column } },
    );

    const current = rows[0];
    if (current && current.delete_rule === 'CASCADE') continue; // già OK

    try {
      if (current) {
        await sequelize.query(
          `ALTER TABLE monte_ore_slots DROP CONSTRAINT "${current.constraint_name}"`,
        );
      }
      const newName = `monte_ore_slots_${column}_fkey`;
      await sequelize.query(
        `ALTER TABLE monte_ore_slots
           ADD CONSTRAINT "${newName}"
           FOREIGN KEY ("${column}") REFERENCES "${refTable}" (id)
           ON DELETE CASCADE`,
      );
      logger.info(`  ✓ FK monte_ore_slots.${column} → ${refTable} ricreata con ON DELETE CASCADE`);
    } catch (err) {
      // Non bloccante: se la ricreazione fallisce (es. dati orfani che
      // violerebbero la FK), il sistema continua a girare con la vecchia
      // constraint. L'admin vedrà il warn e potrà ripulire a mano.
      logger.warn(
        `  ⚠ Impossibile ripristinare CASCADE su monte_ore_slots.${column}: ${err.message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Lista ordinata dei passi
// ---------------------------------------------------------------------------

const T = columnTypes;

/**
 * Passo "aggiungi colonna": `log` (opzionale) è emesso a livello info solo se
 * la colonna è stata aggiunta; `after` (opzionale) gira dopo il log.
 */
function column(table, name, spec, logSuffix = '', extra = {}) {
  return {
    name: `${table}.${name}`,
    run: () => addColumnIfMissing(table, name, spec, { backfill: extra.backfill }),
    log: logSuffix === false ? undefined : `  ✓ Colonna ${table}.${name} aggiunta${logSuffix}`,
    after: extra.after,
  };
}

/** Passo generico: `run` può restituire true per attivare `log`. */
function step(name, run, log) {
  return { name, run, log };
}

/** Stessa definizione di colonna ripetuta su più nomi della stessa tabella. */
const columns = (table, names, spec, logSuffix = '') =>
  names.map((n) => column(table, n, spec, logSuffix));

const PARANOID_TABLES = [
  'users',
  'courses',
  'institutes',
  'buildings',
  'rooms',
  'equipment',
  'bookings',
  'concert_info',
  'instruments',
  'instrument_loans',
];

const PRE_SYNC_STEPS = [
  step('academicYearMigration', () =>
    require('./academicYearMigration').up(sequelize.getQueryInterface()),
  ),
  step('monteOreWorkflowMigration', () =>
    require('./monteOreWorkflowMigration').up(sequelize.getQueryInterface()),
  ),
  step('bookingOriginMigration', () =>
    require('./bookingOriginMigration').up(sequelize.getQueryInterface()),
  ),
  step(
    'users.status',
    ensureUserStatusColumn,
    "  ✓ Colonna users.status aggiunta (utenti esistenti = 'approved')",
  ),

  // Preferenze email granulari (Conferma / Promemoria / Cancellazione)
  ...columns(
    'users',
    ['notifyOnConfirmation', 'notifyOnReminder', 'notifyOnCancellation'],
    T.boolean(true),
    ' (default = true)',
  ),

  // Versionamento dei JWT validi (per logout/cambio password effettivo).
  column('users', 'tokenVersion', T.int(0), ' (default = 0)'),

  // 2FA via codice email — opt-in. Sempre disabilitato di default per
  // utenti esistenti. La colonna `twoFaSecretEncrypted` resta per backward
  // compat con DB già migrati alla precedente versione TOTP (non più usata).
  column('users', 'twoFaEnabled', T.boolean(false), ' (default = false)'),
  column('users', 'twoFaSecretEncrypted', T.nullableString(500), ' (deprecated)'),
  column('users', 'twoFaChallenge', T.nullableJson(), ' (sfida email in corso)'),
  column('users', 'twoFaRecoveryCodes', T.nullableJson()),
  column('users', 'twoFaActivatedAt', T.nullableDate()),

  // Bot messaging — challenge OTP per binding canale↔utente.
  column('users', 'botBindingChallenge', T.nullableJson(), ' (binding bot)'),

  // Account lockout — brute force distribuito (oltre al rate-limit per IP).
  column('users', 'failedLoginAttempts', T.int(0), ' (account lockout, default = 0)'),
  column('users', 'lockedUntil', T.nullableDate(), ' (account lockout TTL)'),

  // Foto aula
  column('rooms', 'photoUrl', T.nullableString(500)),

  // Configurazione kiosk /display per edificio (rotazione)
  column('buildings', 'displayEnabled', T.boolean(true), ' (default = true)'),
  column('buildings', 'displayIntervalSec', T.int(30), ' (default = 30)'),
  column('buildings', 'displayConcertsDays', T.int(30), ' (default = 30)'),
  column('buildings', 'displayConcertsEnabled', T.boolean(true), ' (default = true)'),
  column('buildings', 'displayConcertsCount', T.int(0), ' (default = 0)'),
  column('buildings', 'displayConcertsIntervalSec', T.int(15), ' (default = 15)'),
  // Workflow approvazione su prenotazioni high-impact (sale concerti, ecc).
  column('rooms', 'requiresApproval', T.boolean(false), ' (default = false)'),
  step(
    'enum_bookings_status.pending_approval',
    () => ensurePostgresEnumValue('enum_bookings_status', 'pending_approval'),
    "  ✓ ENUM bookings.status esteso con 'pending_approval'",
  ),

  column('buildings', 'displayBookingsEnabled', T.boolean(true), ' (default = true)'),
  column('buildings', 'displayAnnouncementsEnabled', T.boolean(true), ' (default = true)'),
  column('buildings', 'displayAnnouncementsCount', T.int(5), ' (default = 5)'),
  column('buildings', 'displayAnnouncementsIntervalSec', T.int(12), ' (default = 12)'),
  column('buildings', 'displayAnnouncementsPinnedOnly', T.boolean(false), ' (default = false)'),

  // Modalità visualizzazione kiosk per building: 'weekly' (default) | 'daily'
  // Postgres: ENUM('weekly','daily'); SQLite: TEXT con default 'weekly'.
  column(
    'buildings',
    'displayViewMode',
    T.enumColumn(['weekly', 'daily'], 'weekly'),
    " (default 'weekly')",
  ),

  // Sistema check-in / anti ghost-booking
  // (P2-5) `checkInToken` è dead code dalla v1.x: lasciamo creare la colonna
  // sui DB legacy per non rompere lo schema (Sequelize la ignora se non è
  // più nel model), ma RIMOSSO il backfill — i nuovi booking non ne hanno
  // bisogno e quelli vecchi che hanno NULL restano NULL senza problemi.
  column('bookings', 'checkInToken', T.nullableString(64), ' (deprecated, non usata)'),
  column('bookings', 'checkedInAt', T.nullableDate()),
  column('bookings', 'autoCancelledAt', T.nullableDate()),

  // Toggle check-in QR per aula. Dalla migration
  // 20260514083454-building-checkin-default la colonna è nullable
  // (null = eredita Building.checkInDefault).
  column('rooms', 'requireCheckIn', T.boolean(true), ' (default = true)'),
  // Difesa: se la colonna esiste ma è ancora NOT NULL (DB non migrato),
  // rilassa il vincolo qui al boot così non blocchiamo INSERT con null.
  // Errore tipico segnalato dagli admin: 'null value in column "requireCheckIn"
  // violates not-null constraint' su DB che non hanno eseguito db:cli:migrate.
  step(
    'rooms.requireCheckIn.nullable',
    relaxRoomsRequireCheckInNullable,
    '  ✓ Colonna rooms.requireCheckIn rilassata a NULLABLE (preSync)',
  ),
  // Default check-in per edificio (impostazione generale).
  column('buildings', 'checkInDefault', T.boolean(false), ' (default = false)'),

  // QR-code token per aula. Generato lazy al primo download/regenerate via
  // route /api/structure/rooms/:id/qr/* — non popolato qui per evitare
  // overhead in startup.
  column('rooms', 'qrToken', T.nullableString(64), '', {
    after: createRoomQrTokenUniqueIndex,
  }),

  // Per-instrument course allowlist (sostituisce InstrumentLoanRule per-famiglia).
  column('instruments', 'allowedCourseIds', T.jsonArray(), ' (default [])'),
  step('instruments.allowedCourseIds.backfill', backfillInstrumentCourseAllowlist),

  // Campi anagrafici/legali su Institute (Privacy Policy, Termini, GDPR).
  // Tutti nullable: gli istituti esistenti restano validi; l'admin li compila
  // dalla pagina di gestione.
  ...columns(
    'institutes',
    [
      'legalName',
      'vatNumber',
      'fiscalCode',
      'pecEmail',
      'contactEmail',
      'dpoName',
      'dpoEmail',
      'jurisdictionCity',
    ],
    T.nullableString(255),
  ),
  column('institutes', 'subProcessors', T.nullableJson()),

  // Sicurezza check-in: toggle e CIDR allowlist della rete d'istituto.
  // Aggiunti come default false / [] su istituti esistenti — comportamento
  // invariato finché l'admin non li abilita esplicitamente da
  // /admin/server-settings tab "QR Code".
  column('institutes', 'checkInRequireInstituteNetwork', T.boolean(false)),
  column('institutes', 'instituteNetworkCidrs', T.nullableJson()),

  // Module flags (Monte Ore, Prestito strumenti) — toggle puramente di
  // presentazione che governano la visibilità dei link in sidebar. Default
  // true su istituti esistenti per non modificare il comportamento corrente.
  column('institutes', 'moduleMonteOreEnabled', T.boolean(true)),
  column('institutes', 'moduleInstrumentLoansEnabled', T.boolean(true)),

  // App icon scelta dall'admin: TEXT nullable. Default NULL = l'app ricade su
  // `/logo3.png` (il brand mark di default).
  column('institutes', 'appIconUrl', T.nullableText()),

  // Soft delete (paranoid): deletedAt nullable sulle tabelle core.
  // Sequelize aggiunge la colonna automaticamente alle tabelle nuove via sync()
  // ma su quelle preesistenti dobbiamo aggiungerla qui.
  ...PARANOID_TABLES.map((table) => column(table, 'deletedAt', T.nullableDate(), ' (soft delete)')),

  // BookingRule — intervallo minimo tra prenotazioni dello stesso utente
  // (cooldown). Default 0 = comportamento precedente, no rotture.
  column('booking_rules', 'minIntervalBetweenBookingsMinutes', T.int(0), ' (default 0)'),

  // Estensioni granulari BookingQuota (step 3 della roadmap quote).
  // Tutti i nuovi campi sono opzionali con default → backward compatible.
  column('booking_quotas', 'maxHoursPerMonth', T.int(0), ' (default 0)'),
  column('booking_quotas', 'maxBookings', T.int(0), ' (default 0)'),
  column('booking_quotas', 'daysOfWeek', T.jsonArray(), ' (default [])'),
  column('booking_quotas', 'timeFrom', T.nullableString(5)),
  column('booking_quotas', 'timeTo', T.nullableString(5)),

  // Step 4: scope ampliati per BookingQuota.scopeKind (Postgres only).
  step('enum_booking_quotas_scopeKind', extendBookingQuotaScopeKindEnum),

  // Rete di sicurezza DB-level: due booking confermate sulla stessa room
  // non possono mai sovrapporsi nel tempo, anche se il validator applicativo
  // (services/bookingValidator.js) avesse un bug. EXCLUDE GiST + tsrange.
  // Solo Postgres: SQLite/MySQL non supportano EXCLUDE constraint.
  step('bookings_no_overlap', ensureBookingsNoOverlapConstraint),

  // Monte Ore — deroga individuale (contratto orario / casi speciali).
  // Tutte additive con default sicuri: zero data loss, comportamento
  // invariato per gli utenti esistenti finché l'admin non valorizza l'override.
  column('users', 'contractType', T.nullableString(40), ' (Monte Ore)'),
  column('users', 'monteOreAnnualHoursOverride', T.nullableFloat()),
  column('users', 'monteOreBypassDayConstraint', T.boolean(false)),
  column('users', 'monteOreOverrideReason', T.nullableString(500)),
  column('users', 'monteOreOverrideSetAt', T.nullableDate()),
  column('users', 'monteOreOverrideSetBy', T.nullableInt()),

  // Integrazioni esterne: campi su users + tabelle integration_*.
  // Le tabelle nuove vengono create da sequelize.sync() al primo avvio;
  // qui ci occupiamo SOLO delle nuove colonne su `users` (tabella già
  // esistente sui DB pre-feature).
  column('users', 'externalSource', T.nullableString(32), ' (integrazioni)'),
  column('users', 'externalId', T.nullableString(64), ' (integrazioni)'),
  column('users', 'externalStatusNote', T.nullableString(1024), ' (integrazioni)'),
  column('users', 'lastExternalSyncAt', T.nullableDate(), ' (integrazioni)'),

  // Monte Ore — pulizia delle proposte orfane (utenti soft-deleted).
  step('monte_ore_proposals.orphans', cleanupOrphanMonteOreProposals),

  // Monte Ore — nuove colonne su monte_ore_proposals (pattern + soglia + amendment).
  // Le tabelle settings/suspensions/slots/amendments sono nuove e create da sync().
  column('monte_ore_proposals', 'workingDaysCount', T.nullableInt(), false),
  column('monte_ore_proposals', 'minRequiredHoursSnapshot', T.nullableFloat(), false),
  column('monte_ore_proposals', 'amendmentCount', T.int(0)),
  // totalHoursPlanned è float; se non c'è già lo aggiungiamo come nullable
  // (il default verrà settato dall'app a 0 in fase di create/update).
  column('monte_ore_proposals', 'totalHoursPlanned', T.nullableFloat(), false),

  // Monte Ore — link opzionale tra sospensione e BookingRuleException
  // (per applicare il blocco anche alle prenotazioni regolari).
  column('monte_ore_suspensions', 'bookingRuleExceptionId', T.nullableInt(), false),

  // Monte Ore — campi per slot "fuori pattern" creati da amendment
  // add_new_day. Quando scheduleId è NULL queste colonne forniscono le
  // informazioni necessarie per materializzare il Booking corrispondente.
  column('monte_ore_slots', 'roomId', T.nullableInt(), false),
  column('monte_ore_slots', 'bookingType', T.nullableString(40), ' (slot fuori pattern)'),
  column('monte_ore_slots', 'purpose', T.nullableString(255), ' (slot fuori pattern)'),

  // Monte Ore — garantisce CASCADE su monte_ore_slots.scheduleId e
  // monte_ore_slots.proposalId (Postgres). Le associazioni Sequelize hanno
  // onDelete:CASCADE ma sync() applica la FK solo alla prima creazione: su
  // DB esistenti la constraint resta NO ACTION e cancellando una schedule
  // si lasciano slot orfani.
  step('monte_ore_slots.cascadeFk', ensureMonteOreSlotsCascadeFk),

  // Monte Ore — Fase 6.1: deroga individuale alla finestra di submission.
  column('users', 'monteOreSubmissionAllowedUntil', T.nullableDate(), ' (deroga finestra)'),

  // Monte Ore — Fase 6.3: flag rivalidazione su proposta esistente quando
  // l'admin cambia contratto/ore in corso d'anno.
  column('monte_ore_proposals', 'requiresRevalidation', T.boolean(false)),
  column('monte_ore_proposals', 'revalidationReason', T.nullableString(500)),

  // Monte Ore — nuovi kind amendment per spostamenti (change_room, move_to).
  // SQLite non enforce ENUM: i nuovi valori passano comunque. Su Postgres
  // serve ALTER TYPE per aggiungere i valori al tipo enum esistente.
  step(
    'enum_monte_ore_amendments_kind.change_room',
    () => ensurePostgresEnumValue('enum_monte_ore_amendments_kind', 'change_room'),
    '  ✓ ENUM monte_ore_amendments_kind: valore change_room aggiunto',
  ),
  step(
    'enum_monte_ore_amendments_kind.move_to',
    () => ensurePostgresEnumValue('enum_monte_ore_amendments_kind', 'move_to'),
    '  ✓ ENUM monte_ore_amendments_kind: valore move_to aggiunto',
  ),

  // iCal token → hash (backfill + wipe + drop colonna legacy).
  column('users', 'icalTokenHash', T.nullableString(64)),
  step('users.icalToken.migrate', migrateIcalTokenToHash),

  // Booking type catalog (gap #7 EasyRoom parity): il seed dei 5 system
  // rows è in `seeders/initial.js`, eseguito DOPO sequelize.sync() così la
  // tabella esiste. Qui non c'è nulla da fare in preSyncMigrations.

  // Fase 3 — Throttle outbox per destinatario (mail_settings.throttlePerRecipientPerHour)
  column('mail_settings', 'throttlePerRecipientPerHour', T.int(0), ' (default 0 = disabilitato)'),

  // Fase 3 — Hard-bounce tracking su User (skip future enqueueMail).
  column('users', 'emailBouncedAt', T.nullableDate()),
  column('users', 'emailBouncedReason', T.nullableString(500)),

  // Eccezioni regole prenotazione: scope per aula (null = tutte le aule, comportamento storico).
  // La FK e gli indici li gestisce sequelize.sync() dopo questo blocco; qui basta aggiungere
  // la colonna così che addIndex sul model non fallisca con "no such column".
  column('booking_rule_exceptions', 'roomId', T.nullableInt(), ' (scope per aula)'),

  // F2 — Ricorrenze MRBS-style: FK Booking.recurrenceId → booking_recurrences.id.
  // Senza questa pre-migration sync({safe}) fallisce su CREATE INDEX
  // bookings_recurrence: la colonna non viene aggiunta a tabelle esistenti.
  column('bookings', 'recurrenceId', T.nullableInt(), ' (F2 ricorrenze)'),

  // SSO — Whitelist domini email autorizzati al login OAuth (Google/Microsoft).
  column('oauth_settings', 'allowedEmailDomains', T.nullableString(1000), ' (SSO whitelist)'),

  // SSO — Gate per gruppi di sicurezza Microsoft 365. Additivo al gate dominio.
  // Default disattivo + nomi gruppo standard → comportamento invariato finché
  // l'admin non abilita. La tabella group_role_maps (mapping fine) la crea sync().
  column('oauth_settings', 'groupGateEnabled', T.boolean(false), ' (default false)'),
  ...[
    ['groupStudenti', 'Studenti'],
    ['groupDocenti', 'Docenti'],
    ['groupAmministrazione', 'Amministrazione'],
    ['groupDirezione', 'Direzione'],
  ].map(([col, def]) =>
    column('oauth_settings', col, T.nullableString(200), ` (default "${def}" dal model)`),
  ),

  // SSO — snapshot gruppi M365 per utente (vista allineamento). JSON array default [].
  column('users', 'm365Groups', T.jsonArray(), ' (snapshot gruppi M365)'),

  // Magic-link primo accesso (import Isidata / bulk admin).
  // - password_reset_tokens.purpose: distingue 'reset' (TTL 1h) da
  //   'initial_setup' (TTL configurabile, default 14gg). Backfill: tutti i
  //   token esistenti sono reset (default storico).
  // - institutes.initialSetupLinkTtlDays: durata in giorni del token
  //   di setup, configurabile da admin in Server Settings.
  column('password_reset_tokens', 'purpose', T.nullableString(20), ' (default reset)', {
    backfill: () =>
      sequelize.query(`UPDATE password_reset_tokens SET purpose = 'reset' WHERE purpose IS NULL`),
  }),
  column('institutes', 'initialSetupLinkTtlDays', T.int(14), ' (default 14gg)'),

  // Audit log hash-chain (integrità): rowHash + prevHash. Le righe pre-esistenti
  // restano NULL (vengono classificate come "legacy" dalla verifica di integrità).
  // Senza queste colonne ogni AuditLog.findAll() esplode con
  // "column 'rowHash' does not exist" — colpisce ad es. l'export GDPR
  // dal profilo utente che legge la propria audit trail.
  column('audit_log', 'rowHash', T.nullableString(64), ' (hash-chain integrità)'),
  column('audit_log', 'prevHash', T.nullableString(64), ' (hash-chain integrità)'),

  // Monte Ore — vincoli giornalieri configurabili (Z2/Z3 Regolamento Art. 2).
  // NULL = vincolo disabilitato, comportamento legacy. Senza queste colonne,
  // GET/PUT su /api/admin/monte-ore/settings esplodono coi DB pre-v1.14.
  column('monte_ore_settings', 'maxHoursPerDay', T.nullableFloat()),
  column('monte_ore_settings', 'dailyBreakAfterHours', T.nullableFloat()),
  column('monte_ore_settings', 'dailyBreakMinutes', T.nullableInt()),

  // ConcertInfo — campi aggiuntivi per il rendering arricchito sul kiosk
  // (v1.15.0). Tutti nullable: i concerti esistenti renderizzano come prima.
  column('concert_info', 'eventType', T.nullableString(40), ' (kiosk slide)'),
  column('concert_info', 'description', T.nullableString(500), ' (sub-headline)'),
  column('concert_info', 'language', T.nullableString(2), ' (ISO 639-1)'),

  // Indici compositi additivi su tabelle ad alta lettura (Postgres).
  step('compositeIndexes', ensureCompositeIndexes),
];

/**
 * Esecutore unico: esegue i passi nell'ordine dichiarato. Se `run` restituisce
 * true emette il log di successo (info) e poi l'eventuale `after`. Gli errori
 * non gestiti dal passo si propagano, come prima.
 */
async function runPreSyncMigrations() {
  for (const s of PRE_SYNC_STEPS) {
    const changed = await s.run();
    if (changed === true) {
      if (s.log) logger.info(s.log);
      if (s.after) await s.after();
    }
  }
}

/**
 * Esegue UN passo di PRE_SYNC_STEPS per nome (stessa definizione usata al boot).
 * Usato dalle migrazioni sequelize-cli che duplicavano una colonna già gestita
 * qui: così `db:cli:migrate` e boot non possono divergere.
 *
 * @returns {Promise<boolean>} true se il passo ha modificato lo schema.
 */
async function runPreSyncStep(name) {
  const s = PRE_SYNC_STEPS.find((x) => x.name === name);
  if (!s) throw new Error(`Passo pre-sync sconosciuto: ${name}`);
  return (await s.run()) === true;
}

module.exports = {
  runPreSyncMigrations,
  runPreSyncStep,
  addColumnIfMissing,
  columnTypes,
  PRE_SYNC_STEPS,
  ensureUserStatusColumn,
  ensureUserBooleanColumn,
  ensureNullableStringColumn,
  ensureBookingsNoOverlapConstraint,
  ensureMonteOreSlotsCascadeFk,
};
