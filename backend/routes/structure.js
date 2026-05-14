'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const {
  sequelize,
  Institute,
  Building,
  Room,
  Equipment,
  EquipmentTemplate,
  Booking,
} = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { importStructure } = require('../services/structureImporter');
const { pickAllowed, ValidationError } = require('../lib/sanitize');
const { isCheckInRequired } = require('../lib/checkInPolicy');

// Whitelist dei campi assegnabili da admin via REST (anti mass-assignment).
// Esclude esplicitamente: id, deletedAt, createdAt, updatedAt, qrToken (gestito
// solo da endpoint dedicati /qr/regenerate).
const BUILDING_ALLOWED = {
  instituteId: { type: 'integer', min: 1 },
  name: { type: 'string', maxLength: 100 },
  code: { type: 'string', maxLength: 50, nullable: true },
  address: { type: 'string', maxLength: 255, nullable: true },
  floors: 'json', // array di stringhe; validazione di forma a livello model
  description: { type: 'string', nullable: true },
  displayEnabled: 'boolean',
  displayIntervalSec: { type: 'integer', min: 5, max: 600 },
  displayConcertsDays: { type: 'integer', min: 0, max: 365 },
  displayConcertsEnabled: 'boolean',
  displayConcertsCount: { type: 'integer', min: 0, max: 100 },
  displayConcertsIntervalSec: { type: 'integer', min: 1, max: 600 },
  displayBookingsEnabled: 'boolean',
  displayAnnouncementsEnabled: 'boolean',
  displayAnnouncementsCount: { type: 'integer', min: 0, max: 100 },
  displayAnnouncementsIntervalSec: { type: 'integer', min: 1, max: 600 },
  displayAnnouncementsPinnedOnly: 'boolean',
  displayViewMode: { type: 'enum', values: ['weekly', 'daily'] },
  // Toggle "check-in per edificio" (impostazione generale).
  checkInDefault: 'boolean',
};

const ROOM_ALLOWED = {
  buildingId: { type: 'integer', min: 1 },
  name: { type: 'string', maxLength: 100 },
  code: { type: 'string', maxLength: 50, nullable: true },
  floor: { type: 'string', maxLength: 50, nullable: true },
  capacity: { type: 'integer', min: 0, max: 10000, nullable: true },
  type: {
    // Allineato all'ENUM del model Room.type. Storicamente questo validator
    // aveva una lista diversa (aula/concerto/ufficio) che non riflette mai
    // esistita nel model: salvare un'aula con tipo "classe" o "aula_concerti"
    // veniva rifiutato dal validator con "Valore X non valido per type".
    type: 'enum',
    values: ['studio', 'sala_prove', 'aula_concerti', 'classe', 'aula_didattica', 'altro'],
  },
  allowedRoles: 'json',
  allowedCourseIds: 'json',
  isBookable: 'boolean',
  // null = eredita Building.checkInDefault (impostazione generale)
  // true/false = override esplicito. Vedi backend/lib/checkInPolicy.js.
  requireCheckIn: { type: 'boolean', nullable: true },
  requiresApproval: 'boolean',
  notes: { type: 'string', nullable: true },
  // photoUrl: gestito da POST /rooms/:id/photo, NON da PUT
  // qrToken: gestito da POST /rooms/:id/qr/regenerate, NON da PUT
};

const EQUIPMENT_ALLOWED = {
  roomId: { type: 'integer', min: 1, nullable: true },
  name: { type: 'string', maxLength: 100 },
  type: { type: 'string', maxLength: 50, nullable: true },
  brand: { type: 'string', maxLength: 100, nullable: true },
  model: { type: 'string', maxLength: 100, nullable: true },
  quantity: { type: 'integer', min: 0, max: 10000, nullable: true },
  serialNumber: { type: 'string', maxLength: 100, nullable: true },
  notes: { type: 'string', nullable: true },
  isWorking: 'boolean',
};

