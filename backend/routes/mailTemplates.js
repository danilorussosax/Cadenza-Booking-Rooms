'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { MailTemplate } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { DEFAULTS, KINDS, KIND_LABELS } = require('../services/mailTemplateDefaults');
const { render, renderText, extractVariables } = require('../services/templateRenderer');
const { sendTestEmail } = require('../services/emailService');
const dayjs = require('dayjs');

const router = express.Router();

// Sample context per la preview (non tocca il DB delle prenotazioni reali).
// Copre tutti i kind di template: booking, loan, announcement, claim_waitlist.
function sampleContext() {
  const now = dayjs();
  const start = now.add(2, 'day').hour(15).minute(0).second(0);
  const end = start.add(90, 'minute');
  const loanFrom = now.add(1, 'day');
  const loanTo = now.add(15, 'day');
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
    instrument: {
      name: 'Violino Stradivari',
      code: 'STR-001',
      brand: 'Stradivari',
      model: '1715',
      serialNumber: 'SN-19384',
    },
    loan: {
      fromDateLong: loanFrom.format('dddd D MMMM YYYY'),
      toDateLong: loanTo.format('dddd D MMMM YYYY'),
      fromDateShort: loanFrom.format('DD/MM/YYYY'),
      toDateShort: loanTo.format('DD/MM/YYYY'),
      durationLabel: '15 giorni',
      daysToReturn: 14,
      notes: 'Per concerto saggio di fine anno',
      status: 'active',
    },
    announcement: {
      title: 'Sospensione attività didattica',
      body: 'Il giorno 8 dicembre il Conservatorio rimarrà chiuso per festività.',
      publishedAtLong: now.format('dddd D MMMM YYYY'),
      expiresAtLong: now.add(7, 'day').format('dddd D MMMM YYYY'),
    },
    institute: {
      name: 'Conservatorio di Musica "Nino Rota"',
      copyright: 'Copyright © 2026 by Danilo Russo',
    },
    now: { dateTime: now.format('DD MMM YYYY · HH:mm') },
    extra: {
      claimUrl: 'https://cadenza.example.it/booking/claim/abc123',
      expiresAt: now.add(15, 'minute').format('DD MMM YYYY · HH:mm'),
    },
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

// POST /api/admin/mail-templates/:kind/send-test
// Renderizza il template con sampleContext e lo invia all'indirizzo `to`.
// Body: { to: string, subject?: string, bodyHtml?: string }
//   - se subject/bodyHtml sono passati (bozza non salvata), li usa al posto
//     del template salvato → permette di "provare" prima di salvare
router.post(
  '/:kind/send-test',
  authenticate,
  requireRole('admin'),
  [body('to').isEmail()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ error: 'Indirizzo destinatario non valido' });
    }
    const { kind } = req.params;
    if (!DEFAULTS[kind]) return res.status(404).json({ error: 'Tipo template sconosciuto' });
    const t = await loadOrSeed(kind);
    const subjectTpl = req.body?.subject ?? t.subject;
    const bodyTpl = req.body?.bodyHtml ?? t.bodyHtml;
    const ctx = sampleContext();
    const renderedSubject = renderText(subjectTpl, ctx);
    const renderedHtml = render(bodyTpl, ctx);
    // Prefisso [TEST] nel subject per distinguere visivamente in inbox
    // i test dai messaggi reali (es. se invii a noreply@ del tuo Gmail).
    const result = await sendTestEmail({
      to: req.body.to,
      subject: `[TEST] ${renderedSubject}`,
      html: renderedHtml,
    });
    if (result.ok) return res.json({ ok: true, sentTo: req.body.to, kind });
    res.json({ ok: false, error: result.error, raw: result.raw });
  },
);

module.exports = router;
