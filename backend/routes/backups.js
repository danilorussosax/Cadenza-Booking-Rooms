'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { performBackup, listBackups, deleteBackup, BACKUP_DIR } = require('../scripts/backup');
const { performRestore, isRestoreInProgress } = require('../services/backupRestore');
const backupScheduler = require('../services/backupScheduler');
const logger = require('../lib/logger').child({ scope: 'backups.route' });

const router = express.Router();

// Multer per upload backup esterni: salva in temp e poi rinomina.
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const FILENAME_REGEX = /^backup-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/;

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname);
    cb(null, `cadenza-upload-${Date.now()}-${safe}`);
  },
});
const backupUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.endsWith('.tar.gz')) {
      return cb(new Error('Estensione non valida (atteso .tar.gz)'));
    }
    cb(null, true);
  },
});

// =====================================================
// LIST + STATUS scheduler
// =====================================================

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const items = listBackups();
  res.json({
    backups: items,
    backupDir: BACKUP_DIR,
    scheduler: backupScheduler.getStatus(),
  });
});

router.get('/scheduler-status', authenticate, requireRole('admin'), (_req, res) => {
  res.json(backupScheduler.getStatus());
});

// =====================================================
// SETTINGS — modifica config dello scheduler da UI
// La sorgente vincente è BackupSettings (singleton id=1); env restano
// fallback per BACKUP_DIR (non modificabile da UI: errore di path
// renderebbe il backup inutilizzabile) e per il primo bootstrap.
// =====================================================

const SETTINGS_FIELDS = [
  ['autoEnabled', 'boolean'],
  ['scheduledHour', 'int', 0, 23],
  ['scheduledMinute', 'int', 0, 59],
  ['keepDaily', 'int', 1, 365],
  ['keepWeekly', 'int', 1, 104],
  ['keepMonthly', 'int', 1, 60],
  ['autoRestartEnabled', 'boolean'],
];

router.put('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const updates = {};
    for (const [field, type, min, max] of SETTINGS_FIELDS) {
      if (!(field in (req.body || {}))) continue;
      const v = req.body[field];
      if (type === 'boolean') {
        if (typeof v !== 'boolean') {
          return res
            .status(400)
            .json({ error: `${field} deve essere booleano`, code: 'INVALID_FIELD' });
        }
        updates[field] = v;
      } else if (type === 'int') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max || !Number.isInteger(n)) {
          return res.status(400).json({
            error: `${field} deve essere un intero tra ${min} e ${max}`,
            code: 'INVALID_FIELD',
          });
        }
        updates[field] = n;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nessun campo da aggiornare', code: 'NO_UPDATES' });
    }

    const { BackupSettings } = require('../models');
    let row = await BackupSettings.findByPk(1);
    if (row) {
      await row.update(updates);
    } else {
      row = await BackupSettings.create({ id: 1, ...updates });
    }

    // Riprogramma il prossimo tick con i nuovi valori (autoEnabled / hour / minute).
    await backupScheduler.reschedule();

    res.json({ ok: true, scheduler: backupScheduler.getStatus() });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// CREATE — backup immediato
// =====================================================

router.post('/now', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await performBackup();
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, '[backup endpoint] errore');
    res.status(500).json({ error: err.message || 'Errore esecuzione backup' });
  }
});

// =====================================================
// UPLOAD — caricamento backup esterno (per restore da copia esterna)
// =====================================================

router.post(
  '/upload',
  authenticate,
  requireRole('admin'),
  backupUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
      const original = path.basename(req.file.originalname);
      if (!FILENAME_REGEX.test(original)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* noop */
        }
        return res.status(400).json({
          error: 'Nome file non valido. Atteso pattern backup-YYYY-MM-DD-HHmm.tar.gz',
          code: 'INVALID_FILENAME',
        });
      }
      const target = path.join(BACKUP_DIR, original);
      if (fs.existsSync(target)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* noop */
        }
        return res.status(409).json({
          error: 'Esiste già un backup con questo nome. Rimuovilo prima di ricaricare.',
          code: 'FILE_EXISTS',
        });
      }
      fs.renameSync(req.file.path, target);
      const stat = fs.statSync(target);
      res.status(201).json({
        file: original,
        sizeBytes: stat.size,
        message: 'Backup caricato. Ora puoi ripristinarlo dal pulsante "Ripristina".',
      });
    } catch (err) {
      try {
        fs.unlinkSync(req.file?.path);
      } catch {
        /* noop */
      }
      logger.error({ err }, '[backup upload] errore');
      res.status(500).json({ error: err.message });
    }
  },
);

// =====================================================
// DOWNLOAD
// =====================================================