// =========================================================
// Multer: upload del logo istituto su backend/uploads
// =========================================================
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `institute-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_LOGO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o SVG)'));
    }
    cb(null, true);
  },
});

// =========================================================
// Multer (memory) per le foto delle aule.
// Le immagini caricate vengono ridimensionate con sharp:
//   - aspect ratio 16:9 fisso (1200x675), object-fit:cover
//   - convertite in WEBP qualità 82 per ridurre la dimensione
//   - rimuove EXIF/orientation gestito da sharp.rotate() prima del resize
// =========================================================
const ALLOWED_ROOM_PHOTO_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
];
const ROOM_PHOTO_TARGET_WIDTH = 1200;
const ROOM_PHOTO_TARGET_HEIGHT = 675; // 16:9
const roomPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB pre-resize
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ROOM_PHOTO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o HEIC)'));
    }
    cb(null, true);
  },
});

const router = express.Router();

// =========================================================
// IMPORT STRUTTURA da CSV (admin only)
// Body: { instituteId: number, csv: string }
// CSV idempotente: upsert su (institute+nome edificio), (edificio+nome aula),
// (aula+nome attrezzatura). Ri-eseguire l'import non duplica.
// =========================================================
// =========================================================
// GET /api/structure/export.csv?instituteId=...
// Esporta in CSV la struttura completa di un istituto: una riga per
// (edificio × aula × attrezzatura). Le aule senza attrezzature compaiono
// con colonne attrezzatura vuote. Round-trip safe: il CSV prodotto può
// essere ricaricato via POST /api/structure/import.
// =========================================================
const { stringify: csvStringify } = require('csv-stringify/sync');
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const instituteId = parseInt(req.query.instituteId, 10);
    if (!instituteId) return res.status(400).json({ error: 'instituteId obbligatorio' });
    const inst = await Institute.findByPk(instituteId);
    if (!inst) return res.status(404).json({ error: 'Istituto non trovato' });

    const buildings = await Building.findAll({
      where: { instituteId },
      include: [
        {
          association: 'rooms',
          include: [{ association: 'equipment' }],
        },
      ],
      order: [['name', 'ASC']],
    });

    const headers = [
      'Edificio',
      'Codice edificio',
      'Indirizzo edificio',
      'Piano',
      'Aula',
      'Codice aula',
      'Capienza',
      'Tipo aula',
      'Prenotabile',
      'Attrezzatura',
      'Tipo attrezzatura',
      'Marca',
      'Modello',
      'Quantità',
    ];
    const rows = [headers];

    for (const b of buildings) {
      const sortedRooms = (b.rooms || []).slice().sort((a, c) => a.name.localeCompare(c.name));
      if (sortedRooms.length === 0) {
        // Edificio senza aule → riga di sole colonne edificio (utile per
        // preservare metadati nei round-trip).
        rows.push([
          b.name,
          b.code || '',
          b.address || '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      for (const r of sortedRooms) {
        const equip = (r.equipment || []).slice().sort((a, c) => a.name.localeCompare(c.name));
        if (equip.length === 0) {
          rows.push([
            b.name,
            b.code || '',
            b.address || '',
            r.floor || '',
            r.name,
            r.code || '',
            r.capacity ?? '',
            r.type || '',
            r.isBookable ? 'si' : 'no',
            '',
            '',
            '',
            '',
            '',
          ]);
        } else {
          for (const e of equip) {
            rows.push([
              b.name,
              b.code || '',
              b.address || '',
              r.floor || '',
              r.name,
              r.code || '',
              r.capacity ?? '',
              r.type || '',
              r.isBookable ? 'si' : 'no',
              e.name,
              e.type || '',
              e.brand || '',
              e.model || '',
              e.quantity ?? '',
            ]);
          }
        }
      }
    }

    const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="struttura-${inst.code || inst.id}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // BOM UTF-8 → Excel apre in modo corretto i caratteri accentati.
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
});

router.post('/import', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { instituteId, csv } = req.body || {};
    const result = await importStructure({
      instituteId: parseInt(instituteId, 10),
      csv: typeof csv === 'string' ? csv : '',
    });
    // Appiattisce la risposta del service per il client e la wrappa in
    // `{ result }` come si aspetta il client esistente (vedi
    // frontend/src/api/structure.ts e CsvImportDialog.tsx). Lo schema piatto
    // (`buildingsCreated`, `roomsCreated`, ecc.) era già documentato nella
    // type CsvImportResult; il bug era che il backend restituiva nested e no
    // wrapper → undefined.roomsCreated.
    res.json({
      result: {
        parsed: result.parsed,
        buildingsCreated: result.buildings.created,
        buildingsUpdated: result.buildings.updated,
        roomsCreated: result.rooms.created,
        roomsUpdated: result.rooms.updated,
        equipmentCreated: result.equipment.created,
        equipmentUpdated: result.equipment.updated,
        skipped: result.skipped,
        // CsvImportDialog usa `e.row` e `e.message` — mappiamo dal service
        // (che usa `line` e `msg`) per mantenere il contratto stabilito.
        errors: result.errors.map((e) => ({ row: e.line, message: e.msg })),
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Errore import CSV:', err);
    next(err);
  }
});

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
  if (!institute) return res.status(404).json({ error: 'Istituto non trovato' });
  res.json({ institute });
});

router.post(
  '/institutes',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    const institute = await Institute.create(pickInstituteFields(req.body));
    res.status(201).json({ institute });
  },
);

router.put('/institutes/:id', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findByPk(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Istituto non trovato' });
  await inst.update(pickInstituteFields(req.body));
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

// =========================================================
// Check-in security policy: GET/PUT toggle + CIDR allowlist.
// Singleton: opera sul primo Institute (l'app è single-institute in prod).
// CIDR validati con ipaddr.js (IPv4/IPv6) — riga rifiutata se invalida.
// =========================================================
const { validateCidr, extractClientIp, normalizeIp } = require('../lib/network');
router.get('/checkin-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({
    attributes: ['id', 'checkInRequireInstituteNetwork', 'instituteNetworkCidrs'],
    order: [['id', 'ASC']],
  });
  if (!inst) return res.status(404).json({ error: 'Istituto non configurato' });
  res.json({
    checkInRequireInstituteNetwork: !!inst.checkInRequireInstituteNetwork,
    instituteNetworkCidrs: Array.isArray(inst.instituteNetworkCidrs)
      ? inst.instituteNetworkCidrs
      : [],
    // Espone l'IP attuale dell'admin chiamante per UX: l'admin può copiarlo
    // in whitelist con un click ("Aggiungi mio IP corrente"). Normalizzato
    // per rimuovere il prefisso IPv4-mapped IPv6 (`::ffff:1.2.3.4` → `1.2.3.4`).
    callerIp: normalizeIp(extractClientIp(req)),
  });
});

router.put('/checkin-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) return res.status(404).json({ error: 'Istituto non configurato' });

  const { checkInRequireInstituteNetwork, instituteNetworkCidrs } = req.body || {};

  if (typeof checkInRequireInstituteNetwork !== 'boolean') {
    return res.status(400).json({
      error: 'checkInRequireInstituteNetwork deve essere booleano',
      code: 'VALIDATION',
    });
  }
  if (!Array.isArray(instituteNetworkCidrs)) {
    return res.status(400).json({
      error: 'instituteNetworkCidrs deve essere un array',
      code: 'VALIDATION',
    });
  }

  // Valida ogni CIDR; aggrega errori per UX migliore.
  const errors = [];
  const normalized = [];
  for (let i = 0; i < instituteNetworkCidrs.length; i++) {
    const raw = instituteNetworkCidrs[i];
    const v = validateCidr(raw);
    if (!v.ok) {
      errors.push({ index: i, value: raw, error: v.error });
    } else {
      normalized.push(v.normalized);
    }
  }
  if (errors.length > 0) {
    return res.status(400).json({
      error: 'CIDR non validi',
      code: 'INVALID_CIDR',
      errors,
    });
  }

  // Safety: se il toggle viene attivato con allowlist vuota, è una
  // misconfiguration (nessuno potrà fare check-in). Permettiamo ma
  // segnaliamo nel response come warning per UX.
  inst.checkInRequireInstituteNetwork = checkInRequireInstituteNetwork;
  inst.instituteNetworkCidrs = normalized;
  await inst.save();

  const warnings = [];
  if (checkInRequireInstituteNetwork && normalized.length === 0) {
    warnings.push(
      'Lista CIDR vuota: nessun client potrà effettuare check-in finché non aggiungi almeno un CIDR.',
    );
  }

  res.json({
    checkInRequireInstituteNetwork: inst.checkInRequireInstituteNetwork,
    instituteNetworkCidrs: inst.instituteNetworkCidrs,
    warnings,
  });
});

// =========================================================
// Module flags — toggle "presentational" della sidebar.
// Il backend resta sempre attivo: questi toggle servono soltanto a
// mostrare o nascondere i link "Monte ore" e "Strumenti" in UI.
// Singleton sull'unico Institute.
// =========================================================
// Espone il REGISTRY (lista dei moduli toggle-abili). La UI lo consuma per
// iterare invece di hardcodare gli N moduli. Lascia anche scoprire i
// `defaultEnabled` quando l'Institute è appena seedato.
const { listModules, publicRegistry } = require('../services/moduleFlags');
const { invalidateModuleCache } = require('../middleware/moduleGuard');

router.get('/module-settings/registry', authenticate, requireRole('admin'), (req, res) => {
  res.json({ modules: publicRegistry() });
});

router.get('/module-settings', authenticate, requireRole('admin'), async (req, res) => {
  const cols = listModules().map((m) => m.column);
  const inst = await Institute.findOne({
    attributes: ['id', ...cols],
    order: [['id', 'ASC']],
  });
  if (!inst) return res.status(404).json({ error: 'Istituto non configurato' });
  const out = {};
  for (const m of listModules()) {
    out[m.column] = !!inst[m.column];
  }
  res.json(out);
});

router.put('/module-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) return res.status(404).json({ error: 'Istituto non configurato' });

  // Itera sul registry: per ogni modulo accettiamo il booleano sotto la
  // sua colonna esatta. Body sconosciuti (campi non in registry) sono
  // ignorati — anti mass-assignment by default.
  const update = {};
  for (const m of listModules()) {
    const v = req.body?.[m.column];
    if (typeof v === 'boolean') update[m.column] = v;
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({
      error: 'Nessun flag valido nel body',
      code: 'VALIDATION',
    });
  }
  await inst.update(update);
  // Propaga immediatamente la modifica al middleware moduleGuard, senza
  // attendere il TTL della cache (utile per i test e per evitare la finestra
  // di 30 s in cui un modulo appena spento sarebbe ancora "raggiungibile").
  invalidateModuleCache();

  const out = {};
  for (const m of listModules()) {
    out[m.column] = !!inst[m.column];
  }
  res.json(out);
});

router.delete('/institutes/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const inst = await Institute.findByPk(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Istituto non trovato' });
    let photoSnapshot = [];
    let logoUrl = null;
    const result = await sequelize.transaction(async (t) => {
      logoUrl = inst.logoUrl;
      // Trova tutte le rooms collegate (via buildings) per cancellarne le booking
      // e tenere traccia delle photoUrl da rimuovere dal disco dopo il commit.
      const buildings = await Building.findAll({
        where: { instituteId: inst.id },
        attributes: ['id'],
        transaction: t,
      });
      const buildingIds = buildings.map((b) => b.id);
      let removedBookings = 0;
      if (buildingIds.length > 0) {
        const rooms = await Room.findAll({
          where: { buildingId: { [Op.in]: buildingIds } },
          attributes: ['id', 'photoUrl'],
          transaction: t,
        });
        photoSnapshot = rooms;
        const roomIds = rooms.map((r) => r.id);
        if (roomIds.length > 0) {
          removedBookings = await Booking.destroy({
            where: { roomId: { [Op.in]: roomIds } },
            transaction: t,
          });
        }
        // Cascade del soft-delete: paranoid Sequelize non propaga ai figli,
        // quindi se non destroy() esplicitamente Room/Building i record
        // restano alive con `deletedAt IS NULL`. Risultato: le query che
        // non joinano via Building (es. /public/stats roomsTotal) contano
        // aule "orfane" non visibili dall'albero Structure.
        await Room.destroy({
          where: { buildingId: { [Op.in]: buildingIds } },
          transaction: t,
        });
        await Building.destroy({
          where: { instituteId: inst.id },
          transaction: t,
        });
      }
      await inst.destroy({ transaction: t });
      return removedBookings;
    });
    // Pulizia file su disco DOPO il commit (idempotente, errori ignorati)
    tryDeleteRoomPhotos(photoSnapshot);
    tryDeleteOldLogo(logoUrl);
    res.json({
      message: 'Istituto eliminato (cascade su edifici/aule/attrezzature/prenotazioni)',
      removedBookings: result,
    });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
    }
    next(err);
  }
});

// Helper: rimuovi file logo precedente se gestito da noi (path /storage/…)
function tryDeleteOldLogo(logoUrl) {
  if (!logoUrl || !logoUrl.startsWith('/storage/')) return;
  const file = path.basename(logoUrl);
  const fp = path.join(UPLOADS_DIR, file);
  fs.unlink(fp, () => {});
}

// Upload logo (multipart/form-data, field name "file")
router.post(
  '/institutes/:id/logo',
  authenticate,
  requireRole('admin'),
  logoUpload.single('file'),
  async (req, res) => {
    const inst = await Institute.findByPk(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Istituto non trovato' });
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

    tryDeleteOldLogo(inst.logoUrl);
    const newUrl = `/storage/${req.file.filename}`;
    await inst.update({ logoUrl: newUrl });
    res.json({ institute: inst, logoUrl: newUrl });
  },
);

// Rimuovi logo
router.delete('/institutes/:id/logo', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findByPk(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Istituto non trovato' });
  tryDeleteOldLogo(inst.logoUrl);
  await inst.update({ logoUrl: null });
  res.json({ institute: inst });
});

// =========================================================
// EDIFICI
// =========================================================

router.get('/buildings', authenticate, async (req, res) => {
  const where = {};
  if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const buildings = await Building.findAll({
    where,
    include: [
      { model: Institute, as: 'institute' },
      { model: Room, as: 'rooms' },
    ],
    order: [['name', 'ASC']],
  });
  res.json({ buildings });
});

// =========================================================
// Toggle check-in per edificio (impostazione generale)
// =========================================================
//   GET   /buildings/checkin-defaults            lista + statistiche override
//   PATCH /buildings/:id/checkin-default         on/off generale per edificio
//
// Registrate PRIMA di /buildings/:id (GET) per evitare il match dinamico:
// :id="checkin-defaults" farebbe esplodere findByPk con un cast intero.
router.get(
  '/buildings/checkin-defaults',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const buildings = await Building.findAll({
        attributes: ['id', 'name', 'code', 'checkInDefault'],
        order: [['name', 'ASC']],
      });
      // Conteggio per-edificio in un'unica query: si bucketizza in JS
      // invece di fare 2 Room.count per ogni building (era 2N+1 round-trip).
      const rooms = await Room.findAll({
        attributes: ['buildingId', 'requireCheckIn'],
        where: { buildingId: buildings.map((b) => b.id) },
        raw: true,
      });
      const counts = new Map();
      for (const r of rooms) {
        const entry = counts.get(r.buildingId) || { total: 0, overrides: 0 };
        entry.total += 1;
        if (r.requireCheckIn !== null) entry.overrides += 1;
        counts.set(r.buildingId, entry);
      }
      const items = buildings.map((b) => {
        const c = counts.get(b.id) || { total: 0, overrides: 0 };
        return {
          id: b.id,
          name: b.name,
          code: b.code,
          checkInDefault: b.checkInDefault,
          roomsTotal: c.total,
          roomsWithOverride: c.overrides,
        };
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/buildings/:id/checkin-default',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const b = await Building.findByPk(req.params.id);
      if (!b) return res.status(404).json({ error: 'Edificio non trovato', code: 'NOT_FOUND' });
      const raw = req.body?.enabled;
      if (typeof raw !== 'boolean') {
        return res.status(400).json({
          error: 'Campo "enabled" deve essere boolean',
          code: 'VALIDATION_FAILED',
        });
      }
      await b.update({ checkInDefault: raw });
      const rooms = await Room.findAll({
        attributes: ['requireCheckIn'],
        where: { buildingId: b.id },
        raw: true,
      });
      const roomsTotal = rooms.length;
      const roomsWithOverride = rooms.filter((r) => r.requireCheckIn !== null).length;
      res.json({
        building: {
          id: b.id,
          name: b.name,
          code: b.code,
          checkInDefault: b.checkInDefault,
          roomsTotal,
          roomsWithOverride,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/buildings/:id', authenticate, async (req, res) => {
  const building = await Building.findByPk(req.params.id, {
    include: [
      { model: Institute, as: 'institute' },
      { model: Room, as: 'rooms', include: [{ model: Equipment, as: 'equipment' }] },
    ],
  });
  if (!building) return res.status(404).json({ error: 'Edificio non trovato' });
  res.json({ building });
});

router.post(
  '/buildings',
  authenticate,
  requireRole('admin'),
  [
    body('instituteId').isInt(),
    body('name').notEmpty().trim(),
    body('floors').optional().isArray(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    try {
      const building = await Building.create(pickAllowed(req.body, BUILDING_ALLOWED));
      res.status(201).json({ building });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code, field: err.field });
      }
      res.status(500).json({ error: 'Errore creazione edificio', details: err.message });
    }
  },
);

// Bulk delete edifici (admin) — REGISTRATO PRIMA di /:id per vincere il route match.
// In transazione: rimuove le booking delle aule degli edifici, poi le aule, poi gli edifici.
router.post(
  '/buildings/bulk-delete',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
      const rooms = await Room.findAll({
        where: { buildingId: { [Op.in]: ids } },
        attributes: ['id', 'photoUrl'],
      });
      const roomIds = rooms.map((r) => r.id);
      const result = await sequelize.transaction(async (t) => {
        let removedBookings = 0;
        if (roomIds.length > 0) {
          removedBookings = await Booking.destroy({
            where: { roomId: { [Op.in]: roomIds } },
            transaction: t,
          });
        }
        const removedRooms = await Room.destroy({
          where: { buildingId: { [Op.in]: ids } },
          transaction: t,
        });
        const deleted = await Building.destroy({
          where: { id: { [Op.in]: ids } },
          transaction: t,
        });
        return { deleted, removedRooms, removedBookings };
      });
      tryDeleteRoomPhotos(rooms);
      res.json(result);
    } catch (err) {
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
      }
      next(err);
    }
  },
);

router.put('/buildings/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const b = await Building.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Edificio non trovato' });
    await b.update(pickAllowed(req.body, BUILDING_ALLOWED));
    res.json({ building: b });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    }
    next(err);
  }
});

router.delete('/buildings/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const b = await Building.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Edificio non trovato' });
    let photoSnapshot = [];
    const result = await sequelize.transaction(async (t) => {
      const rooms = await Room.findAll({
        where: { buildingId: b.id },
        attributes: ['id', 'photoUrl'],
        transaction: t,
      });
      photoSnapshot = rooms;
      const roomIds = rooms.map((r) => r.id);
      let removedBookings = 0;
      if (roomIds.length > 0) {
        removedBookings = await Booking.destroy({
          where: { roomId: { [Op.in]: roomIds } },
          transaction: t,
        });
        // Cascade del soft-delete: senza questo le aule restano `deletedAt
        // IS NULL` e gonfiano i counter che non joinano via Building.
        await Room.destroy({
          where: { buildingId: b.id },
          transaction: t,
        });
      }
      await b.destroy({ transaction: t });
      return removedBookings;
    });
    tryDeleteRoomPhotos(photoSnapshot);
    res.json({ message: 'Edificio eliminato', removedBookings: result });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
    }
    next(err);
  }
});

