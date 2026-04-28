'use strict';

/**
 * Adeguamenti di schema "manuali" da eseguire PRIMA di sequelize.sync().
 * Servono quando si aggiunge una colonna a un model: in modalità sync({safe})
 * Sequelize non altera tabelle esistenti, e se sulla nuova colonna è definito
 * un indice, sync() prova a crearlo e fallisce con "no such column".
 *
 * Le procedure qui dentro devono essere idempotenti.
 */

const { sequelize } = require('../models');

async function ensureUserStatusColumn() {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable('users');
  } catch {
    // Tabella ancora inesistente (primo avvio): sync() la creerà con il campo.
    return false;
  }
  if (desc.status) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    // SQLite non supporta ENUM: usiamo TEXT con default.
    await sequelize.query("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
  } else {
    await qi.addColumn('users', 'status', {
      type: sequelize.Sequelize.DataTypes.ENUM('pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'approved',
    });
  }
  return true;
}

/**
 * Aggiunge una colonna booleana a users con default true se mancante.
 * Idempotente. Compatibile SQLite (TEXT non serve, BOOLEAN→INTEGER 0/1).
 */
async function ensureUserBooleanColumn(name) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable('users');
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(`ALTER TABLE users ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 1`);
  } else {
    await qi.addColumn('users', name, {
      type: sequelize.Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  }
  return true;
}

/**
 * Aggiunge una colonna intera NOT NULL con default a una tabella se mancante.
 * Idempotente.
 */
async function ensureNotNullIntColumn(table, name, defaultValue) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT ${defaultValue}`,
    );
  } else {
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.INTEGER,
      allowNull: false,
      defaultValue,
    });
  }
  return true;
}

/**
 * Aggiunge una colonna boolean NOT NULL con default a una tabella generica.
 * Specializzazione di ensureUserBooleanColumn per altre tabelle.
 */
async function ensureBooleanColumn(table, name, defaultValue = true) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    const def = defaultValue ? 1 : 0;
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT ${def}`,
    );
  } else {
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue,
    });
  }
  return true;
}

/**
 * Aggiunge una colonna DATETIME nullable a una tabella se mancante.
 * Idempotente.
 */
async function ensureNullableDateColumn(table, name) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} DATETIME`);
  } else {
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.DATE,
      allowNull: true,
    });
  }
  return true;
}

/**
 * Aggiunge una colonna JSON NOT NULL con default '[]' (array vuoto) se mancante.
 * Su SQLite la colonna diventa TEXT (Sequelize JSON serializza/deserializza);
 * su Postgres/MySQL usa il tipo nativo JSON. Idempotente.
 */
async function ensureJsonArrayColumn(table, name) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT NOT NULL DEFAULT '[]'`);
  } else if (dialect === 'postgres') {
    await sequelize.query(
      `ALTER TABLE "${table}" ADD COLUMN "${name}" JSON NOT NULL DEFAULT '[]'::json`,
    );
  } else {
    // MySQL/MariaDB: JSON con DEFAULT richiede sintassi specifica
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN ${name} JSON NOT NULL DEFAULT (JSON_ARRAY())`,
    );
  }
  return true;
}

/**
 * Aggiunge una colonna JSON NULLABLE a una tabella se mancante.
 * Su SQLite la colonna diventa TEXT (Sequelize JSON serializza/deserializza);
 * su Postgres/MySQL usa il tipo nativo JSON. Idempotente.
 */
async function ensureNullableJsonColumn(table, name) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
  } else if (dialect === 'postgres') {
    await sequelize.query(`ALTER TABLE "${table}" ADD COLUMN "${name}" JSON`);
  } else {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} JSON`);
  }
  return true;
}

/**
 * Aggiunge una colonna stringa nullable a una tabella se mancante.
 * Idempotente — funziona uniformemente su SQLite/MySQL/Postgres.
 */
async function ensureNullableStringColumn(table, name, length = 500) {
  const qi = sequelize.getQueryInterface();
  let desc;
  try {
    desc = await qi.describeTable(table);
  } catch {
    return false;
  }
  if (desc[name]) return false;

  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
  } else {
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.STRING(length),
      allowNull: true,
    });
  }
  return true;
}

