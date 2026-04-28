'use strict';

/**
 * Monte Ore — REST endpoints per docenti e coordinatori.
 *
 * Docenti (`role=docente`):
 *   GET    /api/monte-ore/me                  → la mia proposta dell'AA corrente (auto-create draft)
 *   PUT    /api/monte-ore/me                  → aggiorna note/anno/range della propria proposta in draft
 *   POST   /api/monte-ore/me/schedules        → aggiunge una riga schedule
 *   PATCH  /api/monte-ore/me/schedules/:id    → modifica una riga schedule (solo se draft/rejected)
 *   DELETE /api/monte-ore/me/schedules/:id    → elimina una riga schedule (solo se draft/rejected)
 *   POST   /api/monte-ore/me/submit           → invia la proposta al coordinatore (draft → submitted)
 *
 * Admin/Coordinatore (`role=admin`):
 *   GET    /api/admin/monte-ore               → lista proposte (filtri status/year/userId)
 *   GET    /api/admin/monte-ore/:id           → dettaglio (con schedules + user)
 *   PATCH  /api/admin/monte-ore/:id/schedules/:sid  → modifica una riga (anche se submitted)
 *   POST   /api/admin/monte-ore/:id/approve   → approva (submitted → approved)
 *   POST   /api/admin/monte-ore/:id/reject    → rifiuta (submitted → rejected, body: {reason})
 *   POST   /api/admin/monte-ore/:id/generate  → genera prenotazioni (approved → generated)
 *   POST   /api/admin/monte-ore/:id/unlock    → riporta a 'approved' cancellando i booking generati
 */

const express = require('express');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const {
  MonteOreProposal,
  MonteOreSchedule,
  User,
  Room,
  Building,
  MonteOreSettings,
  MonteOreSuspension,
  MonteOreSlot,
  MonteOreAmendment,
  Institute,
} = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const monteOreService = require('../services/monteOreService');
const slotService = require('../services/monteOreSlotService');
const calendarService = require('../services/monteOreCalendarService');

const router = express.Router();

// ============================================================
// Helpers
// ============================================================

// Convenzione AA conservatorio: 1 nov → 31 ott. Helper in calendarService.
const currentAcademicYearLabel = calendarService.currentAcademicYear;

function defaultRangeForYear(label) {
  // Allineato a `defaultRangeForAcademicYear` ma con shape compatibile col
  // vecchio modello (validFrom/validTo). 1 nov → 31 ott.
  const r = calendarService.defaultRangeForAcademicYear(label);
  return { validFrom: r.lessonsStartDate, validTo: r.lessonsEndDate };
}

async function isWithinSubmissionWindow(academicYear) {
  const settings = await MonteOreSettings.findOne({ where: { academicYear } });
  if (!settings) return true; // se non configurato, consenti (modalità dev)
  const now = dayjs().format('YYYY-MM-DD');
  return now >= settings.submissionWindowStart && now <= settings.submissionWindowEnd;
}

// Normalizza il payload schedule prima di create/update
function sanitizeSchedule(body) {
  const out = {};
  if (body.roomId !== undefined) out.roomId = body.roomId === null ? null : Number(body.roomId);
  if (body.dayOfWeek !== undefined) out.dayOfWeek = Number(body.dayOfWeek);
  if (body.startTime !== undefined) out.startTime = String(body.startTime).slice(0, 5);
  if (body.endTime !== undefined) out.endTime = String(body.endTime).slice(0, 5);
  if (body.bookingType !== undefined) out.bookingType = String(body.bookingType);
  if (body.purpose !== undefined)
    out.purpose = body.purpose ? String(body.purpose).slice(0, 255) : null;
  if (body.notes !== undefined) out.notes = body.notes || null;
  if (body.excludeDates !== undefined) {
    out.excludeDates = Array.isArray(body.excludeDates)
      ? body.excludeDates.map((d) => String(d).slice(0, 10))
      : [];
  }
  return out;
}

function serializeProposal(p) {
  return {
    ...p.toJSON(),
    schedules: (p.schedules || []).map((s) => s.toJSON()),
  };
}