// =========================================================
// AULE
// =========================================================

// Bulk delete (admin) — registered BEFORE :id to win the route match.
// In transazione: rimuove prima le prenotazioni delle aule selezionate, poi le aule.
router.post('/rooms/bulk-delete', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    // Snapshot delle photoUrl prima di cancellare le righe — i file su disco
    // verranno rimossi dopo il commit per evitare file orfani in /uploads.
    const snap = await Room.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'photoUrl'],
    });
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { roomId: { [Op.in]: ids } },
        transaction: t,
      });
      const deleted = await Room.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });
      return { deleted, removedBookings };
    });
    tryDeleteRoomPhotos(snap);
    res.json(result);
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
    }
    next(err);
  }
});

router.get('/rooms', authenticate, async (req, res) => {
  const where = {};
  if (req.query.buildingId) where.buildingId = req.query.buildingId;
  if (req.query.bookable === 'true') where.isBookable = true;
  // required: true → INNER JOIN su Building. Esclude le aule "orfane" il
  // cui edificio è stato soft-deleted da /admin/structure (Building è
  // paranoid, ma il soft-delete non cascada sulle Room: senza questo
  // filtro l'endpoint elencherebbe aule che non compaiono in Structure).
  const rooms = await Room.findAll({
    where,
    include: [
      {
        model: Building,
        as: 'building',
        required: true,
        include: [{ model: Institute, as: 'institute' }],
      },
      { model: Equipment, as: 'equipment' },
    ],
    order: [['name', 'ASC']],
  });
  res.json({ rooms });
});

