'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { MailTemplate } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { DEFAULTS, KINDS, KIND_LABELS } = require('../services/mailTemplateDefaults');
const { render, renderText, extractVariables } = require('../services/templateRenderer');
const dayjs = require('dayjs');

const router = express.Router();

// Sample context per la preview (non tocca il DB delle prenotazioni reali)
function sampleContext() {
  const now = dayjs();
  const start = now.add(2, 'day').hour(15).minute(0).second(0);
  const end = start.add(90, 'minute');
  return {
    user: {
      firstName: 'Mario',
      lastName: 'Rossi',
      email: 'mario.rossi@example.com',
      matricola: 'STU-1234',
    },
    booking: {
      type: 'Studio individuale',
      purpose: 'Studio Bach · Suite I',
      cancelReason: 'Imprevisto',
      dateLong: start.format('dddd D MMMM YYYY'),
      dateShort: start.format('DD/MM/YYYY'),
      timeRange: `${start.format('HH:mm')} – ${end.format('HH:mm')}`,
      startTime: start.format('HH:mm'),
      endTime: end.format('HH:mm'),
      duration: '1h 30m',
    },
    room: { name: 'Aula Verdi', floor: 'Primo Piano', capacity: 25 },
    building: { name: 'SEDE CENTRALE' },
    institute: {
      name: 'Conservatorio di Musica "Nino Rota"',
      copyright: 'Copyright © 2026 by Danilo Russo',
    },
    now: { dateTime: now.format('DD MMM YYYY · HH:mm') },
  };
}

async function loadOrSeed(kind) {
  if (!DEFAULTS[kind]) return null;
  let row = await MailTemplate.findOne({ where: { kind } });
  if (!row) {
    row = await MailTemplate.create({
      kind,
      subject: DEFAULTS[kind].subject,
      bodyHtml: DEFAULTS[kind].bodyHtml,
      isEnabled: true,
    });
  }
  return row;
}

// GET /api/admin/mail-templates → lista (auto-seed dei mancanti)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const items = await Promise.all(KINDS.map(loadOrSeed));
  res.json({
    templates: items.map((t) => ({
      kind: t.kind,
      label: KIND_LABELS[t.kind] || t.kind,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      isEnabled: t.isEnabled,
      isDefault: t.subject === DEFAULTS[t.kind].subject && t.bodyHtml === DEFAULTS[t.kind].bodyHtml,
      updatedAt: t.updatedAt,
    })),
    availableVariables: Object.keys(sampleContext()).flatMap((root) =>
      Object.keys(sampleContext()[root]).map((leaf) => `${root}.${leaf}`),
    ),
  });
});

// GET /api/admin/mail-templates/:kind
router.get('/:kind', authenticate, requireRole('admin'), async (req, res) => {
  const { kind } = req.params;
  if (!DEFAULTS[kind]) return res.status(404).json({ error: 'Tipo template sconosciuto' });
  const t = await loadOrSeed(kind);
  res.json({
    template: {
      kind: t.kind,
      label: KIND_LABELS[kind] || kind,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      isEnabled: t.isEnabled,
      defaults: DEFAULTS[kind],
      usedVariables: extractVariables(t.bodyHtml + ' ' + t.subject),
    },
  });
});

// PUT /api/admin/mail-templates/:kind
router.put(
  '/:kind',
  authenticate,
  requireRole('admin'),
  [
    body('subject').optional().isString().trim().notEmpty(),
    body('bodyHtml').optional().isString().trim().notEmpty(),
    body('isEnabled').optional().isBoolean(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });

    const { kind } = req.params;
    if (!DEFAULTS[kind]) return res.status(404).json({ error: 'Tipo template sconosciuto' });

    const t = await loadOrSeed(kind);
    if (req.body.subject !== undefined) t.subject = req.body.subject;
    if (req.body.bodyHtml !== undefined) t.bodyHtml = req.body.bodyHtml;
    if (req.body.isEnabled !== undefined) t.isEnabled = !!req.body.isEnabled;
    await t.save();
    res.json({ template: t });
  },
);

// POST /api/admin/mail-templates/:kind/reset
router.post('/:kind/reset', authenticate, requireRole('admin'), async (req, res) => {
  const { kind } = req.params;
  if (!DEFAULTS[kind]) return res.status(404).json({ error: 'Tipo template sconosciuto' });
  const t = await loadOrSeed(kind);
  t.subject = DEFAULTS[kind].subject;
  t.bodyHtml = DEFAULTS[kind].bodyHtml;
  t.isEnabled = true;
  await t.save();
  res.json({ template: t });
});

// POST /api/admin/mail-templates/:kind/preview
// Body opzionale { subject, bodyHtml } per anteprima della bozza non ancora salvata
router.post('/:kind/preview', authenticate, requireRole('admin'), async (req, res) => {
  const { kind } = req.params;
  if (!DEFAULTS[kind]) return res.status(404).json({ error: 'Tipo template sconosciuto' });
  const t = await loadOrSeed(kind);
  const subjectTpl = req.body?.subject ?? t.subject;
  const bodyTpl = req.body?.bodyHtml ?? t.bodyHtml;
  const ctx = sampleContext();
  res.json({
    subject: renderText(subjectTpl, ctx),
    bodyHtml: render(bodyTpl, ctx),
    sampleContext: ctx,
  });
});

module.exports = router;
