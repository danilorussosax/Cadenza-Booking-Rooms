'use strict';

const express = require('express');
// Rimozione istituto e gestione logo.

const path = require('path');
const multer = require('multer');
const { Institute } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const removal = require('../../services/removal');
const storage = require('../../services/storage');

const { httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// Multer: upload del logo istituto su backend/uploads
// =========================================================
const ALLOWED_LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: storage.uploadsDir(),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `institute-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: storage.PROFILES.logo.maxBytes }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_LOGO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o SVG)'));
    }
    cb(null, true);
  },
});

router.delete('/institutes/:id', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findByPk(req.params.id);
  if (!inst) throw httpError(404, 'Istituto non trovato');
  const { removedBookings } = await removal.removeInstitute(inst.id, { bookings: 'purge' });
  res.json({
    message: 'Istituto eliminato (cascade su edifici/aule/attrezzature/prenotazioni)',
    removedBookings,
  });
});

// Helper: rimuovi file logo precedente se gestito da noi (path /storage/…)
function tryDeleteOldLogo(logoUrl) {
  return storage.removeStored(logoUrl);
}

// Upload logo (multipart/form-data, field name "file")
router.post(
  '/institutes/:id/logo',
  authenticate,
  requireRole('admin'),
  logoUpload.single('file'),
  async (req, res) => {
    const inst = await Institute.findByPk(req.params.id);
    if (!inst) throw httpError(404, 'Istituto non trovato');
    if (!req.file) throw httpError(400, 'Nessun file caricato');

    await tryDeleteOldLogo(inst.logoUrl);
    const newUrl = `/storage/${req.file.filename}`;
    await inst.update({ logoUrl: newUrl });
    res.json({ institute: inst, logoUrl: newUrl });
  },
);

// Rimuovi logo
router.delete('/institutes/:id/logo', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findByPk(req.params.id);
  if (!inst) throw httpError(404, 'Istituto non trovato');
  await tryDeleteOldLogo(inst.logoUrl);
  await inst.update({ logoUrl: null });
  res.json({ institute: inst });
});

module.exports = router;