// =========================================================
// GET /api/structure/rooms/search
//
// Ricerca aule con filtri combinati. REGISTRATO PRIMA di /rooms/:id per
// evitare che ":id" matchi la stringa "search".
//
// Query params (tutti opzionali, AND logic):
//   - equipmentType: stringa CSV oppure parametro multi-valore (es.
//                    ?equipmentType=pianoforte&equipmentType=leggio).
//                    L'aula deve possedere TUTTI i tipi richiesti
//                    con quantity >= 1.
//   - minCapacity:   capacità minima posti (default 0)
//   - building:      id edificio
//   - type:          Room.type (studio | sala_prove | aula_concerti | ...)
//   - from / to:     ISO datetime; esclude aule con almeno 1 booking
//                    confermato sovrapposto al range.
//
// Sempre filtra: isBookable=true (le aule disabilitate non compaiono nei
// risultati di ricerca utente).
// =========================================================
router.get('/rooms/search', authenticate, async (req, res, next) => {
  try {
    // Parsing robusto del multi-valore equipmentType:
    //   ?equipmentType=a&equipmentType=b  → ['a', 'b']  (express default)
    //   ?equipmentType=a,b                → ['a', 'b']
    const rawEq = req.query.equipmentType;
    const equipmentTypes = (Array.isArray(rawEq) ? rawEq : rawEq ? String(rawEq).split(',') : [])
      .map((s) => String(s).trim())
      .filter(Boolean);

    const minCapacity = Math.max(0, Number(req.query.minCapacity) || 0);
    const buildingId = req.query.building ? Number(req.query.building) || null : null;
    const roomType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    if (from && Number.isNaN(from.getTime())) {
      return res.status(400).json({ error: 'from non valido', code: 'VALIDATION_FAILED' });
    }
    if (to && Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'to non valido', code: 'VALIDATION_FAILED' });
    }
    if (from && to && from.getTime() >= to.getTime()) {
      return res.status(400).json({ error: 'from deve precedere to', code: 'VALIDATION_FAILED' });
    }

    // 1) Base query sulle Room: filtri "esatti" che possono andare in WHERE
    const where = { isBookable: true };
    if (buildingId) where.buildingId = buildingId;
    if (roomType) where.type = roomType;
    if (minCapacity > 0) where.capacity = { [Op.gte]: minCapacity };

    // INNER JOIN su Building → esclude aule orfane di edificio soft-deleted
    // (vedi nota in GET /rooms).
    let rooms = await Room.findAll({
      where,
      include: [
        {
          model: Building,
          as: 'building',
          required: true,
          include: [{ model: Institute, as: 'institute' }],
        },
        { model: Equipment, as: 'equipment' },
      ],
      order: [['name', 'ASC']],
    });

    // 2) Filtro equipment richiesti (AND logic): l'aula deve avere TUTTI i
    //    type richiesti con quantity >= 1. Eseguito in JS per semplicità —
    //    inefficiente solo per N >> 1000 aule (qui largamente sufficiente).
    if (equipmentTypes.length > 0) {
      rooms = rooms.filter((room) => {
        const owned = new Set(
          (room.equipment || [])
            .filter((e) => (e.quantity ?? 0) >= 1 && e.isWorking !== false)
            .map((e) => e.type),
        );
        return equipmentTypes.every((req) => owned.has(req));
      });
    }

    // 3) Filtro disponibilità: scarta le aule con almeno 1 Booking confermato
    //    sovrapposto al range [from, to]. Una sola query bulk con WHERE roomId IN (...).
    if (from && to && rooms.length > 0) {
      const candidateIds = rooms.map((r) => r.id);
      const overlapping = await Booking.findAll({
        attributes: ['roomId'],
        where: {
          roomId: { [Op.in]: candidateIds },
          status: 'confirmed',
          // Overlap: !(end <= from || start >= to) ⇒ start < to AND end > from
          startTime: { [Op.lt]: to },
          endTime: { [Op.gt]: from },
        },
        raw: true,
      });
      const busyIds = new Set(overlapping.map((b) => b.roomId));
      rooms = rooms.filter((r) => !busyIds.has(r.id));
    }

    res.json({
      rooms,
      filters: {
        equipmentTypes,
        minCapacity,
        buildingId,
        type: roomType || null,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      total: rooms.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/rooms/:id', authenticate, async (req, res) => {
  const room = await Room.findByPk(req.params.id, {
    include: [
      { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
      { model: Equipment, as: 'equipment' },
    ],
  });
  if (!room) return res.status(404).json({ error: 'Aula non trovata' });
  res.json({ room });
});

router.post(
  '/rooms',
  authenticate,
  requireRole('admin'),
  [body('buildingId').isInt(), body('name').notEmpty().trim(), body('floor').notEmpty().trim()],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty())
        return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
      const room = await Room.create(pickAllowed(req.body, ROOM_ALLOWED));
      res.status(201).json({ room });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code, field: err.field });
      }
      next(err);
    }
  },
);