// ============================================================
// DOCENTE — endpoints "miei"
// ============================================================

router.get('/me', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const range = defaultRangeForYear(year);
    const [proposal] = await MonteOreProposal.findOrCreate({
      where: { userId: req.user.id, academicYear: year },
      defaults: {
        userId: req.user.id,
        academicYear: year,
        validFrom: range.validFrom,
        validTo: range.validTo,
        status: 'draft',
      },
      include: [
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
      ],
    });
    // Se la findOrCreate ha trovato senza include (caso "find existing"),
    // ricarichiamo per avere le schedules popolate
    const full = await MonteOreProposal.findByPk(proposal.id, {
      include: [
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
      ],
      order: [
        [{ model: MonteOreSchedule, as: 'schedules' }, 'dayOfWeek', 'ASC'],
        [{ model: MonteOreSchedule, as: 'schedules' }, 'startTime', 'ASC'],
      ],
    });
    res.json({ proposal: serializeProposal(full) });
  } catch (err) {
    next(err);
  }
});

router.put('/me', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.body.academicYear || currentAcademicYearLabel();
    const proposal = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
    });
    if (!proposal)
      return res.status(404).json({ error: 'Proposta non trovata', code: 'NOT_FOUND' });
    if (!['draft', 'rejected'].includes(proposal.status)) {
      return res
        .status(400)
        .json({ error: 'Proposta non modificabile in questo stato', code: 'INVALID_STATE' });
    }
    const updates = {};
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.totalHoursRequested !== undefined)
      updates.totalHoursRequested = Number(req.body.totalHoursRequested) || 0;
    if (req.body.validFrom) updates.validFrom = req.body.validFrom;
    if (req.body.validTo) updates.validTo = req.body.validTo;
    // Se stava in 'rejected' e l'utente sta editando, riportiamo a 'draft'
    if (proposal.status === 'rejected') {
      updates.status = 'draft';
      updates.rejectedAt = null;
      updates.rejectionReason = null;
    }
    await proposal.update(updates);
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    next(err);
  }
});

async function findOwnProposalEditable(userId) {
  const year = currentAcademicYearLabel();
  const proposal = await MonteOreProposal.findOne({
    where: { userId, academicYear: year },
  });
  if (!proposal) {
    const e = new Error("Nessuna proposta per l'anno corrente");
    e.status = 404;
    throw e;
  }
  if (!['draft', 'rejected'].includes(proposal.status)) {
    const e = new Error('Proposta non modificabile (stato: ' + proposal.status + ')');
    e.status = 400;
    e.code = 'INVALID_STATE';
    throw e;
  }
  return proposal;
}

