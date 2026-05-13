'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate, requireRole } = require('../middleware/auth');
const exporter = require('../services/excelExporter');

const router = express.Router();

// =====================================================
// GET /status — stato corrente del modulo (per UI admin)
// =====================================================
router.get('/status', authenticate, requireRole('admin'), (_req, res) => {
  res.json(exporter.getStatus());
});

// =====================================================
// POST /export-now — rigenera subito il file su disco
// =====================================================
router.post('/export-now', authenticate, requireRole('admin'), async (_req, res) => {
  const r = await exporter.exportNow();
  if (!r.ok) {
    return res.status(400).json({ error: r.reason });
  }
  res.json(r);
});

// =====================================================
// GET /download — scarica il file .xlsx dal browser
// Comodo per chi vuole il file subito senza aspettare il sync rclone.
// =====================================================
router.get('/download', authenticate, requireRole('admin'), async (_req, res) => {
  if (!exporter.isEnabled()) {
    return res.status(400).json({ error: 'Export disabilitato (EXCEL_EXPORT_ENABLED=false)' });
  }
  const filePath = exporter.getExportPath();
  if (!fs.existsSync(filePath)) {
    // Genera al volo se non esiste ancora
    const r = await exporter.exportNow();
    if (!r.ok) return res.status(500).json({ error: r.reason });
  }
  const filename = path.basename(filePath);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