router.put('/rooms/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const r = await Room.findByPk(req.params.id);
    if (!r) return res.status(404).json({ error: 'Aula non trovata' });
    await r.update(pickAllowed(req.body, ROOM_ALLOWED));
    res.json({ room: r });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    }
    next(err);
  }
});

// =========================================================
// QR-code di check-in per aula
//
//   GET    /api/structure/rooms/:id/qr               PNG con URL+token
//   POST   /api/structure/rooms/:id/qr/regenerate    rigenera token
//   POST   /api/structure/rooms/qr/bulk-regenerate   bulk rigenera tutti
//   GET    /api/structure/rooms/qr-overview          lista aule + status QR
//
// L'admin può stampare il PNG e affiggerlo all'ingresso dell'aula. Lo studente,
// dopo aver inquadrato il QR, viene portato a `/check-in/room/:id?t=<token>`.
// Il token è validato lato server al momento del check-in (vedi
// routes/bookings.js POST /:id/checkin) — rigenerare il token invalida tutti
// i QR fisici stampati prima.
// =========================================================
const QRCode = require('qrcode');
const cryptoLib = require('crypto');

function generateQrToken() {
  // 16 byte → 32 char hex. Spazio ~3.4×10^38, collisione trascurabile.
  return cryptoLib.randomBytes(16).toString('hex');
}

