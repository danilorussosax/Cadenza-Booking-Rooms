'use strict';

/**
 * Routes admin per la Bacheca avvisi (CRUD).
 *
 *   GET    /api/admin/announcements           → lista (filtri: isActive, audience.kind)
 *   POST   /api/admin/announcements           → crea + opzionale invio email broadcast
 *   PUT    /api/admin/announcements/:id       → modifica
 *   DELETE /api/admin/announcements/:id       → soft-delete (paranoid)
 *   POST   /api/admin/announcements/:id/resend → re-invio email broadcast (idempotente)
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { Announcement, User, Course, Building } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeAudience, VALID_KINDS } = require('../services/audienceMatcher');

const router = express.Router();

// =====================================================
// GET /api/admin/announcements
// =====================================================
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.isActive === 'true') where.isActive = true;
    if (req.query.isActive === 'false') where.isActive = false;

    const list = await Announcement.findAll({
      where,
      include: [
        { model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] },
      ],
      order: [['publishedAt', 'DESC']],
    });
    res.json({ announcements: list });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// Helpers di validazione
// =====================================================
async function validateAudienceTarget(audience) {
  if (audience.kind === 'course') {
    const course = await Course.findByPk(audience.value);
    if (!course) return 'Corso non trovato';
  } else if (audience.kind === 'building') {
    const building = await Building.findByPk(audience.value);
    if (!building) return 'Edificio non trovato';
  }
  return null;
}

function buildPayload(body, currentUserId) {
  const audience = normalizeAudience(body.audience);
  return {
    title: (body.title || '').trim(),
    body: (body.body || '').trim(),
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    audience,
    isPinned: body.isPinned === true,
    isActive: body.isActive !== false,
    createdBy: currentUserId,
  };
}

function validateUpsertPayload(payload) {
  const errors = [];
  if (!payload.title) errors.push('Titolo obbligatorio');
  if (payload.title && payload.title.length > 200) errors.push('Titolo troppo lungo (max 200)');
  if (!payload.body) errors.push('Corpo obbligatorio');
  if (!VALID_KINDS.includes(payload.audience.kind)) errors.push('Audience kind non valido');
  if (payload.expiresAt && payload.publishedAt && payload.expiresAt < payload.publishedAt) {
    errors.push('La data di scadenza deve essere successiva alla pubblicazione');
  }
  return errors;
}

// =====================================================
// POST /api/admin/announcements
// Body: { title, body (md), publishedAt?, expiresAt?, audience, isPinned, isActive, sendEmail? }
// =====================================================
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [body('title').notEmpty().trim().isLength({ max: 200 }), body('body').notEmpty().trim()],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        return res.status(400).json({
          error: 'Validazione fallita',
          code: 'VALIDATION_FAILED',
          details: errs.array(),
        });
      }
      const payload = buildPayload(req.body, req.user.id);
      const fieldErrors = validateUpsertPayload(payload);
      if (fieldErrors.length) {
        return res.status(400).json({
          error: fieldErrors[0],
          code: 'VALIDATION_FAILED',
          details: fieldErrors.map((m) => ({ message: m })),
        });
      }
      const audienceErr = await validateAudienceTarget(payload.audience);
      if (audienceErr) {
        return res.status(400).json({ error: audienceErr, code: 'INVALID_AUDIENCE_TARGET' });
      }

      const ann = await Announcement.create(payload);

      // Invio email opt-in: solo se richiesto E pubblicato adesso (no future-dated).
      if (req.body.sendEmail && ann.publishedAt <= new Date() && ann.isActive) {
        // Lazy import per evitare cicli (announcementEmail → models → ...).
        const { sendAnnouncementBroadcast } = require('../services/announcementEmail');
        // Fire-and-forget: la response non aspetta l'invio per non bloccare
        // l'admin per O(N) con N = numero destinatari.
        sendAnnouncementBroadcast(ann.id).catch((e) => {
          console.error('[announcement] broadcast error:', e.message);
        });
      }

      res.status(201).json({ announcement: ann });
    } catch (err) {
      next(err);
    }
  },
);

// =====================================================
// PUT /api/admin/announcements/:id
// =====================================================
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ann = await Announcement.findByPk(req.params.id);
    if (!ann) return res.status(404).json({ error: 'Avviso non trovato', code: 'NOT_FOUND' });

    const merged = {
      title: req.body.title ?? ann.title,
      body: req.body.body ?? ann.body,
      publishedAt: req.body.publishedAt ?? ann.publishedAt,
      expiresAt: req.body.expiresAt ?? ann.expiresAt,
      audience: req.body.audience ?? ann.audience,
      isPinned: req.body.isPinned ?? ann.isPinned,
      isActive: req.body.isActive ?? ann.isActive,
    };
    const payload = buildPayload({ ...merged }, ann.createdBy);
    const fieldErrors = validateUpsertPayload(payload);
    if (fieldErrors.length) {
      return res.status(400).json({
        error: fieldErrors[0],
        code: 'VALIDATION_FAILED',
        details: fieldErrors.map((m) => ({ message: m })),
      });
    }
    const audienceErr = await validateAudienceTarget(payload.audience);
    if (audienceErr) {
      return res.status(400).json({ error: audienceErr, code: 'INVALID_AUDIENCE_TARGET' });
    }

    await ann.update(payload);
    res.json({ announcement: ann });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// DELETE /api/admin/announcements/:id
// =====================================================
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ann = await Announcement.findByPk(req.params.id);
    if (!ann) return res.status(404).json({ error: 'Avviso non trovato', code: 'NOT_FOUND' });
    await ann.destroy({ force: req.query.force === 'true' });
    res.json({ message: 'Avviso eliminato' });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/admin/announcements/:id/resend
// Forza un nuovo invio email azzerando emailSentAt + chiamando il broadcast.
// =====================================================
router.post('/:id/resend', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ann = await Announcement.findByPk(req.params.id);
    if (!ann) return res.status(404).json({ error: 'Avviso non trovato', code: 'NOT_FOUND' });
    await ann.update({ emailSentAt: null });
    const { sendAnnouncementBroadcast } = require('../services/announcementEmail');
    const result = await sendAnnouncementBroadcast(ann.id);
    res.json({ message: 'Broadcast eseguito', ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