router.get('/:filename/download', authenticate, requireRole('admin'), async (req, res) => {
  const filename = req.params.filename;
  if (!FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: 'Nome file non valido' });
  }
  const fp = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Backup non trovato' });
  res.download(fp, filename);
});

// =====================================================
// DELETE
// =====================================================

router.delete('/:filename', authenticate, requireRole('admin'), async (req, res) => {
  try {
    deleteBackup(req.params.filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// RESTORE
//
// Workflow di sicurezza:
//   1. Eseguiamo un backup PRE-restore (snapshot dello stato corrente)
//      così in caso di rollback l'admin ha il "punto di partenza" salvato.
//   2. Eseguiamo il restore vero (sostituisce DB + uploads).
//   3. Risposta 200 senza aspettare il restart: il client mostra messaggio
//      e l'admin può cliccare "Riavvia ora" (endpoint /restart) se è
//      configurato un process manager esterno (systemd / pm2).
//
// Conferma: il client deve mandare body.confirm === 'RESTORE' altrimenti 400.
// =====================================================

router.post('/:filename/restore', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!FILENAME_REGEX.test(filename)) {
      return res.status(400).json({ error: 'Nome file non valido' });
    }
    if (req.body?.confirm !== 'RESTORE') {
      return res.status(400).json({
        error: 'Conferma richiesta: il body deve contenere {"confirm":"RESTORE"}',
        code: 'CONFIRMATION_REQUIRED',
      });
    }
    if (isRestoreInProgress()) {
      return res.status(409).json({
        error: 'Restore già in corso',
        code: 'RESTORE_IN_PROGRESS',
      });
    }
    const archivePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(archivePath)) {
      return res.status(404).json({ error: 'Backup non trovato' });
    }

    // STEP 1 — snapshot pre-restore (errore qui blocca il restore).
    let preRestoreSnapshot = null;
    try {
      const snap = await performBackup();
      preRestoreSnapshot = snap.file;
      logger.info(`[restore] snapshot pre-restore: ${snap.file}`);
    } catch (err) {
      return res.status(500).json({
        error: `Snapshot pre-restore fallito: ${err.message}. Restore annullato per sicurezza.`,
        code: 'PRE_BACKUP_FAILED',
      });
    }

    // STEP 2 — restore vero
    const result = await performRestore({ archivePath });

    res.json({
      ok: true,
      restoredFile: filename,
      preRestoreSnapshot,
      manifest: result.manifest,
      restored: result.restored,
      durationMs: result.durationMs,
      message:
        'Ripristino completato. Riavvia il backend (POST /api/admin/backups/restart) per ricaricare il pool DB e applicare lo schema.',
    });
  } catch (err) {
    logger.error({ err }, '[restore endpoint] errore');
    res.status(500).json({ error: err.message, code: err.code });
  }
});

// =====================================================
// RESTART — graceful shutdown (richiede process manager: systemd / pm2)
// Risponde 202 e termina dopo 1 secondo. Il process manager riavvia.
// Senza process manager il server resta giù: per sicurezza accettiamo
// solo se AUTO_RESTART_ENABLED=true nelle env.
// =====================================================

router.post('/restart', authenticate, requireRole('admin'), (_req, res) => {
  if (process.env.AUTO_RESTART_ENABLED !== 'true') {
    return res.status(503).json({
      error:
        'Riavvio automatico disabilitato. Imposta AUTO_RESTART_ENABLED=true e usa systemd/pm2.',
      code: 'AUTO_RESTART_DISABLED',
    });
  }
  res.status(202).json({
    message: 'Riavvio programmato tra 1 secondo. Attendi qualche istante e ricarica la pagina.',
  });
  setTimeout(() => {
    // P1-7: invece di `process.exit(0)` (chiusura brutale che bypassa scheduler
    // e pool DB), inviamo SIGTERM al nostro stesso PID. server.js ha già un
    // signal handler che chiama `safeShutdown(0)` — quel path stoppa
    // retentionScheduler/reminderScheduler/backupScheduler, drena le
    // transazioni in volo e chiude il pool Sequelize prima di uscire.
    // Su Windows `process.kill('SIGTERM')` è equivalente all'exit forzato; la
    // feature di auto-restart richiede un process manager (systemd/pm2)
    // che gira solo su Linux/macOS, quindi non degradiamo niente.
    logger.info('[restart] graceful shutdown richiesto via API admin (SIGTERM)');
    try {
      process.kill(process.pid, 'SIGTERM');
    } catch (err) {
      // Ultimissimo fallback: se per qualche ragione SIGTERM non arriva
      // (es. handler removed via test), usciamo comunque per non lasciare
      // l'utente in attesa indefinita.
      logger.error({ err }, '[restart] SIGTERM fallito, exit forzato');
      process.exit(1);
    }
  }, 1000);
});

module.exports = router;