async function ensureRoomQrToken(room) {
  if (room.qrToken && room.qrToken.length >= 16) return room.qrToken;
  const token = generateQrToken();
  room.qrToken = token;
  await room.save();
  return token;
}

function buildQrUrl(req, room) {
  const base =
    process.env.FRONTEND_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/check-in/room/${room.id}?t=${room.qrToken}`;
}

router.get('/rooms/:id/qr', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Aula non trovata', code: 'NOT_FOUND' });

    await ensureRoomQrToken(room);
    const url = buildQrUrl(req, room);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-room-${room.id}.png"`);
    // Stream PNG direttamente sulla response
    await QRCode.toFileStream(res, url, {
      type: 'png',
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (err) {
    next(err);
  }
});

// Lista aule con metadati QR per il pannello admin (no PNG, solo JSON).
// Espone anche lo stato effettivo del check-in risolto dalla cascata
// Room.requireCheckIn → Building.checkInDefault (vedi lib/checkInPolicy.js).
router.get('/rooms/qr-overview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rooms = await Room.findAll({
      attributes: ['id', 'name', 'code', 'requireCheckIn', 'qrToken', 'updatedAt'],
      include: [
        {
          association: 'building',
          attributes: ['id', 'name', 'checkInDefault'],
        },
      ],
      order: [
        [{ model: require('../models').Building, as: 'building' }, 'name', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    res.json({
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        building: r.building ? { id: r.building.id, name: r.building.name } : null,
        requireCheckIn: r.requireCheckIn,
        effectiveCheckIn: isCheckInRequired(r),
        inheritedFromBuilding: r.requireCheckIn === null || r.requireCheckIn === undefined,
        hasQrToken: !!r.qrToken,
        qrTokenUpdatedAt: r.qrToken ? r.updatedAt : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Rigenera il token QR di una singola aula → invalida i QR stampati prima.
router.post(
  '/rooms/:id/qr/regenerate',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const room = await Room.findByPk(req.params.id);
      if (!room) return res.status(404).json({ error: 'Aula non trovata', code: 'NOT_FOUND' });
      room.qrToken = generateQrToken();
      await room.save();
      res.json({
        ok: true,
        roomId: room.id,
        qrTokenUpdatedAt: room.updatedAt,
        url: buildQrUrl(req, room),
      });
    } catch (err) {
      next(err);
    }
  },
);

// Bulk regenerate: rigenera tutti i token in un colpo solo.
router.post(
  '/rooms/qr/bulk-regenerate',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const rooms = await Room.findAll({ attributes: ['id', 'qrToken'] });
      let updated = 0;
      for (const r of rooms) {
        r.qrToken = generateQrToken();
        await r.save();
        updated += 1;
      }
      res.json({ ok: true, updated });
    } catch (err) {
      next(err);
    }
  },
);

// Helper: rimuovi file foto precedente se gestito da noi (path /storage/…)
function tryDeleteOldRoomPhoto(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/storage/')) return;
  const file = path.basename(photoUrl);
  const fp = path.join(UPLOADS_DIR, file);
  fs.unlink(fp, () => {});
}

/**
 * Per ognuna delle aule passate (oggetti con .photoUrl), tenta di
 * cancellare il file fisico associato. Idempotente: errori ignorati.
 * Usato dai percorsi di DELETE/cascade per evitare file orfani in /uploads.
 */
function tryDeleteRoomPhotos(rooms) {
  if (!rooms?.length) return;
  for (const r of rooms) tryDeleteOldRoomPhoto(r.photoUrl);
}

// Upload foto aula (multipart/form-data, field "file")
// Le immagini vengono ridimensionate a 1200x675 (16:9) WEBP.
router.post(
  '/rooms/:id/photo',
  authenticate,
  requireRole('admin'),
  roomPhotoUpload.single('file'),
  async (req, res, next) => {
    try {
      const room = await Room.findByPk(req.params.id);
      if (!room) return res.status(404).json({ error: 'Aula non trovata', code: 'NOT_FOUND' });
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Nessun file caricato', code: 'VALIDATION_FAILED' });
      }

      // Ridimensiona + converte in WEBP. `rotate()` applica l'orientazione EXIF
      // così le foto da smartphone non risultano ruotate.
      const processed = await sharp(req.file.buffer)
        .rotate()
        .resize({
          width: ROOM_PHOTO_TARGET_WIDTH,
          height: ROOM_PHOTO_TARGET_HEIGHT,
          fit: 'cover',
          position: 'attention', // ritaglia mantenendo il punto più "interessante"
          withoutEnlargement: false,
        })
        .webp({ quality: 82 })
        .toBuffer();

      const filename = `room-${room.id}-${Date.now()}.webp`;
      const fp = path.join(UPLOADS_DIR, filename);
      await fs.promises.writeFile(fp, processed);

      tryDeleteOldRoomPhoto(room.photoUrl);
      const newUrl = `/storage/${filename}`;
      await room.update({ photoUrl: newUrl });

      res.json({ room, photoUrl: newUrl });
    } catch (err) {
      // Errori sharp (formato corrotto, ecc.)
      if (err && err.message && /sharp|input|unsupported/i.test(err.message)) {
        return res.status(400).json({
          error: 'Immagine non valida o formato non supportato',
          code: 'FILE_FORMAT_UNSUPPORTED',
        });
      }
      next(err);
    }
  },
);

