'use strict';

/**
 * Admin endpoint per il mirror Google Sheets:
 *   GET  /api/admin/google-sheets/status   → stato corrente (ultimo sync, errori)
 *   POST /api/admin/google-sheets/sync     → forza un sync immediato
 *   POST /api/admin/google-sheets/probe    → testa connessione e permessi
 *
 * La configurazione (spreadsheetId, enabled, intervallo) è in env vars,
 * non in DB: per cambiarla serve un riavvio del backend. Questo è
 * intenzionale: il mirror è una feature ops-level, non da utente finale.
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const mirror = require('../services/googleSheetsMirror');

const router = express.Router();

router.get('/status', authenticate, requireRole('admin'), (req, res) => {
  res.json(mirror.getStatus());
});

router.post('/probe', authenticate, requireRole('admin'), async (req, res) => {
  const r = await mirror.probe();
  res.status(r.ok ? 200 : 400).json(r);
});

router.post('/sync', authenticate, requireRole('admin'), async (req, res) => {
  const r = await mirror.syncNow();
  res.status(r.ok ? 200 : 400).json(r);
});

module.exports = router;
