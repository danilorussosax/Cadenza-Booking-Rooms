'use strict';

/**
 * Snapshot CONGELATO di uno schema "vecchio" (SQLite) per testare
 * l'aggiornamento al boot: runPreSyncMigrations + sync({safe}).
 *
 * Contiene le tabelle toccate dalle pre-sync migrations, SENZA le colonne
 * che quelle migrazioni aggiungono (stato di un DB creato prima di
 * status/2FA/kiosk/soft-delete/check-in/monte ore/SSO/audit hash-chain ...).
 * Le altre tabelle non sono presenti: le crea sync().
 * NON rigenerare dai model: serve proprio a fotografare il passato.
 */

const LEGACY_TABLES = [
  [
    'monte_ore_settings',
    `CREATE TABLE monte_ore_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instituteId INTEGER NOT NULL,
    academicYear VARCHAR(16) NOT NULL,
    academicYearStart DATE NOT NULL,
    academicYearEnd DATE NOT NULL,
    lessonsStartDate DATE NOT NULL,
    lessonsEndDate DATE NOT NULL,
    submissionWindowStart DATE NOT NULL,
    submissionWindowEnd DATE NOT NULL,
    minRequiredHours FLOAT NOT NULL DEFAULT '324',
    maxAmendmentsPerYear INTEGER NOT NULL DEFAULT 3,
    isActiveForTeachers TINYINT(1) NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'contract_types',
    `CREATE TABLE contract_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instituteId INTEGER NOT NULL,
    code VARCHAR(40) NOT NULL,
    label VARCHAR(80) NOT NULL,
    defaultHours FLOAT,
    bypassDayConstraintDefault TINYINT(1) NOT NULL DEFAULT 0,
    isSystem TINYINT(1) NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    notes VARCHAR(500),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    deletedAt DATETIME
  )`,
  ],
  [
    'monte_ore_proposals',
    `CREATE TABLE monte_ore_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    academicYear VARCHAR(16) NOT NULL,
    validFrom DATE NOT NULL,
    validTo DATE NOT NULL,
    totalHoursRequested FLOAT NOT NULL DEFAULT '0',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    submittedAt DATETIME,
    approvedAt DATETIME,
    rejectedAt DATETIME,
    generatedAt DATETIME,
    approverId INTEGER,
    rejectionReason TEXT,
    coordinatorNotes TEXT,
    generationSummary JSON,
    source TEXT NOT NULL DEFAULT 'user',
    importedAt DATETIME,
    importedById INTEGER,
    importSourceRef VARCHAR(255),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'monte_ore_amendments',
    `CREATE TABLE monte_ore_amendments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposalId INTEGER NOT NULL,
    requesterId INTEGER NOT NULL,
    slotId INTEGER,
    kind TEXT NOT NULL,
    payload JSON NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    requestNotes TEXT,
    rejectionReason TEXT,
    decidedAt DATETIME,
    decidedBy INTEGER,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'bookings',
    `CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    roomId INTEGER NOT NULL,
    startTime DATETIME NOT NULL,
    endTime DATETIME NOT NULL,
    purpose VARCHAR(255),
    type TEXT DEFAULT 'studio_individuale',
    status TEXT DEFAULT 'confirmed',
    notes TEXT,
    cancelledAt DATETIME,
    cancelReason VARCHAR(255),
    reminderSentAt DATETIME,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'users',
    `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email VARCHAR(190) NOT NULL,
    passwordHash VARCHAR(255),
    firstName VARCHAR(100) NOT NULL,
    lastName VARCHAR(100) NOT NULL,
    role TEXT NOT NULL DEFAULT 'studente',
    matricola VARCHAR(50),
    courseId INTEGER,
    googleId VARCHAR(255),
    microsoftId VARCHAR(255),
    isActive TINYINT(1) DEFAULT 1,
    emailNotifications TINYINT(1) DEFAULT 1,
    notifyOnAnnouncements TINYINT(1) DEFAULT 1,
    profilePhotoUrl VARCHAR(255),
    lastLogin DATETIME,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    icalToken VARCHAR(64)
  )`,
  ],
  [
    'rooms',
    `CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buildingId INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    floor VARCHAR(100) NOT NULL,
    capacity INTEGER DEFAULT 1,
    type TEXT DEFAULT 'studio',
    allowedRoles JSON DEFAULT '["admin","docente","studente"]',
    allowedCourseIds JSON DEFAULT '[]',
    isBookable TINYINT(1) DEFAULT 1,
    notes TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'buildings',
    `CREATE TABLE buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instituteId INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    address VARCHAR(300),
    floors JSON NOT NULL DEFAULT '["Piano Terra"]',
    description TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'instruments',
    `CREATE TABLE instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50),
    name VARCHAR(200) NOT NULL,
    family TEXT NOT NULL DEFAULT 'altro',
    brand VARCHAR(120),
    model VARCHAR(120),
    serialNumber VARCHAR(120),
    condition TEXT NOT NULL DEFAULT 'buono',
    isLoanable TINYINT(1) NOT NULL DEFAULT 1,
    notes TEXT,
    photoUrl VARCHAR(500),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'institutes',
    `CREATE TABLE institutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    address VARCHAR(300),
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Italia',
    timezone VARCHAR(60) DEFAULT 'Europe/Rome',
    description TEXT,
    logoUrl TEXT,
    copyright VARCHAR(255),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'courses',
    `CREATE TABLE courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(250) NOT NULL,
    department VARCHAR(150),
    levels TEXT DEFAULT '["triennio","biennio"]',
    description TEXT,
    isActive TINYINT(1) DEFAULT 1,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'equipment',
    `CREATE TABLE equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    type TEXT DEFAULT 'altro',
    brand VARCHAR(100),
    model VARCHAR(100),
    quantity INTEGER DEFAULT 1,
    serialNumber VARCHAR(100),
    notes TEXT,
    isWorking TINYINT(1) DEFAULT 1,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'concert_info',
    `CREATE TABLE concert_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bookingId INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    performers TEXT,
    program TEXT,
    posterUrl VARCHAR(500),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'instrument_loans',
    `CREATE TABLE instrument_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instrumentId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    fromDate DATE NOT NULL,
    toDate DATE NOT NULL,
    returnedAt DATETIME,
    status TEXT NOT NULL DEFAULT 'requested',
    notes TEXT,
    approvedBy INTEGER,
    approvedAt DATETIME,
    reminderSentAt DATETIME,
    overdueNotifiedAt DATETIME,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'booking_rules',
    `CREATE TABLE booking_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    maxActiveBookings INTEGER DEFAULT 5,
    maxHoursPerWeek INTEGER DEFAULT 10,
    maxHoursPerDay INTEGER DEFAULT 4,
    maxBookingDurationMinutes INTEGER DEFAULT 120,
    minBookingDurationMinutes INTEGER DEFAULT 30,
    maxAdvanceDays INTEGER DEFAULT 14,
    minAdvanceHours INTEGER DEFAULT 0,
    cancellationDeadlineHours INTEGER DEFAULT 2,
    allowRecurring TINYINT(1) DEFAULT 0,
    allowNightHours TINYINT(1) DEFAULT 0,
    allowedStartTime VARCHAR(5) DEFAULT '08:00',
    allowedEndTime VARCHAR(5) DEFAULT '22:00',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'booking_quotas',
    `CREATE TABLE booking_quotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    scopeKind TEXT NOT NULL,
    scopeValue VARCHAR(80) NOT NULL DEFAULT '*',
    maxHoursPerWeek INTEGER NOT NULL DEFAULT 0,
    maxHoursPerDay INTEGER NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL,
    deletedAt DATETIME
  )`,
  ],
  [
    'monte_ore_suspensions',
    `CREATE TABLE monte_ore_suspensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instituteId INTEGER NOT NULL,
    academicYear VARCHAR(16) NOT NULL,
    name VARCHAR(120) NOT NULL,
    dateFrom DATE NOT NULL,
    dateTo DATE NOT NULL,
    kind TEXT NOT NULL DEFAULT 'partial',
    category TEXT NOT NULL DEFAULT 'custom',
    notes TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'monte_ore_slots',
    `CREATE TABLE monte_ore_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposalId INTEGER NOT NULL,
    scheduleId INTEGER,
    date DATE NOT NULL,
    dayOfWeek INTEGER NOT NULL,
    startTime VARCHAR(5) NOT NULL,
    endTime VARCHAR(5) NOT NULL,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    isLocked TINYINT(1) NOT NULL DEFAULT 0,
    lockReason VARCHAR(120),
    originalActive TINYINT(1) NOT NULL DEFAULT 1,
    bookingId INTEGER,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'mail_settings',
    `CREATE TABLE mail_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    isEnabled TINYINT(1) DEFAULT 0,
    host VARCHAR(200),
    port INTEGER DEFAULT 587,
    secure TINYINT(1) DEFAULT 0,
    username VARCHAR(200),
    passwordEncrypted TEXT,
    fromAddress VARCHAR(200),
    fromName VARCHAR(200),
    replyTo VARCHAR(200),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'booking_rule_exceptions',
    `CREATE TABLE booking_rule_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL DEFAULT 'all',
    name VARCHAR(150) NOT NULL,
    kind TEXT NOT NULL,
    daysOfWeek JSON,
    dateFrom DATE,
    dateTo DATE,
    startTime VARCHAR(5),
    endTime VARCHAR(5),
    maxHoursInWindow FLOAT,
    isActive TINYINT(1) DEFAULT 1,
    notes TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'oauth_settings',
    `CREATE TABLE oauth_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    googleEnabled TINYINT(1) DEFAULT 0,
    googleClientId VARCHAR(500),
    googleClientSecretEncrypted TEXT,
    googleCallbackUrl VARCHAR(500),
    microsoftEnabled TINYINT(1) DEFAULT 0,
    microsoftClientId VARCHAR(500),
    microsoftClientSecretEncrypted TEXT,
    microsoftCallbackUrl VARCHAR(500),
    microsoftTenant VARCHAR(200) DEFAULT 'common',
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
  [
    'password_reset_tokens',
    `CREATE TABLE password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    tokenHash VARCHAR(64) NOT NULL,
    expiresAt DATETIME NOT NULL,
    usedAt DATETIME,
    requestIp VARCHAR(64),
    requestUserAgent VARCHAR(512),
    createdAt DATETIME NOT NULL
  )`,
  ],
  [
    'audit_log',
    `CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actorId INTEGER,
    action VARCHAR(16) NOT NULL,
    targetType VARCHAR(48) NOT NULL,
    targetId INTEGER,
    path VARCHAR(255) NOT NULL,
    statusCode INTEGER NOT NULL,
    payload JSON,
    response JSON,
    ip VARCHAR(64),
    userAgent VARCHAR(255),
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NOT NULL
  )`,
  ],
];

/**
 * Crea le tabelle legacy e inserisce una riga per tabella (valori
 * segnaposto per le colonne NOT NULL senza default), più un iCal token in
 * chiaro e un reset-token da backfillare.
 */
async function createLegacySchema(sequelize) {
  for (const [, ddl] of LEGACY_TABLES) await sequelize.query(ddl);
  for (const [table] of LEGACY_TABLES) {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table})`);
    const names = [];
    const values = [];
    for (const c of cols) {
      if (c.pk || !c.notnull || c.dflt_value !== null) continue;
      names.push(c.name);
      if (/INT|FLOAT|TINYINT/i.test(c.type)) values.push(1);
      else if (/DATE/i.test(c.type)) values.push('2024-01-01 00:00:00');
      else values.push(`${table}_${c.name}`);
    }
    const sql = names.length
      ? `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`
      : `INSERT INTO ${table} DEFAULT VALUES`;
    await sequelize.query(sql, { replacements: values });
  }
  await sequelize.query("UPDATE users SET icalToken = 'plain-ical-token'");
}

module.exports = { LEGACY_TABLES, createLegacySchema };
