'use strict';

/**
 * Backup roundtrip test — verifica che il file di backup contenga davvero
 * uno snapshot del DB con i dati live.
 *
 * Garanzia che dà: se la prod muore, il backup è ricostruibile e non un
 * file inerte. Coperto: `performBackup` (scripts/backup.js) +
 * estrazione + apertura SQLite snapshot.
 *
 * NB: il "vero" restore round-trip che droppa e ricarica il DB attivo
 * dei test è coperto in modo limitato dall'altro file `backups.test.js`
 * (l'in-memory di vitest non ha file da sostituire). Qui ci concentriamo
 * sull'integrità del DUMP: il backup deve contenere tutto ciò che il
 * DB live ha al momento dello snapshot.
 *
 * Skippa se: dialect != sqlite (es. CI postgres-only) o tar non disponibile.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { sequelize } = require('../../models');
const {
  createInstitute,
  createBuilding,
  createRoom,
  createUser,
  createBooking,
} = require('../factories');

function hasTar() {
  try {
    execSync('tar --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const DIALECT = sequelize.getDialect();
const TAR_AVAILABLE = hasTar();
const skip = DIALECT !== 'sqlite' || !TAR_AVAILABLE;

describe.skipIf(skip)('Backup roundtrip — snapshot integrity', () => {
  let tmpRoot;
  let backupDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-backup-roundtrip-'));
    backupDir = path.join(tmpRoot, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    // performBackup legge BACKUP_DIR da env al caricamento del modulo.
    // Sostituiamo il path per isolare il file generato in tmp.
    process.env.BACKUP_DIR = backupDir;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('il backup contiene uno snapshot con i record presenti al momento del dump', async () => {
    // 1) Fixture: institute → building → room → user → booking
    await globalThis.resetDatabase();
    const inst = await createInstitute({ name: 'Conservatorio Roundtrip' });
    const building = await createBuilding({ instituteId: inst.id, name: 'Sede A' });
    const room = await createRoom({ building, name: 'Aula 101' });
    const user = await createUser({ firstName: 'Mario', lastName: 'Rossi' });
    await createBooking({
      user,
      room,
      startTime: new Date('2026-06-01T10:00:00'),
      endTime: new Date('2026-06-01T11:00:00'),
    });

    // Sanity check sul DB live
    const [liveRoomCount] = await sequelize.query('SELECT COUNT(*) as c FROM rooms');
    const [liveBookingCount] = await sequelize.query('SELECT COUNT(*) as c FROM bookings');
    expect(Number(liveRoomCount[0].c)).toBeGreaterThanOrEqual(1);
    expect(Number(liveBookingCount[0].c)).toBeGreaterThanOrEqual(1);

    // 2) Esegui backup
    // performBackup è importato lazy (legge BACKUP_DIR al require-time).
    // Forziamo un re-require ridichiarando le costanti via env.
    delete require.cache[require.resolve('../../scripts/backup')];
    const { performBackup } = require('../../scripts/backup');
    const result = await performBackup();
    expect(result).toBeTruthy();
    expect(result.file).toMatch(/^backup-.+\.tar\.gz$/);
    expect(fs.existsSync(result.path)).toBe(true);

    // 3) Estrai il tar nel filesystem temporaneo
    const extractDir = path.join(tmpRoot, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${result.path}" -C "${extractDir}"`, { stdio: 'ignore' });

    // 4) Verifica manifest valido
    const manifestPath = path.join(extractDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.dialect).toBe('sqlite');
    expect(manifest.contents).toContain('db');
    expect(manifest.appVersion).toBeTruthy();

    // 5) Apri lo snapshot SQLite estratto e conta le righe
    const dbPath = path.join(extractDir, 'conservatory.sqlite');
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(1024); // non vuoto

    // Apri il DB snapshot con una connessione Sequelize separata (read-only).
    const { Sequelize } = require('sequelize');
    const snap = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });
    try {
      const [rooms] = await snap.query('SELECT COUNT(*) as c FROM rooms');
      const [bookings] = await snap.query('SELECT COUNT(*) as c FROM bookings');
      const [users] = await snap.query('SELECT COUNT(*) as c FROM users');
      // I conteggi dello snapshot devono coincidere con quelli live.
      expect(Number(rooms[0].c)).toBe(Number(liveRoomCount[0].c));
      expect(Number(bookings[0].c)).toBe(Number(liveBookingCount[0].c));
      expect(Number(users[0].c)).toBeGreaterThanOrEqual(1);

      // Verifica nominativa: l'utente Mario inserito è presente nello snapshot.
      const [marios] = await snap.query(
        `SELECT id, firstName, lastName FROM users WHERE firstName = 'Mario'`,
      );
      expect(marios.length).toBeGreaterThanOrEqual(1);
      // La join utente→booking→room deve produrre almeno una riga (qualsiasi
      // matricola — la factory createRoom ignora overrides.buildingId quindi
      // non possiamo predire l'aula esatta).
      const [joined] = await snap.query(
        `SELECT u.firstName, r.name AS roomName
           FROM bookings b
           JOIN users u ON u.id = b.userId
           JOIN rooms r ON r.id = b.roomId
           WHERE u.firstName = 'Mario'`,
      );
      expect(joined.length).toBeGreaterThanOrEqual(1);
    } finally {
      await snap.close();
    }
  });

  it('deep restore verification: nessuna FK orfana e hash-chain audit integra', async () => {
    // Questo test va oltre il count-check: apre lo snapshot e verifica che
    // i dati siano *semanticamente coerenti*, non solo presenti.
    //
    // Check coperti:
    //  1. FK integrity: nessuna booking con roomId/userId mancanti
    //  2. FK integrity: nessuna stanza con buildingId mancante
    //  3. audit_log: hash chain valida sullo snapshot (richiede modello loadato)
    //
    // Il count-check live↔snapshot è già coperto dal test precedente; qui
    // ci concentriamo sulla qualità della copia, non sulla sua presenza.
    await globalThis.resetDatabase();
    const inst = await createInstitute({ name: 'Conservatorio Deep' });
    const building = await createBuilding({ instituteId: inst.id, name: 'Sede DR' });
    const room = await createRoom({ building, name: 'Aula DR' });
    const user = await createUser({ firstName: 'Restore', lastName: 'Verify' });
    await createBooking({
      user,
      room,
      startTime: new Date('2026-06-02T10:00:00'),
      endTime: new Date('2026-06-02T11:00:00'),
    });

    // Esegui backup
    delete require.cache[require.resolve('../../scripts/backup')];
    const { performBackup } = require('../../scripts/backup');
    const result = await performBackup();
    expect(result).toBeTruthy();

    // Estrai
    const extractDir = path.join(tmpRoot, 'extracted-deep');
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${result.path}" -C "${extractDir}"`, { stdio: 'ignore' });

    const dbPath = path.join(extractDir, 'conservatory.sqlite');
    expect(fs.existsSync(dbPath)).toBe(true);

    const { Sequelize, DataTypes } = require('sequelize');
    const snap = new Sequelize({ dialect: 'sqlite', storage: dbPath, logging: false });
    try {
      // ---- 1) FK orfane su bookings ----
      const [orphanBookingsRoom] = await snap.query(`
        SELECT COUNT(*) as c FROM bookings b
        WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = b.roomId)
      `);
      expect(Number(orphanBookingsRoom[0].c)).toBe(0);

      const [orphanBookingsUser] = await snap.query(`
        SELECT COUNT(*) as c FROM bookings b
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.userId)
      `);
      expect(Number(orphanBookingsUser[0].c)).toBe(0);

      // ---- 2) FK orfane su rooms ----
      const [orphanRooms] = await snap.query(`
        SELECT COUNT(*) as c FROM rooms r
        WHERE NOT EXISTS (SELECT 1 FROM buildings b WHERE b.id = r.buildingId)
      `);
      expect(Number(orphanRooms[0].c)).toBe(0);

      // ---- 3) Hash-chain audit (se popolata) ----
      // Mappiamo il model AuditLog sullo snapshot e usiamo lo stesso
      // verificatore della UI admin. Niente seed audit specifico: se la
      // tabella è vuota, il verifier ritorna scanned=0 / valid=true.
      const auditDef = require('../../models/AuditLog')(snap, DataTypes);
      // sync minimal (no force) — la tabella esiste già nel backup
      await snap.sync({ alter: false });
      const { verifyAuditIntegrity } = require('../../services/auditIntegrity');
      const verify = await verifyAuditIntegrity({ AuditLog: auditDef });
      expect(verify.ok).toBe(true);
      expect(verify.tamperingCount).toBe(0);
    } finally {
      await snap.close();
    }
  });

  it('listBackups elenca il file appena creato + deleteBackup lo rimuove', async () => {
    delete require.cache[require.resolve('../../scripts/backup')];
    const { performBackup, listBackups, deleteBackup } = require('../../scripts/backup');

    const r = await performBackup();
    const list = await listBackups();
    expect(list.some((b) => b.file === r.file)).toBe(true);

    await deleteBackup(r.file);
    expect(fs.existsSync(r.path)).toBe(false);
  });
});