// Rimuovi foto aula
router.delete('/rooms/:id/photo', authenticate, requireRole('admin'), async (req, res) => {
  const room = await Room.findByPk(req.params.id);
  if (!room) return res.status(404).json({ error: 'Aula non trovata', code: 'NOT_FOUND' });
  tryDeleteOldRoomPhoto(room.photoUrl);
  await room.update({ photoUrl: null });
  res.json({ room });
});

router.delete('/rooms/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const r = await Room.findByPk(req.params.id);
    if (!r) return res.status(404).json({ error: 'Aula non trovata' });
    const photoUrl = r.photoUrl;
    const result = await sequelize.transaction(async (t) => {
      const removedBookings = await Booking.destroy({
        where: { roomId: r.id },
        transaction: t,
      });
      await r.destroy({ transaction: t });
      return removedBookings;
    });
    tryDeleteOldRoomPhoto(photoUrl);
    res.json({ message: 'Aula eliminata', removedBookings: result });
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
    }
    next(err);
  }
});

// =========================================================
// ATTREZZATURE
// =========================================================

router.get('/equipment', authenticate, async (req, res) => {
  const where = {};
  if (req.query.roomId) where.roomId = req.query.roomId;
  const equipment = await Equipment.findAll({
    where,
    include: [{ model: Room, as: 'room' }],
    order: [['name', 'ASC']],
  });
  res.json({ equipment });
});