router.post('/me/schedules', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await findOwnProposalEditable(req.user.id);
    const data = sanitizeSchedule(req.body);
    // Defaults sensati
    if (!data.bookingType) data.bookingType = 'lezione';
    if (data.dayOfWeek === undefined || !data.startTime || !data.endTime) {
      return res.status(400).json({
        error: 'dayOfWeek, startTime, endTime sono obbligatori',
        code: 'VALIDATION_FAILED',
      });
    }
    const sched = await MonteOreSchedule.create({ proposalId: proposal.id, ...data });
    // Riporta a draft se stava in rejected
    if (proposal.status === 'rejected') {
      await proposal.update({ status: 'draft', rejectedAt: null, rejectionReason: null });
    }
    res.status(201).json({ schedule: sched.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.patch('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await findOwnProposalEditable(req.user.id);
    const sched = await MonteOreSchedule.findOne({
      where: { id: req.params.id, proposalId: proposal.id },
    });
    if (!sched) return res.status(404).json({ error: 'Riga non trovata', code: 'NOT_FOUND' });
    await sched.update(sanitizeSchedule(req.body));
    res.json({ schedule: sched.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.delete('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await findOwnProposalEditable(req.user.id);
    const sched = await MonteOreSchedule.findOne({
      where: { id: req.params.id, proposalId: proposal.id },
    });
    if (!sched) return res.status(404).json({ error: 'Riga non trovata', code: 'NOT_FOUND' });
    await sched.destroy();
    res.json({ message: 'Riga eliminata' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.post('/me/submit', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.body.academicYear || currentAcademicYearLabel();
    // Validazione finestra di inserimento (configurabile da admin)
    if (!(await isWithinSubmissionWindow(year))) {
      return res.status(400).json({
        error: 'Sei fuori dalla finestra di inserimento del monte ore',
        code: 'OUTSIDE_SUBMISSION_WINDOW',
      });
    }
    const proposal = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
      include: [
        { model: MonteOreSchedule, as: 'schedules' },
        { model: MonteOreSlot, as: 'slots' },
      ],
    });
    if (!proposal)
      return res.status(404).json({ error: 'Proposta non trovata', code: 'NOT_FOUND' });
    if (!['draft', 'rejected'].includes(proposal.status)) {
      return res.status(400).json({
        error: 'Solo proposte in draft/rejected possono essere inviate',
        code: 'INVALID_STATE',
      });
    }
    if (!proposal.schedules || proposal.schedules.length === 0) {
      return res
        .status(400)
        .json({ error: 'Imposta il pattern settimanale prima di inviare', code: 'EMPTY_PATTERN' });
    }
    const distinctDays = new Set(proposal.schedules.map((s) => s.dayOfWeek));
    // Le validazioni "nuova spec" (2-4 giorni + 324h) si applicano solo
    // quando l'admin ha configurato MonteOreSettings per l'AA. In assenza
    // di settings il sistema opera in modalità legacy (pattern-only).
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    let totalHours = 0;
    let minRequired = null;
    if (settings) {
      if (distinctDays.size < 2 || distinctDays.size > 4) {
        return res.status(400).json({
          error: `Il monte ore richiede da 2 a 4 giorni lavorativi a settimana (impostati: ${distinctDays.size})`,
          code: 'WORKING_DAYS_OUT_OF_RANGE',
        });
      }
      minRequired = settings.minRequiredHours ?? 324;
      totalHours = await slotService.recomputeTotals(proposal.id);
      if (totalHours < minRequired) {
        return res.status(400).json({
          error: `Il monte ore deve essere almeno di ${minRequired} ore (attuali: ${totalHours.toFixed(1)} h)`,
          code: 'HOURS_BELOW_THRESHOLD',
        });
      }
    }
    const updates = {
      status: 'submitted',
      submittedAt: new Date(),
    };
    if (settings) {
      // workingDaysCount ha validator min:2 max:5 sul model, quindi lo
      // valorizziamo solo nel nuovo flusso (dove distinctDays è stato
      // validato 2-4 sopra).
      updates.workingDaysCount = distinctDays.size;
      updates.totalHoursRequested = totalHours;
      updates.minRequiredHoursSnapshot = minRequired;
    }
    await proposal.update(updates);
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DOCENTE — calendario griglia + slot toggle + amendments
// ============================================================

/**
 * Restituisce la griglia delle settimane (Lun-Ven) filtrata da
 * lessonsStart/End e dalle suspensions admin. Usata per renderizzare
 * la sezione B della pagina docente.
 */
router.get('/me/calendar', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    if (!settings) {
      return res.status(404).json({
        error: 'Configurazione monte ore non disponibile per questo AA',
        code: 'SETTINGS_NOT_FOUND',
      });
    }
    const suspensions = await MonteOreSuspension.findAll({
      where: { academicYear: year, instituteId: settings.instituteId },
    });
    const weeks = calendarService.computeWeeks(settings, suspensions);
    res.json({ settings: settings.toJSON(), weeks });
  } catch (err) {
    if (err.message?.startsWith('Settings monte ore mancanti')) {
      return res.status(400).json({ error: err.message, code: 'SETTINGS_INCOMPLETE' });
    }
    next(err);
  }
});

/**
 * Rigenera gli slot a partire dal pattern corrente. Da chiamare quando
 * il docente conferma il pattern in Sezione A (e ogni volta che modifica
 * le righe schedule).
 */
router.post('/me/regenerate-slots', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await findOwnProposalEditable(req.user.id);
    const result = await slotService.regenerateSlotsFromPattern(proposal.id);
    res.json({ result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * Lista degli slot della propria proposta (per renderizzare la griglia).
 */
router.get('/me/slots', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const proposal = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
    });
    if (!proposal) return res.json({ slots: [] });
    const slots = await MonteOreSlot.findAll({
      where: { proposalId: proposal.id },
      order: [
        ['date', 'ASC'],
        ['startTime', 'ASC'],
      ],
    });
    res.json({ slots: slots.map((s) => s.toJSON()) });
  } catch (err) {
    next(err);
  }
});

/**
 * Toggle attiva/disattiva singola cella della griglia. Per proposte
 * draft/rejected agisce direttamente; per approved/generated crea un
 * `MonteOreAmendment` (auto-approvato o pending a seconda della logica).
 */
router.post('/me/slots/:id/toggle', authenticate, requireApproved, async (req, res, next) => {
  try {
    const slot = await MonteOreSlot.findByPk(req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot non trovato' });
    const proposal = await MonteOreProposal.findByPk(slot.proposalId);
    if (!proposal || proposal.userId !== req.user.id) {
      return res.status(403).json({ error: 'Non autorizzato' });
    }
    if (proposal.status === 'submitted') {
      return res.status(400).json({
        error: 'La proposta è in attesa di approvazione e non può essere modificata',
        code: 'INVALID_STATE',
      });
    }
    // Stati editabili direttamente
    if (['draft', 'rejected'].includes(proposal.status)) {
      const updated = await slotService.toggleSlot(slot.id);
      return res.json({ slot: updated.toJSON() });
    }
    // Stati che richiedono amendment workflow
    if (['approved', 'generated'].includes(proposal.status)) {
      // Verifica limite annuale
      const settings = await MonteOreSettings.findOne({
        where: { academicYear: proposal.academicYear },
      });
      const maxAmend = settings?.maxAmendmentsPerYear ?? 3;
      if (proposal.amendmentCount >= maxAmend) {
        return res.status(400).json({
          error: `Hai raggiunto il limite di ${maxAmend} richieste di variazione per l'anno`,
          code: 'AMENDMENT_LIMIT_REACHED',
        });
      }
      const kind = slot.isActive ? 'toggle_off' : 'toggle_on';
      const decided = slotService.classifyAmendment(slot, kind);
      const amendment = await MonteOreAmendment.create({
        proposalId: proposal.id,
        requesterId: req.user.id,
        slotId: slot.id,
        kind,
        payload: { from: slot.isActive, to: !slot.isActive },
        status: decided,
        requestNotes: req.body.notes ?? null,
        decidedAt: decided === 'auto_approved' ? new Date() : null,
      });
      // Auto-approve: applica subito + se generated cancella/ricrea booking
      if (decided === 'auto_approved') {
        await slotService.toggleSlot(slot.id, { force: true });
        await proposal.update({ amendmentCount: proposal.amendmentCount + 1 });
      }
      return res
        .status(201)
        .json({ amendment: amendment.toJSON(), slot: (await slot.reload()).toJSON() });
    }
    return res.status(400).json({ error: 'Stato non gestito' });
  } catch (err) {
    if (err.code === 'SLOT_LOCKED')
      return res.status(400).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * Elenco amendments della propria proposta (per visibilità docente).
 */
router.get('/me/amendments', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const proposal = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
    });
    if (!proposal) return res.json({ amendments: [] });
    const amendments = await MonteOreAmendment.findAll({
      where: { proposalId: proposal.id },
      order: [['createdAt', 'DESC']],
    });
    res.json({ amendments: amendments.map((a) => a.toJSON()) });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ADMIN — endpoints di gestione
// ============================================================

const adminRouter = express.Router();

// Helpers settings — devono essere disponibili PRIMA delle route che li usano,
// dato che le route /settings* e /suspensions sono dichiarate sopra a /:id.

function sanitizeSettings(body) {
  const out = {};
  const dateFields = [
    'academicYearStart',
    'academicYearEnd',
    'lessonsStartDate',
    'lessonsEndDate',
    'submissionWindowStart',
    'submissionWindowEnd',
  ];
  for (const f of dateFields) {
    if (body[f] !== undefined) out[f] = body[f] ? String(body[f]).slice(0, 10) : null;
  }
  if (body.minRequiredHours !== undefined) out.minRequiredHours = Number(body.minRequiredHours);
  if (body.maxAmendmentsPerYear !== undefined)
    out.maxAmendmentsPerYear = Number(body.maxAmendmentsPerYear);
  return out;
}

async function resolveDefaultInstituteId() {
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) {
    const e = new Error('Nessun istituto configurato');
    e.status = 400;
    throw e;
  }
  return inst.id;
}

function sanitizeSuspension(body) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).slice(0, 120);
  if (body.dateFrom !== undefined) out.dateFrom = String(body.dateFrom).slice(0, 10);
  if (body.dateTo !== undefined) out.dateTo = String(body.dateTo).slice(0, 10);
  if (body.kind !== undefined) {
    out.kind = ['full_week', 'partial'].includes(body.kind) ? body.kind : 'partial';
  }
  if (body.notes !== undefined) out.notes = body.notes || null;
  return out;
}

// IMPORTANTE: le route concrete (/settings, /suspensions, /amendments) DEVONO
// stare PRIMA delle route param /:id, altrimenti Express matcha "settings"
// come parametro :id e ritorna 404 dal handler proposta.

// ---- Settings ----
adminRouter.get('/settings/list', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.academicYear) where.academicYear = req.query.academicYear;
    const items = await MonteOreSettings.findAll({ where, order: [['academicYear', 'DESC']] });
    res.json({ settings: items.map((s) => s.toJSON()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const year = req.query.academicYear || calendarService.currentAcademicYear();
    let settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    if (!settings) {
      const instituteId = await resolveDefaultInstituteId();
      const def = calendarService.defaultRangeForAcademicYear(year);
      settings = await MonteOreSettings.create({
        instituteId,
        academicYear: year,
        ...def,
        minRequiredHours: 324,
        maxAmendmentsPerYear: 3,
      });
    }
    res.json({ settings: settings.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

adminRouter.put('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const year = req.body.academicYear || calendarService.currentAcademicYear();
    let settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    if (!settings) {
      const instituteId = await resolveDefaultInstituteId();
      const def = calendarService.defaultRangeForAcademicYear(year);
      settings = await MonteOreSettings.create({
        instituteId,
        academicYear: year,
        ...def,
        minRequiredHours: 324,
        maxAmendmentsPerYear: 3,
      });
    }
    await settings.update(sanitizeSettings(req.body));
    res.json({ settings: settings.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ---- Suspensions ----
adminRouter.get('/suspensions', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const year = req.query.academicYear || calendarService.currentAcademicYear();
    const items = await MonteOreSuspension.findAll({
      where: { academicYear: year },
      order: [['dateFrom', 'ASC']],
    });
    res.json({ suspensions: items.map((s) => s.toJSON()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/suspensions', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const year = req.body.academicYear || calendarService.currentAcademicYear();
    const data = sanitizeSuspension(req.body);
    if (!data.name || !data.dateFrom || !data.dateTo) {
      return res
        .status(400)
        .json({ error: 'name, dateFrom, dateTo sono obbligatori', code: 'VALIDATION_FAILED' });
    }
    let instituteId;
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    if (settings) instituteId = settings.instituteId;
    else instituteId = await resolveDefaultInstituteId();
    const susp = await MonteOreSuspension.create({
      instituteId,
      academicYear: year,
      ...data,
    });
    res.status(201).json({ suspension: susp.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

adminRouter.patch(
  '/suspensions/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const susp = await MonteOreSuspension.findByPk(req.params.id);
      if (!susp) return res.status(404).json({ error: 'Sospensione non trovata' });
      await susp.update(sanitizeSuspension(req.body));
      res.json({ suspension: susp.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.delete(
  '/suspensions/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const susp = await MonteOreSuspension.findByPk(req.params.id);
      if (!susp) return res.status(404).json({ error: 'Sospensione non trovata' });
      await susp.destroy();
      res.json({ message: 'Sospensione eliminata' });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Amendments — vista globale (deve stare prima di /:id) ----
adminRouter.get('/amendments', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.proposalId) where.proposalId = Number(req.query.proposalId);
    const items = await MonteOreAmendment.findAll({
      where,
      include: [
        { model: User, as: 'requester', attributes: ['id', 'firstName', 'lastName', 'email'] },
        {
          model: MonteOreProposal,
          as: 'proposal',
          attributes: ['id', 'academicYear', 'userId', 'status'],
        },
        { model: MonteOreSlot, as: 'slot' },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json({ amendments: items.map((a) => a.toJSON()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.academicYear) where.academicYear = req.query.academicYear;
    if (req.query.userId) where.userId = Number(req.query.userId);
    const proposals = await MonteOreProposal.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola', 'courseId'],
        },
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
      ],
      order: [['updatedAt', 'DESC']],
    });
    res.json({ proposals: proposals.map(serializeProposal) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola', 'courseId'],
        },
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
        { model: User, as: 'approver', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        [{ model: MonteOreSchedule, as: 'schedules' }, 'dayOfWeek', 'ASC'],
        [{ model: MonteOreSchedule, as: 'schedules' }, 'startTime', 'ASC'],
      ],
    });
    if (!proposal)
      return res.status(404).json({ error: 'Proposta non trovata', code: 'NOT_FOUND' });
    res.json({ proposal: serializeProposal(proposal) });
  } catch (err) {
    next(err);
  }
});

// L'admin può modificare le righe schedule sia in submitted che in approved
// (NON in generated: per modificare deve prima fare unlock).
adminRouter.patch(
  '/:id/schedules/:sid',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      if (proposal.status === 'generated') {
        return res.status(400).json({
          error: 'Esegui prima "Annulla generazione" per modificare le righe',
          code: 'INVALID_STATE',
        });
      }
      const sched = await MonteOreSchedule.findOne({
        where: { id: req.params.sid, proposalId: proposal.id },
      });
      if (!sched) return res.status(404).json({ error: 'Riga non trovata' });
      await sched.update(sanitizeSchedule(req.body));
      res.json({ schedule: sched.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

// L'admin può anche creare/eliminare righe (utile per consolidare la proposta)
adminRouter.post('/:id/schedules', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findByPk(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    if (proposal.status === 'generated') {
      return res
        .status(400)
        .json({ error: 'Esegui prima "Annulla generazione"', code: 'INVALID_STATE' });
    }
    const data = sanitizeSchedule(req.body);
    if (!data.bookingType) data.bookingType = 'lezione';
    if (data.dayOfWeek === undefined || !data.startTime || !data.endTime) {
      return res.status(400).json({ error: 'dayOfWeek, startTime, endTime sono obbligatori' });
    }
    const sched = await MonteOreSchedule.create({ proposalId: proposal.id, ...data });
    res.status(201).json({ schedule: sched.toJSON() });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete(
  '/:id/schedules/:sid',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      if (proposal.status === 'generated') {
        return res
          .status(400)
          .json({ error: 'Esegui prima "Annulla generazione"', code: 'INVALID_STATE' });
      }
      const sched = await MonteOreSchedule.findOne({
        where: { id: req.params.sid, proposalId: proposal.id },
      });
      if (!sched) return res.status(404).json({ error: 'Riga non trovata' });
      await sched.destroy();
      res.json({ message: 'Riga eliminata' });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findByPk(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    if (!['submitted', 'rejected'].includes(proposal.status)) {
      return res
        .status(400)
        .json({ error: 'Solo submitted/rejected possono essere approvate', code: 'INVALID_STATE' });
    }
    await proposal.update({
      status: 'approved',
      approvedAt: new Date(),
      approverId: req.user.id,
      rejectedAt: null,
      rejectionReason: null,
      coordinatorNotes: req.body.notes ?? proposal.coordinatorNotes,
    });
    // Congela isActive → originalActive: serve a classifyAmendment per
    // distinguere modifiche su giorni "già nel piano" (auto-approve) da
    // riattivazione/aggiunta di giorni nuovi (pending).
    await slotService.snapshotOriginalActive(proposal.id);
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findByPk(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    if (proposal.status !== 'submitted') {
      return res
        .status(400)
        .json({ error: 'Solo submitted può essere rifiutata', code: 'INVALID_STATE' });
    }
    const reason = req.body.reason ? String(req.body.reason).slice(0, 1024) : null;
    await proposal.update({
      status: 'rejected',
      rejectedAt: new Date(),
      approverId: req.user.id,
      rejectionReason: reason,
    });
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/:id/generate', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await monteOreService.generateBookingsForProposal(Number(req.params.id), {
      actorUser: req.user,
    });
    // Reload proposta aggiornata per la risposta
    const fresh = await MonteOreProposal.findByPk(req.params.id);
    res.status(201).json({ result, proposal: fresh.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

adminRouter.post('/:id/unlock', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findByPk(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    if (proposal.status !== 'generated') {
      return res
        .status(400)
        .json({ error: 'Solo generated può essere unlocked', code: 'INVALID_STATE' });
    }
    const cleared = await monteOreService.clearGeneratedBookings(Number(req.params.id));
    await proposal.update({ status: 'approved', generatedAt: null, generationSummary: null });
    res.json({ proposal: proposal.toJSON(), cleared });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ADMIN — amendments per proposta + decisione admin
// ============================================================

adminRouter.get('/:id/amendments', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const items = await MonteOreAmendment.findAll({
      where: { proposalId: Number(req.params.id) },
      include: [
        { model: User, as: 'requester', attributes: ['id', 'firstName', 'lastName'] },
        { model: MonteOreSlot, as: 'slot' },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json({ amendments: items.map((a) => a.toJSON()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post(
  '/:id/amendments/:aid/approve',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      const amendment = await MonteOreAmendment.findOne({
        where: { id: req.params.aid, proposalId: proposal.id },
      });
      if (!amendment) return res.status(404).json({ error: 'Variazione non trovata' });
      if (amendment.status !== 'pending') {
        return res.status(400).json({ error: 'Variazione già decisa', code: 'INVALID_STATE' });
      }
      // Applica la modifica allo slot bersaglio
      if (amendment.slotId) {
        const slot = await MonteOreSlot.findByPk(amendment.slotId);
        if (slot) {
          if (amendment.kind === 'toggle_off' || amendment.kind === 'toggle_on') {
            await slot.update({ isActive: amendment.kind === 'toggle_on' });
          } else if (amendment.kind === 'change_time' && amendment.payload) {
            const upd = {};
            if (amendment.payload.startTime)
              upd.startTime = String(amendment.payload.startTime).slice(0, 5);
            if (amendment.payload.endTime)
              upd.endTime = String(amendment.payload.endTime).slice(0, 5);
            await slot.update(upd);
          }
        }
      }
      await amendment.update({
        status: 'approved',
        decidedAt: new Date(),
        decidedBy: req.user.id,
      });
      await slotService.recomputeTotals(proposal.id);
      await proposal.update({ amendmentCount: (proposal.amendmentCount || 0) + 1 });
      res.json({ amendment: amendment.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/:id/amendments/:aid/reject',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      const amendment = await MonteOreAmendment.findOne({
        where: { id: req.params.aid, proposalId: proposal.id },
      });
      if (!amendment) return res.status(404).json({ error: 'Variazione non trovata' });
      if (amendment.status !== 'pending') {
        return res.status(400).json({ error: 'Variazione già decisa', code: 'INVALID_STATE' });
      }
      const reason = req.body.reason ? String(req.body.reason).slice(0, 1024) : null;
      await amendment.update({
        status: 'rejected',
        rejectionReason: reason,
        decidedAt: new Date(),
        decidedBy: req.user.id,
      });
      res.json({ amendment: amendment.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = { router, adminRouter };
