'use strict';

/**
 * Admin: gestione coda di outbox email (mail_outbox).
 *
 * Endpoint:
 *   GET    /            — lista paginata + filtri (status, kind, to, q)
 *   GET    /counts      — counts per status (pending, sent, dead)
 *   GET    /health      — stato SMTP (configured, verify, counts)
 *   POST   /:id/retry   — dead → pending, attempts=0, nextAttemptAt=now
 *   DELETE /:id         — cancella manualmente la riga
 *
 * Tutti gli endpoint richiedono ruolo admin.
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { MailOutbox } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function toSafeJson(row) {
  return {
    id: row.id,
    kind: row.kind,
    to: row.to,
    subject: row.subject,
    replyTo: row.replyTo,
    priority: row.priority,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // bodyHtml escluso dalla list per non gonfiare il payload — chi serve
    // un dettaglio può leggerlo separatamente in futuro (non implementato).
  };
}

// GET / — list paginata
router.get(
  '/',
  authenticate,
  requireRole('admin'),
  [
    query('status').optional().isIn(['pending', 'sent', 'dead']),
    query('kind').optional().isString().isLength({ max: 40 }),
    query('to').optional().isString().isLength({ max: 320 }),
    query('q').optional().isString().isLength({ max: 200 }),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }).toInt(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    }
    const page = req.query.page || 1;
    const limit = req.query.limit || DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.kind) where.kind = req.query.kind;
    if (req.query.to) where.to = req.query.to;
    if (req.query.q) {
      // ricerca substring su to/subject
      where[Op.or] = [
        { to: { [Op.like]: `%${req.query.q}%` } },
        { subject: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await MailOutbox.findAndCountAll({
      where,
      order: [
        ['priority', 'ASC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    res.json({
      items: rows.map(toSafeJson),
      total: count,
      page,
      limit,
      pages: Math.max(1, Math.ceil(count / limit)),
    });
  },
);

// GET /counts — riepilogo numerico per badge UI
router.get('/counts', authenticate, requireRole('admin'), async (_req, res) => {
  const [pending, sent, dead] = await Promise.all([
    MailOutbox.count({ where: { status: 'pending' } }),
    MailOutbox.count({ where: { status: 'sent' } }),
    MailOutbox.count({ where: { status: 'dead' } }),
  ]);
  res.json({ pending, sent, dead, total: pending + sent + dead });
});

// GET /health — stato SMTP + counts. Admin-only per non leakare la
// configurazione (presenza/assenza SMTP, host) a non autenticati.
router.get('/health', authenticate, requireRole('admin'), async (_req, res) => {
  const cfg = await emailService.loadConfig();
  const smtpConfigured = !!cfg?.transporter;
  let verifyOk = false;
  let verifyError = null;
  if (smtpConfigured) {
    try {
      await cfg.transporter.verify();
      verifyOk = true;
    } catch (err) {
      verifyError = err.message || String(err);
    }
  }
  const [pending, dead] = await Promise.all([
    MailOutbox.count({ where: { status: 'pending' } }),
    MailOutbox.count({ where: { status: 'dead' } }),
  ]);
  res.json({
    smtpConfigured,
    verifyOk,
    verifyError,
    pending,
    dead,
    healthy: smtpConfigured && verifyOk && dead === 0,
  });
});

// POST /:id/retry — solo per status='dead'. Resetta attempts e mette pending.
router.post(
  '/:id/retry',
  authenticate,
  requireRole('admin'),
  [param('id').isUUID()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'ID non valido' });
    }
    const row = await MailOutbox.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Email non trovata' });
    if (row.status !== 'dead') {
      return res.status(400).json({
        error: `Retry consentito solo per status='dead' (attuale: ${row.status})`,
      });
    }
    await row.update({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    });
    res.json({ ok: true, item: toSafeJson(row) });
  },
);

// DELETE /:id — cancella manualmente.
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  [param('id').isUUID()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'ID non valido' });
    }
    const removed = await MailOutbox.destroy({ where: { id: req.params.id } });
    if (removed === 0) return res.status(404).json({ error: 'Email non trovata' });
    res.json({ ok: true });
  },
);

module.exports = router;