/**
 * Su Postgres aggiunge un valore al tipo ENUM se non già presente. Idempotente.
 * Su SQLite l'ENUM è solo un CHECK constraint; Sequelize lo gestisce a sync,
 * quindi non serve azione esplicita.
 */
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

async function runPreSyncMigrations() {
  const added = await ensureUserStatusColumn();
  if (added) {
    console.log("  ✓ Colonna users.status aggiunta (utenti esistenti = 'approved')");
  }

  // Preferenze email granulari (Conferma / Promemoria / Cancellazione)
  for (const col of ['notifyOnConfirmation', 'notifyOnReminder', 'notifyOnCancellation']) {
    if (await ensureUserBooleanColumn(col)) {
      console.log(`  ✓ Colonna users.${col} aggiunta (default = true)`);
    }
  }

  // Versionamento dei JWT validi (per logout/cambio password effettivo).
  if (await ensureNotNullIntColumn('users', 'tokenVersion', 0)) {
    console.log('  ✓ Colonna users.tokenVersion aggiunta (default = 0)');
  }

  // 2FA via codice email — opt-in. Sempre disabilitato di default per
  // utenti esistenti. La colonna `twoFaSecretEncrypted` resta per backward
  // compat con DB già migrati alla precedente versione TOTP (non più usata).
  if (await ensureBooleanColumn('users', 'twoFaEnabled', false)) {
    console.log('  ✓ Colonna users.twoFaEnabled aggiunta (default = false)');
  }
  if (await ensureNullableStringColumn('users', 'twoFaSecretEncrypted', 500)) {
    console.log('  ✓ Colonna users.twoFaSecretEncrypted aggiunta (deprecated)');
  }
  if (await ensureNullableJsonColumn('users', 'twoFaChallenge')) {
    console.log('  ✓ Colonna users.twoFaChallenge aggiunta (sfida email in corso)');
  }
  if (await ensureNullableJsonColumn('users', 'twoFaRecoveryCodes')) {
    console.log('  ✓ Colonna users.twoFaRecoveryCodes aggiunta');
  }
  if (await ensureNullableDateColumn('users', 'twoFaActivatedAt')) {
    console.log('  ✓ Colonna users.twoFaActivatedAt aggiunta');
  }

  // Bot messaging — challenge OTP per binding canale↔utente.
  if (await ensureNullableJsonColumn('users', 'botBindingChallenge')) {
    console.log('  ✓ Colonna users.botBindingChallenge aggiunta (binding bot)');
  }

  // Foto aula
  if (await ensureNullableStringColumn('rooms', 'photoUrl', 500)) {
    console.log('  ✓ Colonna rooms.photoUrl aggiunta');
  }

  // Configurazione kiosk /display per edificio (rotazione)
  if (await ensureBooleanColumn('buildings', 'displayEnabled', true)) {
    console.log('  ✓ Colonna buildings.displayEnabled aggiunta (default = true)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayIntervalSec', 30)) {
    console.log('  ✓ Colonna buildings.displayIntervalSec aggiunta (default = 30)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayConcertsDays', 30)) {
    console.log('  ✓ Colonna buildings.displayConcertsDays aggiunta (default = 30)');
  }
  if (await ensureBooleanColumn('buildings', 'displayConcertsEnabled', true)) {
    console.log('  ✓ Colonna buildings.displayConcertsEnabled aggiunta (default = true)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayConcertsCount', 0)) {
    console.log('  ✓ Colonna buildings.displayConcertsCount aggiunta (default = 0)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayConcertsIntervalSec', 15)) {
    console.log('  ✓ Colonna buildings.displayConcertsIntervalSec aggiunta (default = 15)');
  }
  // Workflow approvazione su prenotazioni high-impact (sale concerti, ecc).
  if (await ensureBooleanColumn('rooms', 'requiresApproval', false)) {
    console.log('  ✓ Colonna rooms.requiresApproval aggiunta (default = false)');
  }
  if (await ensurePostgresEnumValue('enum_bookings_status', 'pending_approval')) {
    console.log("  ✓ ENUM bookings.status esteso con 'pending_approval'");
  }

  if (await ensureBooleanColumn('buildings', 'displayBookingsEnabled', true)) {
    console.log('  ✓ Colonna buildings.displayBookingsEnabled aggiunta (default = true)');
  }
  if (await ensureBooleanColumn('buildings', 'displayAnnouncementsEnabled', true)) {
    console.log('  ✓ Colonna buildings.displayAnnouncementsEnabled aggiunta (default = true)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayAnnouncementsCount', 5)) {
    console.log('  ✓ Colonna buildings.displayAnnouncementsCount aggiunta (default = 5)');
  }
  if (await ensureNotNullIntColumn('buildings', 'displayAnnouncementsIntervalSec', 12)) {
    console.log('  ✓ Colonna buildings.displayAnnouncementsIntervalSec aggiunta (default = 12)');
  }
  if (await ensureBooleanColumn('buildings', 'displayAnnouncementsPinnedOnly', false)) {
    console.log('  ✓ Colonna buildings.displayAnnouncementsPinnedOnly aggiunta (default = false)');
  }

  // Sistema check-in / anti ghost-booking
  if (await ensureNullableStringColumn('bookings', 'checkInToken', 64)) {
    console.log('  ✓ Colonna bookings.checkInToken aggiunta');
    // Backfill token per le prenotazioni esistenti (solo quelle senza)
    const crypto = require('crypto');
    const { Booking } = require('../models');
    const rows = await Booking.findAll({ where: { checkInToken: null }, attributes: ['id'] });
    for (const row of rows) {
      await Booking.update(
        { checkInToken: crypto.randomBytes(24).toString('hex') },
        { where: { id: row.id } },
      );
    }
    if (rows.length)
      console.log(`  ✓ Backfill checkInToken per ${rows.length} prenotazioni esistenti`);
  }
  if (await ensureNullableDateColumn('bookings', 'checkedInAt')) {
    console.log('  ✓ Colonna bookings.checkedInAt aggiunta');
  }
  if (await ensureNullableDateColumn('bookings', 'autoCancelledAt')) {
    console.log('  ✓ Colonna bookings.autoCancelledAt aggiunta');
  }

  // Toggle check-in QR per aula
  if (await ensureBooleanColumn('rooms', 'requireCheckIn', true)) {
    console.log('  ✓ Colonna rooms.requireCheckIn aggiunta (default = true)');
  }

  // QR-code token per aula. Generato lazy al primo download/regenerate via
  // route /api/structure/rooms/:id/qr/* — non popolato qui per evitare
  // overhead in startup.
  if (await ensureNullableStringColumn('rooms', 'qrToken', 64)) {
    console.log('  ✓ Colonna rooms.qrToken aggiunta');
    // Indice UNIQUE WHERE qrToken IS NOT NULL — Postgres supporta partial unique;
    // SQLite (test) non lo richiede perché test seed non popola il campo.
    if (sequelize.getDialect() === 'postgres') {
      try {
        await sequelize.query(
          'CREATE UNIQUE INDEX IF NOT EXISTS rooms_qr_token_unique ON rooms ("qrToken") WHERE "qrToken" IS NOT NULL',
        );
      } catch (err) {
        console.warn(`  ⚠ Indice rooms_qr_token_unique non creato: ${err.message}`);
      }
    }
  }

  // Per-instrument course allowlist (sostituisce InstrumentLoanRule per-famiglia).
  // Migration da legacy: se la tabella instrument_loan_rules esiste e ha
  // dati, propaghiamo allowedCourseIds dalla famiglia ai singoli strumenti
  // appartenenti a quella famiglia. Idempotente: non sovrascrive valori
  // già impostati direttamente sullo strumento.
  if (await ensureJsonArrayColumn('instruments', 'allowedCourseIds')) {
    console.log('  ✓ Colonna instruments.allowedCourseIds aggiunta (default [])');
    try {
      const { Instrument, InstrumentLoanRule } = require('../models');
      const legacyRules = await InstrumentLoanRule.findAll().catch(() => []);
      let migrated = 0;
      for (const rule of legacyRules) {
        const ids = Array.isArray(rule.allowedCourseIds) ? rule.allowedCourseIds : [];
        if (ids.length === 0) continue;
        const [count] = await Instrument.update(
          { allowedCourseIds: ids },
          { where: { family: rule.family } },
        );
        migrated += count;
      }
      if (migrated > 0) {
        console.log(`  ✓ Migrate regole prestito legacy → ${migrated} strumenti aggiornati`);
      }
    } catch (err) {
      // Non blocca lo startup: la migration legacy è best-effort.
      console.warn(`  ⚠ Migrazione regole prestito legacy fallita: ${err.message}`);
    }
  }

  // Campi anagrafici/legali su Institute (Privacy Policy, Termini, GDPR).
  // Tutti nullable: gli istituti esistenti restano validi; l'admin li compila
  // dalla pagina di gestione.
  for (const col of [
    'legalName',
    'vatNumber',
    'fiscalCode',
    'pecEmail',
    'contactEmail',
    'dpoName',
    'dpoEmail',
    'jurisdictionCity',
  ]) {
    if (await ensureNullableStringColumn('institutes', col, 255)) {
      console.log(`  ✓ Colonna institutes.${col} aggiunta`);
    }
  }
  if (await ensureNullableJsonColumn('institutes', 'subProcessors')) {
    console.log('  ✓ Colonna institutes.subProcessors aggiunta');
  }

  // Sicurezza check-in: toggle e CIDR allowlist della rete d'istituto.
  // Aggiunti come default false / [] su istituti esistenti — comportamento
  // invariato finché l'admin non li abilita esplicitamente da
  // /admin/server-settings tab "QR Code".
  if (await ensureBooleanColumn('institutes', 'checkInRequireInstituteNetwork', false)) {
    console.log('  ✓ Colonna institutes.checkInRequireInstituteNetwork aggiunta');
  }
  if (await ensureNullableJsonColumn('institutes', 'instituteNetworkCidrs')) {
    console.log('  ✓ Colonna institutes.instituteNetworkCidrs aggiunta');
  }

  // Soft delete (paranoid): deletedAt nullable sulle tabelle core.
  // Sequelize aggiunge la colonna automaticamente alle tabelle nuove via sync()
  // ma su quelle preesistenti dobbiamo aggiungerla qui.
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
  for (const table of PARANOID_TABLES) {
    if (await ensureNullableDateColumn(table, 'deletedAt')) {
      console.log(`  ✓ Colonna ${table}.deletedAt aggiunta (soft delete)`);
    }
  }

  // Estensioni granulari BookingQuota (step 3 della roadmap quote).
  // Tutti i nuovi campi sono opzionali con default → backward compatible.
  if (await ensureNotNullIntColumn('booking_quotas', 'maxHoursPerMonth', 0)) {
    console.log('  ✓ Colonna booking_quotas.maxHoursPerMonth aggiunta (default 0)');
  }
  if (await ensureNotNullIntColumn('booking_quotas', 'maxBookings', 0)) {
    console.log('  ✓ Colonna booking_quotas.maxBookings aggiunta (default 0)');
  }
  if (await ensureJsonArrayColumn('booking_quotas', 'daysOfWeek')) {
    console.log('  ✓ Colonna booking_quotas.daysOfWeek aggiunta (default [])');
  }
  if (await ensureNullableStringColumn('booking_quotas', 'timeFrom', 5)) {
    console.log('  ✓ Colonna booking_quotas.timeFrom aggiunta');
  }
  if (await ensureNullableStringColumn('booking_quotas', 'timeTo', 5)) {
    console.log('  ✓ Colonna booking_quotas.timeTo aggiunta');
  }

  // Step 4: scope ampliati per BookingQuota.scopeKind (Postgres only).
  // SQLite non enforce ENUM (i valori passano comunque). Su Postgres serve
  // ALTER TYPE per aggiungere i nuovi valori.
  if (sequelize.getDialect() === 'postgres') {
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
      console.warn(`  ⚠ ALTER TYPE scopeKind: ${err.message}`);
    }
  }

  // Rete di sicurezza DB-level: due booking confermate sulla stessa room
  // non possono mai sovrapporsi nel tempo, anche se il validator applicativo
  // (services/bookingValidator.js) avesse un bug. EXCLUDE GiST + tsrange.
  // Solo Postgres: SQLite/MySQL non supportano EXCLUDE constraint.
  await ensureBookingsNoOverlapConstraint();

  // Integrazioni esterne: campi su users + tabelle integration_*.
  // Le tabelle nuove vengono create da sequelize.sync() al primo avvio;
  // qui ci occupiamo SOLO delle nuove colonne su `users` (tabella già
  // esistente sui DB pre-feature).
  if (await ensureNullableStringColumn('users', 'externalSource', 32)) {
    console.log('  ✓ Colonna users.externalSource aggiunta (integrazioni)');
  }
  if (await ensureNullableStringColumn('users', 'externalId', 64)) {
    console.log('  ✓ Colonna users.externalId aggiunta (integrazioni)');
  }
  if (await ensureNullableStringColumn('users', 'externalStatusNote', 1024)) {
    console.log('  ✓ Colonna users.externalStatusNote aggiunta (integrazioni)');
  }
  if (await ensureNullableDateColumn('users', 'lastExternalSyncAt')) {
    console.log('  ✓ Colonna users.lastExternalSyncAt aggiunta (integrazioni)');
  }

  // Monte Ore — nuove colonne su monte_ore_proposals (pattern + soglia + amendment).
  // Le tabelle settings/suspensions/slots/amendments sono nuove e create da sync().
  await ensureNullableIntColumn('monte_ore_proposals', 'workingDaysCount');
  await ensureNullableFloatColumn('monte_ore_proposals', 'minRequiredHoursSnapshot');
  if (await ensureNotNullIntColumn('monte_ore_proposals', 'amendmentCount', 0)) {
    console.log('  ✓ Colonna monte_ore_proposals.amendmentCount aggiunta');
  }
  // totalHoursPlanned è float; se non c'è già lo aggiungiamo come nullable
  // (il default verrà settato dall'app a 0 in fase di create/update).
  await ensureNullableFloatColumn('monte_ore_proposals', 'totalHoursPlanned');

  // Monte Ore — link opzionale tra sospensione e BookingRuleException
  // (per applicare il blocco anche alle prenotazioni regolari).
  await ensureNullableIntColumn('monte_ore_suspensions', 'bookingRuleExceptionId');
}

