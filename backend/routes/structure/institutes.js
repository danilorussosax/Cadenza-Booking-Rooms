'use strict';

const express = require('express');
// Istituti: info pubblica, lista, dettaglio, creazione, modifica.

const { body, validationResult } = require('express-validator');
const { Institute, Building, Room, Equipment } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');

const { httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// ISTITUTI
// =========================================================

// Info pubblica: nome + logo + dati anagrafici/legali del primo istituto.
// Usata da: login/register (logo+nome), pagine /privacy-policy e /terms
// (denominazione legale, DPO, P.IVA, foro competente, sub-processor).
// Esposti come pubblici perché la Privacy Policy DEVE essere accessibile
// anche a utenti non autenticati (art. 13 GDPR).
// (PRIMA di /institutes/:id altrimenti :id matcherebbe "public")
router.get('/institutes/public', async (req, res) => {
  // Set base di colonne sempre richieste. I module flag sono richiesti in
  // un secondo SELECT difensivo: se il DB non li ha ancora (preSync non
  // eseguito su un'installazione legacy), facciamo fallback al default
  // true invece di crashare l'intero endpoint.
  const baseAttrs = [
    'id',
    'name',
    'code',
    'logoUrl',
    'appIconUrl',
    'address',
    'city',
    'country',
    'copyright',
    'legalName',
    'vatNumber',
    'fiscalCode',
    'pecEmail',
    'contactEmail',
    'dpoName',
    'dpoEmail',
    'jurisdictionCity',
    'subProcessors',
  ];
  let inst;
  try {
    inst = await Institute.findOne({
      order: [['id', 'ASC']],
      attributes: [...baseAttrs, 'moduleMonteOreEnabled', 'moduleInstrumentLoansEnabled'],
    });
  } catch {
    // Schema legacy senza le colonne module*: degrada con default true.
    const fallback = await Institute.findOne({
      order: [['id', 'ASC']],
      attributes: baseAttrs,
    });
    if (fallback) {
      const plain = fallback.toJSON();
      plain.moduleMonteOreEnabled = true;
      plain.moduleInstrumentLoansEnabled = true;
      return res.json({ institute: plain });
    }
    inst = null;
  }
  res.json({ institute: inst });
});

// Lista istituti (con tutta la struttura nidificata)
router.get('/institutes', authenticate, async (req, res) => {
  const includeFull = req.query.full === 'true';
  const include = includeFull
    ? [
        {
          model: Building,
          as: 'buildings',
          include: [
            {
              model: Room,
              as: 'rooms',
              include: [{ model: Equipment, as: 'equipment' }],
            },
          ],
        },
      ]
    : [];
  const institutes = await Institute.findAll({ include, order: [['name', 'ASC']] });
  res.json({ institutes });
});

router.get('/institutes/:id', authenticate, async (req, res) => {
  const institute = await Institute.findByPk(req.params.id, {
    include: [
      {
        model: Building,
        as: 'buildings',
        include: [
          {
            model: Room,
            as: 'rooms',
            include: [{ model: Equipment, as: 'equipment' }],
          },
        ],
      },
    ],
  });
  if (!institute) throw httpError(404, 'Istituto non trovato');
  res.json({ institute });
});

router.post(
  '/institutes',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw httpError(400, 'Validazione fallita', { details: errs.array() });
    const institute = await Institute.create(pickInstituteFields(req.body));
    res.status(201).json({ institute });
  },
);

router.put('/institutes/:id', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findByPk(req.params.id);
  if (!inst) throw httpError(404, 'Istituto non trovato');
  await inst.update(pickInstituteFields(req.body));
  // Il fuso salvato dall'admin diventa subito il fuso istituzionale attivo.
  await require('../../lib/institutionTimeBoot').configureFromInstitute({
    Institute,
    logger: require('../../lib/logger'),
  });
  res.json({ institute: inst });
});

// Whitelist esplicita dei campi assegnabili da admin via REST. Evita che
// future colonne aggiunte al modello (es. flag interni) siano modificabili
// di default — vanno scelte volontariamente.
const INSTITUTE_FIELDS = [
  'name',
  'code',
  'address',
  'city',
  'country',
  'timezone',
  'description',
  'logoUrl',
  'appIconUrl',
  'copyright',
  'legalName',
  'vatNumber',
  'fiscalCode',
  'pecEmail',
  'contactEmail',
  'dpoName',
  'dpoEmail',
  'jurisdictionCity',
  'subProcessors',
  'checkInRequireInstituteNetwork',
  'instituteNetworkCidrs',
  'moduleMonteOreEnabled',
  'moduleInstrumentLoansEnabled',
];
function pickInstituteFields(body) {
  const out = {};
  for (const f of INSTITUTE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
  }
  return out;
}

module.exports = router;