router.post(
  '/equipment',
  authenticate,
  requireRole('admin'),
  [body('roomId').isInt(), body('name').notEmpty().trim()],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty())
        return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
      const eq = await Equipment.create(pickAllowed(req.body, EQUIPMENT_ALLOWED));
      res.status(201).json({ equipment: eq });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code, field: err.field });
      }
      next(err);
    }
  },
);

router.put('/equipment/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const e = await Equipment.findByPk(req.params.id);
    if (!e) return res.status(404).json({ error: 'Attrezzatura non trovata' });
    await e.update(pickAllowed(req.body, EQUIPMENT_ALLOWED));
    res.json({ equipment: e });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    }
    next(err);
  }
});

router.delete('/equipment/:id', authenticate, requireRole('admin'), async (req, res) => {
  const e = await Equipment.findByPk(req.params.id);
  if (!e) return res.status(404).json({ error: 'Attrezzatura non trovata' });
  await e.destroy();
  res.json({ message: 'Attrezzatura eliminata' });
});

// =========================================================
// CATALOGO DOTAZIONI (EquipmentTemplate)
// Lista riusabile di nomi di dotazioni che pre-compilano il
// modulo Equipment quando si configura una stanza.
// =========================================================

// Lista (autenticati: tutti)
router.get('/equipment-templates', authenticate, async (req, res) => {
  const items = await EquipmentTemplate.findAll({ order: [['name', 'ASC']] });
  res.json({ templates: items });
});

// Bulk delete (admin) — registrato PRIMA di /:id
router.post(
  '/equipment-templates/bulk-delete',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
      const deleted = await EquipmentTemplate.destroy({ where: { id: { [Op.in]: ids } } });
      res.json({ deleted });
    } catch (err) {
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(409).json({ error: 'Eliminazione bloccata da vincoli di integrità.' });
      }
      next(err);
    }
  },
);

// Export CSV (admin) — singola colonna "Dotazione" — round-trip safe con import.
router.get(
  '/equipment-templates/export.csv',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const templates = await EquipmentTemplate.findAll({ order: [['name', 'ASC']] });
      const rows = [['Dotazione'], ...templates.map((t) => [t.name])];
      const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="dotazioni-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send('﻿' + csv);
    } catch (err) {
      next(err);
    }
  },
);

// Import CSV (admin) — singola colonna "Dotazione" (o "Nome"); ogni riga = un nome.
router.post('/equipment-templates/import', authenticate, requireRole('admin'), async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) return res.status(400).json({ error: 'Body "csv" mancante' });

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Salta header se assomiglia a una intestazione
  let startIdx = 0;
  if (lines.length > 0) {
    const first = lines[0].toLowerCase().replace(/^"|"$/g, '');
    if (['dotazione', 'dotazioni', 'nome', 'name', 'attrezzatura'].includes(first)) {
      startIdx = 1;
    }
  }

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    const name = raw.replace(/^"|"$/g, '').trim();
    if (!name) {
      errors.push({ row: i + 1, message: 'Riga vuota' });
      continue;
    }
    try {
      const existing = await EquipmentTemplate.findOne({ where: { name } });
      if (existing) {
        skipped += 1;
      } else {
        await EquipmentTemplate.create({ name });
        created += 1;
      }
    } catch (err) {
      errors.push({ row: i + 1, message: err.message || 'Errore' });
    }
  }

  res.json({
    result: {
      rowsTotal: lines.length - startIdx,
      created,
      skipped,
      errors,
    },
  });
});

router.post(
  '/equipment-templates',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty().trim()],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });
    try {
      const tpl = await EquipmentTemplate.create({
        name: req.body.name.trim(),
        type: req.body.type || 'altro',
      });
      res.status(201).json({ template: tpl });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Dotazione già esistente' });
      }
      res.status(500).json({ error: 'Errore creazione dotazione' });
    }
  },
);

router.put('/equipment-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  const tpl = await EquipmentTemplate.findByPk(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Dotazione non trovata' });
  await tpl.update({
    name: typeof req.body.name === 'string' ? req.body.name.trim() : tpl.name,
    type: req.body.type || tpl.type,
  });
  res.json({ template: tpl });
});

router.delete('/equipment-templates/:id', authenticate, requireRole('admin'), async (req, res) => {
  const tpl = await EquipmentTemplate.findByPk(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Dotazione non trovata' });
  await tpl.destroy();
  res.json({ message: 'Dotazione eliminata' });
});

module.exports = router;