// Helpers locali per Monte Ore (no-op se le tabelle non esistono ancora).
async function ensureNullableIntColumn(table, name) {
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable(table);
    if (desc[name]) return false;
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.INTEGER,
      allowNull: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureNullableFloatColumn(table, name) {
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable(table);
    if (desc[name]) return false;
    await qi.addColumn(table, name, {
      type: sequelize.Sequelize.DataTypes.FLOAT,
      allowNull: true,
    });
    return true;
  } catch {
    return false;
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
 *     potrà ripulire i duplicati a mano (vedi docs/db-constraints.md).
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
    console.warn(`  ⚠ btree_gist non installabile (${err.message}); provo comunque...`);
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
    console.log(`  ✓ Constraint ${CONSTRAINT_NAME} aggiunta su bookings (rete sicurezza DB-level)`);
  } catch (err) {
    // Possibili cause:
    //  - dati esistenti che si sovrappongono → ERRCODE 23P01 / 23505
    //  - btree_gist non installato e non installabile
    //  - permessi insufficienti
    // Non bloccante: il validator applicativo resta la prima linea.
    console.warn(`  ⚠ Impossibile aggiungere ${CONSTRAINT_NAME}: ${err.message}`);
    console.warn(
      '  ⚠ Lo startup prosegue. La validazione overlap resta gestita solo dal validator applicativo.',
    );
    console.warn(
      '  ⚠ Per riprovare in seguito: ripulisci i duplicati overlapping e rilancia lo startup.',
    );
  }
}

module.exports = {
  runPreSyncMigrations,
  ensureUserStatusColumn,
  ensureUserBooleanColumn,
  ensureNullableStringColumn,
  ensureBookingsNoOverlapConstraint,
};
