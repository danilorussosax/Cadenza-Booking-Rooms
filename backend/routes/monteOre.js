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
const multer = require('multer');
const { Op } = require('sequelize');
const {
  sequelize,
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
  BookingRuleException,
} = require('../models');
const { authenticate, requireRole, requireApproved } = require('../middleware/auth');
const monteOreService = require('../services/monteOreService');
const workflow = require('../services/monteOreWorkflowService');
const { updateCalendar } = require('../services/monteOreCalendarUpdateService');
const { randomUUID } = require('crypto');
const slotService = require('../services/monteOreSlotService');
const calendarService = require('../services/monteOreCalendarService');
const { resolveAnnualThreshold } = require('../services/monteOreThresholdService');
const { validateDailyConstraints } = require('../services/monteOreDailyValidator');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');

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

async function isWithinSubmissionWindow(academicYear, user = null) {
  const settings = await MonteOreSettings.findOne({ where: { academicYear } });
  if (!settings) return true; // se non configurato, consenti (modalità dev)
  const now = dayjs().format('YYYY-MM-DD');
  if (now >= settings.submissionWindowStart && now <= settings.submissionWindowEnd) {
    return true;
  }
  // Deroga individuale (Fase 6.1): un docente subentrato in corso d'anno
  // può avere `monteOreSubmissionAllowedUntil` valorizzato dalla Direzione,
  // che lo abilita a inviare/modificare la propria proposta anche fuori
  // dalla finestra globale, fino a quella data inclusa.
  if (user && user.monteOreSubmissionAllowedUntil) {
    const until = String(user.monteOreSubmissionAllowedUntil).slice(0, 10);
    if (now <= until) return true;
  }
  return false;
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

async function serializeAmendments(items) {
  const { MailOutbox } = require('../models');
  const rows = await MailOutbox.findAll({
    where: { idempotencyKey: items.map((a) => `monte-ore:${a.id}:decision`) },
    attributes: ['idempotencyKey', 'status'],
  });
  const mail = new Map(rows.map((r) => [r.idempotencyKey, r.status]));
  return items.map((a) => ({
    ...a.toJSON(),
    emailStatus: mail.get(`monte-ore:${a.id}:decision`) || null,
  }));
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

/**
 * GET /api/monte-ore/me/threshold — risolve la soglia ore applicabile
 * all'utente corrente per l'AA passato (o quello in corso).
 * Restituisce { minHours, bypassDayConstraint, source, contractType, reason }.
 * Usato dal banner docente quando ha un override personalizzato.
 */
router.get('/me/threshold', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const resolved = await resolveAnnualThreshold(req.user.id, year);
    // Esponi anche i vincoli giornalieri istituzionali (Z2/Z3) per consentire
    // al frontend di mostrare warning inline durante l'editing del pattern.
    const settings = await MonteOreSettings.findOne({
      where: { academicYear: year },
      attributes: ['maxHoursPerDay', 'dailyBreakAfterHours', 'dailyBreakMinutes'],
    });
    res.json({
      academicYear: year,
      ...resolved,
      dailyConstraints: {
        maxHoursPerDay: settings?.maxHoursPerDay ?? null,
        dailyBreakAfterHours: settings?.dailyBreakAfterHours ?? null,
        dailyBreakMinutes: settings?.dailyBreakMinutes ?? null,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.get('/me', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.query.year || currentAcademicYearLabel();
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    const range = settings
      ? { validFrom: settings.lessonsStartDate, validTo: settings.lessonsEndDate }
      : defaultRangeForYear(year);
    const existing = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
    });
    const proposal =
      existing ||
      (
        await MonteOreProposal.findCreateFind({
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
              include: [
                { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
              ],
            },
          ],
        })
      )[0];
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
    const proposal = await workflow.transact(async (transaction) => {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || currentAcademicYearLabel(),
        transaction,
      );
      const updates = {};
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.validFrom) updates.validFrom = req.body.validFrom;
      if (req.body.validTo) updates.validTo = req.body.validTo;
      const from = updates.validFrom || proposal.validFrom;
      const to = updates.validTo || proposal.validTo;
      if (from > to || !dayjs(from).isValid() || !dayjs(to).isValid())
        workflow.fail('Periodo non valido');
      if (proposal.status === 'rejected')
        Object.assign(updates, { status: 'draft', rejectedAt: null, rejectionReason: null });
      await proposal.update(updates, { transaction });
      return proposal;
    });
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    next(err);
  }
});

async function findOwnProposalEditable(
  userId,
  year = currentAcademicYearLabel(),
  transaction = null,
) {
  const proposal = await MonteOreProposal.findOne({
    where: { userId, academicYear: year },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!proposal) {
    const e = new Error("Nessuna proposta per l'anno corrente");
    e.status = 404;
    e.code = 'NOT_FOUND';
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
    const schedule = await workflow.transact(async (transaction) => {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || req.query.year || currentAcademicYearLabel(),
        transaction,
      );
      const data = sanitizeSchedule(req.body);
      if (!data.bookingType) data.bookingType = 'lezione';
      if (data.dayOfWeek === undefined || !data.startTime || !data.endTime)
        workflow.fail('dayOfWeek, startTime, endTime sono obbligatori');
      const schedule = await MonteOreSchedule.create(
        { proposalId: proposal.id, ...data },
        { transaction },
      );
      if (proposal.status === 'rejected')
        await proposal.update(
          { status: 'draft', rejectedAt: null, rejectionReason: null },
          { transaction },
        );
      return schedule;
    });
    res.status(201).json({ schedule: schedule.toJSON() });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
  try {
    const schedule = await workflow.transact(async (transaction) => {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || req.query.year || currentAcademicYearLabel(),
        transaction,
      );
      const schedule = await MonteOreSchedule.findOne({
        where: { id: req.params.id, proposalId: proposal.id },
        transaction,
      });
      if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
      await schedule.update(sanitizeSchedule(req.body), { transaction });
      return schedule;
    });
    res.json({ schedule: schedule.toJSON() });
  } catch (err) {
    next(err);
  }
});

router.delete('/me/schedules/:id', authenticate, requireApproved, async (req, res, next) => {
  try {
    await workflow.transact(async (transaction) => {
      const proposal = await findOwnProposalEditable(
        req.user.id,
        req.body.academicYear || req.query.year || currentAcademicYearLabel(),
        transaction,
      );
      const schedule = await MonteOreSchedule.findOne({
        where: { id: req.params.id, proposalId: proposal.id },
        transaction,
      });
      if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
      const active = await MonteOreSlot.count({
        where: { scheduleId: schedule.id, isActive: true },
        transaction,
      });
      if (active && !req.body.confirmRemoval)
        workflow.fail(
          `La fascia contiene ${active} date selezionate. Deselezionale prima di eliminare la fascia.`,
          'ACTIVE_SCHEDULE',
        );
      await schedule.destroy({ transaction });
      await slotService.recomputeTotals(proposal.id, { transaction });
    });
    res.json({ message: 'Riga eliminata' });
  } catch (err) {
    next(err);
  }
});

router.post('/me/submit', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.body.academicYear || currentAcademicYearLabel();
    if (!(await isWithinSubmissionWindow(year, req.user)))
      workflow.fail(
        'Sei fuori dalla finestra di inserimento del monte ore',
        'OUTSIDE_SUBMISSION_WINDOW',
      );
    const proposal = await workflow.transact(async (transaction) => {
      const proposal = await findOwnProposalEditable(req.user.id, year, transaction);
      const plan = await workflow.loadPlan(proposal.id, transaction);
      if (!plan.schedules.length)
        workflow.fail('Imposta il pattern settimanale prima di inviare', 'EMPTY_PATTERN');
      const distinctDays = new Set(plan.schedules.map((s) => s.dayOfWeek));
      let validated;
      if (plan.settings) {
        const daily = validateDailyConstraints(plan.schedules, plan.settings);
        if (!daily.ok) {
          const error = new Error(
            formatDailyViolationMessage(daily.violations[0], daily.violations.length),
          );
          error.status = 400;
          error.code = daily.violations[0].code;
          error.violations = daily.violations;
          throw error;
        }
        // Detect pattern edits not yet propagated to the grid.
        for (const slot of plan.slots.filter((s) => s.isActive)) {
          const schedule = plan.schedules.find((s) => s.id === slot.scheduleId);
          if (
            !schedule ||
            schedule.dayOfWeek !== slot.dayOfWeek ||
            schedule.startTime !== slot.startTime ||
            schedule.endTime !== slot.endTime
          )
            workflow.fail('Rigenera la griglia dopo aver modificato il pattern', 'STALE_GRID');
        }
        validated = await workflow.validatePlan(plan, workflow.expandRooms(plan, plan.slots), {
          transaction,
          snapshot: false,
        });
      }
      await proposal.update(
        {
          status: 'submitted',
          submittedAt: new Date(),
          ...(validated
            ? {
                workingDaysCount: validated.rule.bypassDayConstraint ? null : distinctDays.size,
                totalHoursRequested: validated.totalMinutes / 60,
                totalHoursPlanned: validated.totalMinutes / 60,
                minRequiredHoursSnapshot: validated.rule.minHours,
                contractSnapshot: validated.rule,
                requiresRevalidation: false,
                revalidationReason: null,
              }
            : {}),
        },
        { transaction },
      );
      return proposal;
    });
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    if (err.violations)
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code, violations: err.violations });
    next(err);
  }
});

// ============================================================
// DOCENTE — calendario griglia + slot toggle + amendments
// ============================================================

/**
 * Restituisce la griglia delle settimane (Lun-Sab) filtrata da
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
    const proposal = await findOwnProposalEditable(
      req.user.id,
      req.body.academicYear || req.query.year || currentAcademicYearLabel(),
    );
    // Atomico: destroy + bulkCreate + recomputeTotals in una sola transazione.
    // Senza tx un crash a metà lasciava la proposta con metà degli slot persi.
    const result = await workflow.transact(async (transaction) => {
      await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
      return slotService.regenerateSlotsFromPattern(proposal.id, {
        transaction,
        confirmRemoval: req.body.confirmRemoval === true,
      });
    });
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
      const updated = await workflow.transact(async (transaction) => {
        await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
        return slotService.toggleSlot(slot.id, { transaction });
      });
      return res.json({ slot: updated.toJSON() });
    }
    // Stati che richiedono amendment workflow
    if (['approved', 'generated'].includes(proposal.status)) {
      const amendment = await workflow.requestAmendment(proposal.id, req.user.id, {
        operations: [
          { kind: slot.isActive ? 'toggle_off' : 'toggle_on', slotId: slot.id, payload: {} },
        ],
        notes: req.body.notes,
        requestKey: req.body.requestKey || randomUUID(),
      });
      return res.status(201).json({ amendment: amendment.toJSON() });
    }
    return res.status(400).json({ error: 'Stato non gestito' });
  } catch (err) {
    if (err.code === 'SLOT_LOCKED' || err.code === 'AMENDMENT_LIMIT_REACHED')
      return res.status(err.status || 400).json({ error: err.message, code: err.code });
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * Richiesta di un nuovo giorno FUORI dal pattern settimanale approvato.
 * Crea un `MonteOreAmendment` kind='add_new_day' status='pending' che dovrà
 * essere approvato dal coordinatore. L'effettivo `MonteOreSlot` (e l'eventuale
 * Booking) viene creato solo all'approvazione.
 *
 * Body atteso: { date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM",
 *                roomId: number, bookingType?: string, notes?: string,
 *                purpose?: string }
 */
router.post('/me/amendments/add-new-day', authenticate, requireApproved, async (req, res, next) => {
  try {
    const year = req.body.year || currentAcademicYearLabel();
    const proposal = await MonteOreProposal.findOne({
      where: { userId: req.user.id, academicYear: year },
    });
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    if (!['approved', 'generated'].includes(proposal.status)) {
      return res.status(400).json({ error: 'La proposta non è approvata', code: 'INVALID_STATE' });
    }
    const { date, startTime, endTime, roomId, bookingType, notes, purpose } = req.body || {};
    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Campi obbligatori: date, startTime, endTime' });
    }
    const isoDate = String(date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return res.status(400).json({ error: 'Formato data non valido (YYYY-MM-DD)' });
    }
    const sT = String(startTime).slice(0, 5);
    const eT = String(endTime).slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(sT) || !/^\d{2}:\d{2}$/.test(eT)) {
      return res.status(400).json({ error: 'Formato orario non valido (HH:MM)' });
    }
    if (sT >= eT) {
      return res.status(400).json({ error: 'startTime deve essere prima di endTime' });
    }
    // roomId opzionale: il coordinatore la assegna in fase di approve.
    // Esistenza convalidata in approve (FK + lookup), non qui.
    const roomIdNum =
      roomId !== undefined && roomId !== null && roomId !== '' ? Number(roomId) : null;

    const amendment = await workflow.requestAmendment(proposal.id, req.user.id, {
      requestKey: req.body.requestKey || randomUUID(),
      notes,
      operations: [
        {
          kind: 'add_new_day',
          payload: {
            date: isoDate,
            startTime: sT,
            endTime: eT,
            roomId: roomIdNum,
            bookingType: bookingType || 'lezione',
            purpose: purpose || null,
          },
        },
      ],
    });

    res.status(201).json({ amendment: amendment.toJSON() });
  } catch (err) {
    next(err);
  }
});

/**
 * Helper comune per i 3 endpoint di "spostamento" (change-time, change-room,
 * move-to). Ritorna { proposal, slot } o lancia un Error con .status/.code.
 *
 * - Verifica che lo slot appartenga al docente corrente.
 * - Verifica che la proposta sia in stato approved/generated (in draft il
 *   docente modifica direttamente schedule/slot senza amendment).
 * - Verifica che lo slot non sia locked (festività/sospensione).
 */
async function loadOwnApprovedSlot(slotId, userId) {
  const slot = await MonteOreSlot.findByPk(slotId);
  if (!slot) {
    const e = new Error('Slot non trovato');
    e.status = 404;
    throw e;
  }
  const proposal = await MonteOreProposal.findByPk(slot.proposalId);
  if (!proposal || proposal.userId !== userId) {
    const e = new Error('Non autorizzato');
    e.status = 403;
    throw e;
  }
  if (!['approved', 'generated'].includes(proposal.status)) {
    const e = new Error('Spostamenti consentiti solo dopo approvazione');
    e.status = 400;
    e.code = 'INVALID_STATE';
    throw e;
  }
  if (slot.isLocked) {
    const e = new Error('Cella bloccata (festività/sospensione)');
    e.status = 400;
    e.code = 'SLOT_LOCKED';
    throw e;
  }
  return { proposal, slot };
}

/**
 * Helper: crea un amendment con increment atomico cross-dialect del budget
 * annuale e lascia la richiesta pendente. Nessuna mutazione del piano operativo.
 */
async function createAndApplyAmendment({ req, proposal, slot, kind, payload }) {
  return workflow.requestAmendment(proposal.id, req.user.id, {
    operations: [{ kind, slotId: slot.id, payload }],
    notes: req.body.notes,
    requestKey: req.body.requestKey || randomUUID(),
  });
}

/**
 * POST /api/monte-ore/me/slots/:id/change-time
 * Cambia l'orario di UN'occorrenza ricorrente (lascia il pattern intatto).
 * Body: { startTime?: "HH:MM", endTime?: "HH:MM", notes?: string }
 * Ogni richiesta rimane pendente fino alla decisione del revisore.
 */
router.post('/me/slots/:id/change-time', authenticate, requireApproved, async (req, res, next) => {
  try {
    const { proposal, slot } = await loadOwnApprovedSlot(req.params.id, req.user.id);
    const sT = req.body?.startTime ? String(req.body.startTime).slice(0, 5) : null;
    const eT = req.body?.endTime ? String(req.body.endTime).slice(0, 5) : null;
    if (!sT && !eT) {
      return res.status(400).json({ error: 'Indicare almeno startTime o endTime' });
    }
    const finalStart = sT ?? slot.startTime;
    const finalEnd = eT ?? slot.endTime;
    if (!/^\d{2}:\d{2}$/.test(finalStart) || !/^\d{2}:\d{2}$/.test(finalEnd)) {
      return res.status(400).json({ error: 'Formato orario non valido (HH:MM)' });
    }
    if (finalStart >= finalEnd) {
      return res.status(400).json({ error: 'startTime deve essere prima di endTime' });
    }
    const amendment = await createAndApplyAmendment({
      req,
      proposal,
      slot,
      kind: 'change_time',
      payload: { startTime: finalStart, endTime: finalEnd },
    });
    res.status(201).json({ amendment: amendment.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * POST /api/monte-ore/me/slots/:id/change-room
 * Cambia l'aula di UN'occorrenza (override puntuale). Pattern e altre
 * settimane restano invariati. Sempre pending: l'aula è risorsa condivisa.
 * Body: { roomId: number, notes?: string }
 */
router.post('/me/slots/:id/change-room', authenticate, requireApproved, async (req, res, next) => {
  try {
    const { proposal, slot } = await loadOwnApprovedSlot(req.params.id, req.user.id);
    const newRoomId = Number(req.body?.roomId);
    if (!Number.isInteger(newRoomId) || newRoomId <= 0) {
      return res.status(400).json({ error: 'roomId obbligatorio (intero positivo)' });
    }
    const room = await Room.findByPk(newRoomId);
    if (!room) {
      return res.status(400).json({ error: 'Aula non trovata', code: 'ROOM_NOT_FOUND' });
    }
    // Always pending: l'admin verifica disponibilità aula.
    const amendment = await createAndApplyAmendment({
      req,
      proposal,
      slot,
      kind: 'change_room',
      payload: { roomId: newRoomId },
    });
    res.status(201).json({ amendment: amendment.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * POST /api/monte-ore/me/slots/:id/move-to
 * Sposta UNA lezione attiva su una cella diversa (toggle off+on atomico).
 * Conta come 1 sola variazione di budget.
 * Body: { targetSlotId: number, notes?: string }
 *
 * Ogni spostamento richiede la decisione del revisore.
 */
router.post('/me/slots/:id/move-to', authenticate, requireApproved, async (req, res, next) => {
  try {
    const { proposal, slot: source } = await loadOwnApprovedSlot(req.params.id, req.user.id);
    if (!source.isActive) {
      return res
        .status(400)
        .json({ error: 'Lo slot sorgente non è attivo', code: 'SOURCE_NOT_ACTIVE' });
    }
    const targetSlotId = Number(req.body?.targetSlotId);
    if (!Number.isInteger(targetSlotId) || targetSlotId <= 0) {
      return res.status(400).json({ error: 'targetSlotId obbligatorio' });
    }
    if (targetSlotId === source.id) {
      return res.status(400).json({ error: 'Source e target coincidono' });
    }
    const target = await MonteOreSlot.findByPk(targetSlotId);
    if (!target || target.proposalId !== proposal.id) {
      return res.status(400).json({ error: 'Target non valido', code: 'TARGET_NOT_FOUND' });
    }
    if (target.isLocked) {
      return res
        .status(400)
        .json({ error: 'Cella target bloccata (festività)', code: 'TARGET_LOCKED' });
    }
    if (target.isActive) {
      return res
        .status(400)
        .json({ error: 'Cella target già attiva', code: 'TARGET_ALREADY_ACTIVE' });
    }
    const amendment = await createAndApplyAmendment({
      req,
      proposal,
      slot: source,
      kind: 'move_to',
      payload: { targetSlotId: target.id, sourceDate: source.date, targetDate: target.date },
    });
    res.status(201).json({ amendment: amendment.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * Elenco amendments della propria proposta (per visibilità docente).
 */
router.post('/me/amendments', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await MonteOreProposal.findOne({
      where: {
        userId: req.user.id,
        academicYear: req.body.academicYear || currentAcademicYearLabel(),
      },
    });
    if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
    const amendment = await workflow.requestAmendment(proposal.id, req.user.id, req.body);
    res.status(201).json({ amendment });
  } catch (err) {
    next(err);
  }
});

router.post('/me/slots/select', authenticate, requireApproved, async (req, res, next) => {
  try {
    const proposal = await findOwnProposalEditable(
      req.user.id,
      req.body.academicYear || currentAcademicYearLabel(),
    );
    const { dateFrom, dateTo, dayOfWeek, isActive } = req.body;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateTo || '') ||
      dateFrom > dateTo ||
      typeof isActive !== 'boolean'
    )
      return res.status(400).json({ error: 'Periodo o selezione non validi' });
    await workflow.transact(async (transaction) => {
      await findOwnProposalEditable(req.user.id, proposal.academicYear, transaction);
      const where = {
        proposalId: proposal.id,
        isLocked: false,
        date: { [Op.between]: [dateFrom, dateTo] },
      };
      if (dayOfWeek !== undefined && dayOfWeek !== null) {
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 6)
          workflow.fail('Giorno non valido');
        where.dayOfWeek = dayOfWeek;
      }
      await MonteOreSlot.update({ isActive }, { where, transaction, validate: false });
      await slotService.recomputeTotals(proposal.id, { transaction });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    const maximum = settings?.maxAmendmentsPerYear ?? 3;
    res.json({
      amendments: await serializeAmendments(amendments),
      budget: {
        used: proposal.requestCount,
        maximum,
        remaining: Math.max(0, maximum - proposal.requestCount),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/monte-ore/academic-years
 *
 * Lista degli AA disponibili. Comportamento dipendente dal ruolo:
 *
 *   - Utente NON admin → ritorna SOLO l'AA target del docente (calcolato
 *     con `resolveTargetAcademicYearForTeacher`): 1 elemento.
 *   - Admin (o `scope=admin`) → ritorna tutti gli AA con settings + flag
 *     `canCreateNew` per AA futuri non ancora presenti.
 *
 * Shape:
 *   { items: [{ academicYear, label, isCurrent, isNext, submissionOpen,
 *               hasSettings, canCreateNew? }],
 *     default: "Y/Y+1" }
 */
router.get('/academic-years', authenticate, async (req, res, next) => {
  try {
    const today = new Date();
    const currentLabel = calendarService.currentAcademicYear(today);
    const nextLabel = calendarService.nextAcademicYear(today);

    const isAdmin =
      req.user?.role === 'admin' || (req.query.scope === 'admin' && req.user?.role === 'admin');

    if (!isAdmin) {
      // Override admin: settings con isActiveForTeachers=true vincono.
      const activeSettings = await MonteOreSettings.findOne({
        where: { isActiveForTeachers: true },
      });
      const nextSettings = await MonteOreSettings.findOne({
        where: { academicYear: nextLabel },
      });
      const target = calendarService.resolveTargetAcademicYearForTeacher(
        today,
        nextSettings,
        activeSettings,
      );
      const targetSettings = await MonteOreSettings.findOne({ where: { academicYear: target } });
      const submissionOpen = targetSettings
        ? calendarService.isSubmissionWindowOpen(targetSettings, today)
        : false;
      const isNext = target === nextLabel;
      const isCurrent = target === currentLabel;
      const adminActivated = !!activeSettings && activeSettings.academicYear === target;
      let label = `AA ${target}`;
      if (adminActivated) label += " (attivato dall'amministrazione)";
      else if (isCurrent) label += ' (in corso)';
      else if (isNext) label += ' (prossimo)';
      return res.json({
        items: [
          {
            academicYear: target,
            label,
            isCurrent,
            isNext,
            submissionOpen,
            hasSettings: !!targetSettings,
            adminActivated,
          },
        ],
        default: target,
      });
    }

    // Admin: tutti gli AA con settings + AA "futuri" candidati alla creazione.
    const all = await MonteOreSettings.findAll({ order: [['academicYear', 'DESC']] });
    const items = all.map((s) => {
      const isCurrent = s.academicYear === currentLabel;
      const isNext = s.academicYear === nextLabel;
      let label = `AA ${s.academicYear}`;
      if (s.isActiveForTeachers) label += ' (attivato per docenti)';
      else if (isCurrent) label += ' (in corso)';
      else if (isNext) label += ' (prossimo)';
      return {
        academicYear: s.academicYear,
        label,
        isCurrent,
        isNext,
        submissionOpen: calendarService.isSubmissionWindowOpen(s, today),
        hasSettings: true,
        adminActivated: !!s.isActiveForTeachers,
        settingsId: s.id,
      };
    });

    // Assicura che current e next siano presenti (anche se senza settings)
    const present = new Set(items.map((i) => i.academicYear));
    const ensure = (aaLabel) => {
      if (!present.has(aaLabel)) {
        items.push({
          academicYear: aaLabel,
          label: `AA ${aaLabel}${aaLabel === currentLabel ? ' (in corso)' : aaLabel === nextLabel ? ' (prossimo)' : ''}`,
          isCurrent: aaLabel === currentLabel,
          isNext: aaLabel === nextLabel,
          submissionOpen: false,
          hasSettings: false,
          canCreateNew: true,
        });
      }
    };
    ensure(currentLabel);
    ensure(nextLabel);

    // Ordina DESC per stringa "YYYY/YYYY"
    items.sort((a, b) => (a.academicYear < b.academicYear ? 1 : -1));

    res.json({ items, default: currentLabel });
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
  // Vincoli giornalieri (Z2/Z3): nullable, "" o null → null, numero altrimenti.
  // Il range è validato dal modello; qui ci limitiamo a normalizzare il tipo.
  if (body.maxHoursPerDay !== undefined) out.maxHoursPerDay = nullableNumber(body.maxHoursPerDay);
  if (body.dailyBreakAfterHours !== undefined)
    out.dailyBreakAfterHours = nullableNumber(body.dailyBreakAfterHours);
  if (body.dailyBreakMinutes !== undefined)
    out.dailyBreakMinutes = nullableNumber(body.dailyBreakMinutes, { integer: true });
  return out;
}

function nullableNumber(v, { integer = false } = {}) {
  if (v === null || v === '' || v === undefined) return null;
  const n = integer ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Messaggio italiano per una violazione di vincolo giornaliero. */
function formatDailyViolationMessage(v, totalViolations) {
  const dayLabels = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const dayName = dayLabels[v.dayOfWeek] || `Giorno ${v.dayOfWeek}`;
  const suffix = totalViolations > 1 ? ` (e altre ${totalViolations - 1} violazioni)` : '';
  if (v.code === 'DAILY_HOURS_EXCEEDED') {
    return `${dayName}: ${v.totalHours}h totali superano il massimo di ${v.limit}h giornaliere${suffix}`;
  }
  if (v.code === 'BREAK_REQUIRED') {
    return `${dayName}: ${v.consecutiveHours}h consecutive richiedono una pausa di almeno ${v.breakNeeded} minuti dopo ${v.threshold}h${suffix}`;
  }
  return `Violazione vincolo giornaliero${suffix}`;
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

/**
 * Verifica se esiste già una sospensione equivalente (stesso istituto, AA,
 * nome case-insensitive trimmed, e range date identici). Usato dai POST per
 * impedire duplicati su double-click o retry HTTP.
 */
async function findExistingSuspension({ instituteId, academicYear, name, dateFrom, dateTo }) {
  if (!name) return null;
  return MonteOreSuspension.findOne({
    where: sequelize.and(
      { instituteId, academicYear, dateFrom, dateTo },
      sequelize.where(
        sequelize.fn('LOWER', sequelize.col('name')),
        sequelize.fn('LOWER', name.trim()),
      ),
    ),
  });
}

// IMPORTANTE: le route concrete (/settings, /suspensions, /amendments) DEVONO
// stare PRIMA delle route param /:id, altrimenti Express matcha "settings"
// come parametro :id e ritorna 404 dal handler proposta.

// ---- Academic Years (bootstrap) ----
/**
 * POST /api/admin/monte-ore/academic-years
 *
 * Body: { academicYear, mode?, previousYear?, overwrite? }
 *
 *   - `academicYear` deve matchare `^\d{4}/\d{4}$` con Y+1 = secondo numero.
 *   - `mode` ∈ {'default','from_previous'} (default 'default').
 *   - `previousYear` richiesto in mode='from_previous'.
 *   - `overwrite` (default false) → se true sovrascrive settings esistenti e
 *     ri-applica le festività deterministiche.
 *
 * Ritorna `{ settings, suspensionsCreated, suspensionsSkipped }`.
 */
adminRouter.post('/academic-years', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { academicYear, mode, previousYear, overwrite } = req.body || {};
    if (!academicYear || !/^\d{4}\/\d{4}$/.test(academicYear)) {
      return res.status(400).json({
        error: 'academicYear non valido (atteso formato "YYYY/YYYY")',
        code: 'VALIDATION_FAILED',
      });
    }
    const [a, b] = academicYear.split('/').map(Number);
    if (b !== a + 1) {
      return res.status(400).json({
        error: 'academicYear non coerente: il secondo anno deve essere il primo + 1',
        code: 'VALIDATION_FAILED',
      });
    }
    const { bootstrapAcademicYear } = require('../services/academicYearBootstrap');
    const result = await updateCalendar(
      academicYear,
      req.user,
      req.body.confirmImpact === true,
      (transaction) =>
        bootstrapAcademicYear({
          academicYear,
          mode: mode === 'from_previous' ? 'from_previous' : 'default',
          previousYear: previousYear || null,
          overwrite: !!overwrite,
          transaction,
        }),
    );
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * POST /api/admin/monte-ore/academic-years/:academicYear/activate-for-teachers
 *
 * Marca l'AA specificato come "attivo per i docenti": vince sulla logica
 * automatica della finestra di submission. Atomico in transazione:
 * disattiva tutti gli altri AA dello stesso istituto, poi attiva quello
 * indicato. Body opzionale: `{ active: false }` per rimuovere l'override.
 *
 * Ritorna `{ activated: settings|null, deactivated: number }`.
 */
adminRouter.post(
  '/academic-years/:academicYear/activate-for-teachers',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { academicYear } = req.params;
      const active = req.body?.active !== false; // default true
      if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
        return res.status(400).json({ error: 'academicYear non valido' });
      }
      const target = await MonteOreSettings.findOne({ where: { academicYear } });
      if (!target) {
        return res.status(404).json({ error: 'Settings non trovati per questo AA' });
      }
      const { sequelize } = require('../models');
      const result = await sequelize.transaction(async (t) => {
        const [deactivated] = await MonteOreSettings.update(
          { isActiveForTeachers: false },
          {
            where: { instituteId: target.instituteId, isActiveForTeachers: true },
            transaction: t,
          },
        );
        if (active) {
          target.isActiveForTeachers = true;
          await target.save({ transaction: t });
        }
        return { deactivated };
      });
      const fresh = await MonteOreSettings.findByPk(target.id);
      res.json({ activated: active ? fresh : null, deactivated: result.deactivated });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Exam Sessions (sospensioni con category='exam_session') ----
adminRouter.get('/exam-sessions', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const year = req.query.academicYear || calendarService.currentAcademicYear();
    const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
    const where = { academicYear: year, category: 'exam_session' };
    if (settings) where.instituteId = settings.instituteId;
    const items = await MonteOreSuspension.findAll({
      where,
      order: [['dateFrom', 'ASC']],
    });
    res.json({ examSessions: items.map((s) => s.toJSON()) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/exam-sessions', authenticate, requireRole('admin'), async (req, res, next) => {
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

    const existing = await findExistingSuspension({
      instituteId,
      academicYear: year,
      name: data.name,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
    });
    if (existing) {
      return res.status(409).json({
        error: 'Sessione esame già presente con stesso nome e date',
        code: 'DUPLICATE',
        examSession: existing.toJSON(),
      });
    }

    const susp = await updateCalendar(
      year,
      req.user,
      req.body.confirmImpact === true,
      (transaction) =>
        MonteOreSuspension.create(
          {
            instituteId,
            academicYear: year,
            name: data.name,
            dateFrom: data.dateFrom,
            dateTo: data.dateTo,
            kind: 'partial',
            category: 'exam_session',
            notes: data.notes || null,
          },
          { transaction },
        ),
    );
    res.status(201).json({ examSession: susp.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

adminRouter.patch(
  '/exam-sessions/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const susp = await MonteOreSuspension.findByPk(req.params.id);
      if (!susp || susp.category !== 'exam_session') {
        return res.status(404).json({ error: 'Sessione esame non trovata' });
      }
      const patch = {};
      const data = sanitizeSuspension(req.body);
      if (data.name !== undefined) patch.name = data.name;
      if (data.dateFrom !== undefined) patch.dateFrom = data.dateFrom;
      if (data.dateTo !== undefined) patch.dateTo = data.dateTo;
      if (data.notes !== undefined) patch.notes = data.notes;
      await updateCalendar(
        susp.academicYear,
        req.user,
        req.body.confirmImpact === true,
        (transaction) => susp.update(patch, { transaction }),
      );
      res.json({ examSession: susp.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.delete(
  '/exam-sessions/:id',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const susp = await MonteOreSuspension.findByPk(req.params.id);
      if (!susp || susp.category !== 'exam_session') {
        return res.status(404).json({ error: 'Sessione esame non trovata' });
      }
      await updateCalendar(susp.academicYear, req.user, true, (transaction) =>
        susp.destroy({ transaction }),
      );
      res.json({ message: 'Sessione esame eliminata' });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Import template Excel ----
adminRouter.get(
  '/import-template.xlsx',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const year = req.query.academicYear || calendarService.currentAcademicYear();
      const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
      const suspensions = await MonteOreSuspension.findAll({
        where: { academicYear: year },
        order: [['dateFrom', 'ASC']],
      });
      const { streamTemplate } = require('../services/monteOreTemplateService');
      await streamTemplate(res, {
        academicYear: year,
        settings: settings ? settings.toJSON() : null,
        suspensions: suspensions.map((s) => s.toJSON()),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Import Excel compilato dal docente (admin upload) ----
//
// L'admin scarica il template via `/import-template.xlsx`, lo passa al
// docente, riceve il file compilato e lo carica qui. Il backend:
//   1. parse del foglio "Anagrafica" + "Orario" (vedi monteOreImportService)
//   2. lookup del docente via email (paranoid:false, accetta anche utenti
//      soft-deleted: caso di subentro a fine anno)
//   3. validazione AA + esistenza MonteOreSettings per quell'AA
//   4. upsert della proposta con status='submitted' e source='admin_import'
//   5. ricrea le righe MonteOreSchedule a partire dalle fasce aggregate
//      (roomId=null: il coordinatore le assegnerà prima di approvare).
//
// Multer in-memory (mai su disco), limite 5 MB.
const ALLOWED_XLSX = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  // Alcuni browser (Safari, Firefox in certi build) inviano i .xlsx come
  // octet-stream: lo accettiamo come fallback e ci affidiamo al parsing.
  'application/octet-stream',
];
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const okMime = ALLOWED_XLSX.includes(file.mimetype || '');
    const okExt = /\.xlsx$/i.test(file.originalname || '');
    if (!okMime && !okExt) {
      return cb(new Error('Formato non supportato (atteso .xlsx)'));
    }
    cb(null, true);
  },
});

adminRouter.post(
  '/import',
  authenticate,
  requireRole('admin'),
  (req, res, next) => {
    // Wrappa multer per catturare i suoi errori e ritornarli come 400
    // (altrimenti diventano 500 dal next handler globale).
    importUpload.single('file')(req, res, (err) => {
      if (err) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: err.message, code: err.code || 'UPLOAD_FAILED' });
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nessun file caricato', code: 'NO_FILE' });
      }

      const { parseExcel } = require('../services/monteOreImportService');
      let parsed;
      try {
        parsed = await parseExcel(req.file.buffer);
      } catch (e) {
        return res.status(400).json({
          error: `File Excel non valido: ${e.message}`,
          code: 'PARSE_FAILED',
        });
      }
      const { anagrafica, schedules, warnings } = parsed;

      // --- Email obbligatoria e ben formata ---
      const email = (anagrafica.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          error: 'Email docente mancante o non valida nel foglio Anagrafica',
          code: 'INVALID_EMAIL',
        });
      }

      // --- AA: formato + coerenza Y/Y+1 ---
      const academicYear = String(anagrafica.academicYear || '').trim();
      if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
        return res.status(400).json({
          error: 'Anno Accademico mancante o formato non valido (atteso "YYYY/YYYY")',
          code: 'INVALID_YEAR',
        });
      }
      const [yA, yB] = academicYear.split('/').map(Number);
      if (yB !== yA + 1) {
        return res.status(400).json({
          error: 'Anno Accademico non coerente: il secondo anno deve essere il primo + 1',
          code: 'INVALID_YEAR',
        });
      }

      // --- Lookup docente (include soft-deleted) ---
      const teacher = await User.findOne({
        where: { email },
        paranoid: false,
      });
      if (!teacher) {
        return res.status(404).json({
          error: `Docente con email ${email} non trovato`,
          code: 'TEACHER_NOT_FOUND',
        });
      }

      // --- Verifica esistenza MonteOreSettings per l'AA dell'istituto ---
      // Il modello User non ha instituteId: la verifica si riduce a "esiste un
      // settings per quell'AA" (multi-istituto è gestito altrove via routing).
      const settings = await MonteOreSettings.findOne({ where: { academicYear } });
      if (!settings) {
        return res.status(400).json({
          error: `AA ${academicYear} non configurato per l'istituto del docente`,
          code: 'YEAR_NOT_CONFIGURED',
        });
      }

      // --- Calcolo ore totali del pattern (somma delle fasce, non moltiplicato per occurrences) ---
      const totalHoursPattern = schedules.reduce((acc, s) => {
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        return acc + (eh + em / 60 - (sh + sm / 60));
      }, 0);

      const overwriteParam = String(
        req.body?.overwrite ?? req.query?.overwrite ?? '',
      ).toLowerCase();
      const overwrite = overwriteParam !== 'false'; // default true
      const force = String(req.body?.force ?? req.query?.force ?? '').toLowerCase() === 'true';

      const range = defaultRangeForYear(academicYear);
      const now = new Date();
      const originalName = req.file.originalname || 'import.xlsx';

      // --- Transazione: findOrCreate proposal + ricrea schedules ---
      const result = await sequelize.transaction(async (t) => {
        const [proposal, created] = await MonteOreProposal.findOrCreate({
          where: { userId: teacher.id, academicYear },
          defaults: {
            userId: teacher.id,
            academicYear,
            validFrom: range.validFrom,
            validTo: range.validTo,
            status: 'submitted',
            source: 'admin_import',
            importedAt: now,
            importedById: req.user.id,
            importSourceRef: originalName,
            submittedAt: now,
            coordinatorNotes: anagrafica.note || null,
            totalHoursRequested: Number(totalHoursPattern.toFixed(2)),
          },
          transaction: t,
        });

        if (!created) {
          if (!overwrite) {
            const err = new Error('Proposta già esistente per questo docente e AA');
            err.status = 409;
            err.code = 'ALREADY_EXISTS';
            throw err;
          }
          // Se la proposta esisteva in stato diverso da draft/submitted/rejected,
          // richiediamo `force=true` per non sovrascrivere lavoro già approvato.
          if (proposal.status === 'generated')
            workflow.fail(
              'Annulla la generazione prima di sostituire il piano via import',
              'INVALID_STATE',
            );
          if (!['draft', 'submitted', 'rejected'].includes(proposal.status) && !force) {
            const err = new Error(
              `Proposta in stato '${proposal.status}': passa force=true per sovrascrivere`,
            );
            err.status = 409;
            err.code = 'INVALID_STATE_FOR_OVERWRITE';
            throw err;
          }
          // Cancella le righe esistenti (verranno ricreate sotto)
          await MonteOreSchedule.destroy({
            where: { proposalId: proposal.id },
            transaction: t,
          });
          await proposal.update(
            {
              status: 'submitted',
              source: 'admin_import',
              importedAt: now,
              importedById: req.user.id,
              importSourceRef: originalName,
              submittedAt: now,
              coordinatorNotes: anagrafica.note || null,
              totalHoursRequested: Number(totalHoursPattern.toFixed(2)),
              rejectedAt: null,
              rejectionReason: null,
            },
            { transaction: t },
          );
        }

        // Crea le righe schedule in batch (era N INSERT sequenziali pre-v1.14.1).
        // roomId=null: l'admin assegnerà l'aula prima di approvare la proposta.
        const schedulePayloads = schedules.map((s) => ({
          proposalId: proposal.id,
          roomId: null,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          bookingType: s.bookingType || 'lezione',
          purpose: anagrafica.materia || null,
          notes: s.notes || null,
          excludeDates: [],
        }));
        if (schedulePayloads.length > 0) {
          await MonteOreSchedule.bulkCreate(schedulePayloads, {
            transaction: t,
            validate: true,
          });
        }

        await slotService.regenerateSlotsFromPattern(proposal.id, {
          transaction: t,
          confirmRemoval: true,
        });
        await MonteOreSlot.update(
          { isActive: true },
          { where: { proposalId: proposal.id, isLocked: false }, transaction: t, validate: false },
        );
        await slotService.recomputeTotals(proposal.id, { transaction: t });
        const plan = await workflow.loadPlan(proposal.id, t);
        const rule = await resolveAnnualThreshold(teacher.id, academicYear, { transaction: t });
        if (rule.mode === 'exact' || rule.mode === 'maximum') {
          await workflow.validatePlan(plan, workflow.expandRooms(plan, plan.slots), {
            transaction: t,
            snapshot: false,
          });
        }
        await proposal.reload({ transaction: t });
        await proposal.update(
          {
            contractSnapshot: rule,
            minRequiredHoursSnapshot: rule.minHours,
            totalHoursRequested: proposal.totalHoursPlanned,
          },
          { transaction: t },
        );

        // Reload con schedules per ritornare il dato fresco.
        const fresh = await MonteOreProposal.findByPk(proposal.id, {
          include: [{ model: MonteOreSchedule, as: 'schedules' }],
          transaction: t,
        });
        return fresh;
      });

      return res.status(201).json({
        proposal: serializeProposal(result),
        user: {
          id: teacher.id,
          email: teacher.email,
          fullName: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
        },
        summary: {
          schedulesCreated: schedules.length,
          totalHoursPattern: Number(totalHoursPattern.toFixed(2)),
          warnings,
        },
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  },
);

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
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
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
    await updateCalendar(year, req.user, req.body.confirmImpact === true, (transaction) =>
      settings.update(sanitizeSettings(req.body), { transaction }),
    );
    res.json({ settings: settings.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    // Errore di validazione model (es. range fuori scope o coerenza
    // dailyBreakAfterHours/dailyBreakMinutes) → 400 con messaggio leggibile
    // invece di 500 generico.
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({
        error: err.errors?.[0]?.message || err.message,
        code: 'INVALID_SETTINGS',
      });
    }
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

    const existing = await findExistingSuspension({
      instituteId,
      academicYear: year,
      name: data.name,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
    });
    if (existing) {
      return res.status(409).json({
        error: 'Sospensione già presente con stesso nome e date',
        code: 'DUPLICATE',
        suspension: existing.toJSON(),
      });
    }

    // Atomico: o entrambi (exception + suspension) sono creati, o nessuno —
    // così non restano BookingRuleException orfane se la suspension fallisce.
    const susp = await updateCalendar(
      year,
      req.user,
      req.body.confirmImpact === true,
      async (t) => {
        let bookingRuleExceptionId = null;
        if (req.body.applyToAllBookings === true) {
          const ex = await BookingRuleException.create(
            {
              role: 'all',
              name: data.name,
              kind: 'block',
              dateFrom: data.dateFrom,
              dateTo: data.dateTo,
              isActive: true,
              notes: `Generata automaticamente dalla sospensione monte ore (${year})`,
            },
            { transaction: t },
          );
          bookingRuleExceptionId = ex.id;
        }
        return MonteOreSuspension.create(
          { instituteId, academicYear: year, bookingRuleExceptionId, ...data },
          { transaction: t },
        );
      },
    );
    res.status(201).json({ suspension: susp.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
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
      await updateCalendar(
        susp.academicYear,
        req.user,
        req.body.confirmImpact === true,
        async (transaction) => {
          const patch = sanitizeSuspension(req.body);
          if (susp.bookingRuleExceptionId) {
            const linked = {};
            for (const key of ['name', 'dateFrom', 'dateTo'])
              if (patch[key] !== undefined) linked[key] = patch[key];
            await BookingRuleException.update(linked, {
              where: { id: susp.bookingRuleExceptionId },
              transaction,
            });
          }
          return susp.update(patch, { transaction });
        },
      );
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
      // Cancella prima l'exception linkata (se presente), poi la suspension.
      await updateCalendar(susp.academicYear, req.user, true, async (transaction) => {
        if (susp.bookingRuleExceptionId)
          await BookingRuleException.destroy({
            where: { id: susp.bookingRuleExceptionId },
            transaction,
          });
        return susp.destroy({ transaction });
      });
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
    res.json({ amendments: await serializeAmendments(items) });
  } catch (err) {
    next(err);
  }
});

// Conteggio (badge sidebar / dashboard tile): evita di trasferire l'intera
// lista di amendment quando serve solo il numero.
adminRouter.get(
  '/amendments/pending/count',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const count = await MonteOreAmendment.count({ where: { status: 'pending' } });
      res.json({ count });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.academicYear) where.academicYear = req.query.academicYear;
    if (req.query.userId) where.userId = Number(req.query.userId);
    const { limit, offset } = parsePagination(req.query);
    const { rows, count } = await MonteOreProposal.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          // required: true → INNER JOIN: le proposte di utenti soft-deleted
          // (paranoid) non compaiono. Difesa addizionale rispetto al cleanup
          // applicativo nelle DELETE route.
          required: true,
          attributes: [
            'id',
            'firstName',
            'lastName',
            'email',
            'role',
            'matricola',
            'courseId',
            // Campi deroga Monte Ore: l'admin deve poter vedere a colpo
            // d'occhio se un docente ha una soglia personalizzata e con quale
            // motivazione, sia nella lista che nel dettaglio della proposta.
            'contractType',
            'monteOreAnnualHoursOverride',
            'monteOreBypassDayConstraint',
            'monteOreOverrideReason',
          ],
        },
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
      ],
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
      // distinct=true: conteggio corretto in presenza di N include con
      // associazioni hasMany (schedules). Senza, count gonfia per ogni JOIN.
      distinct: true,
    });
    setPaginationHeaders(res, count, limit, offset);
    res.json({ proposals: rows.map(serializeProposal) });
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
          attributes: [
            'id',
            'firstName',
            'lastName',
            'email',
            'role',
            'matricola',
            'courseId',
            // Campi deroga Monte Ore: l'admin deve poter vedere a colpo
            // d'occhio se un docente ha una soglia personalizzata e con quale
            // motivazione, sia nella lista che nel dettaglio della proposta.
            'contractType',
            'monteOreAnnualHoursOverride',
            'monteOreBypassDayConstraint',
            'monteOreOverrideReason',
          ],
        },
        {
          model: MonteOreSchedule,
          as: 'schedules',
          include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
        },
        { model: MonteOreSlot, as: 'slots' },
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

// Keep administrative pattern changes and the selected grid in the same transaction.
async function editAdminSchedule(req, action) {
  return workflow.transact(async (transaction) => {
    const plan = await workflow.loadPlan(Number(req.params.id), transaction, true);
    if (plan.proposal.status === 'generated')
      workflow.fail(
        'Esegui prima "Annulla generazione" oppure usa la rivalidazione',
        'INVALID_STATE',
      );
    let schedule;
    if (action === 'create') {
      const data = sanitizeSchedule(req.body);
      if (!data.bookingType) data.bookingType = 'lezione';
      if (data.dayOfWeek === undefined || !data.startTime || !data.endTime)
        workflow.fail('dayOfWeek, startTime, endTime sono obbligatori');
      schedule = await MonteOreSchedule.create(
        { proposalId: plan.proposal.id, ...data },
        { transaction },
      );
    } else {
      schedule = plan.schedules.find((s) => s.id === Number(req.params.sid));
      if (!schedule) workflow.fail('Riga non trovata', 'NOT_FOUND', 404);
      if (action === 'delete') {
        if (
          plan.slots.some((s) => s.scheduleId === schedule.id && s.isActive) &&
          req.body.confirmRemoval !== true
        )
          workflow.fail(
            'La fascia contiene date selezionate. Riporta il piano in bozza e deselezionale prima di eliminarla.',
            'ACTIVE_SCHEDULE',
            409,
          );
        await schedule.destroy({ transaction });
      } else await schedule.update(sanitizeSchedule(req.body), { transaction });
    }
    if (plan.settings) {
      const result = await slotService.regenerateSlotsFromPattern(plan.proposal.id, {
        transaction,
        confirmRemoval: req.body.confirmRemoval === true,
      });
      if (result.requiresConfirmation)
        workflow.fail(
          `La modifica rimuoverebbe ${result.removedActive.length} date selezionate. Riporta il piano in bozza per rivedere la selezione.`,
          'ACTIVE_SCHEDULE',
          409,
        );
    }
    await plan.proposal.update({ revision: plan.proposal.revision + 1 }, { transaction });
    return schedule;
  });
}

adminRouter.patch(
  '/:id/schedules/:sid',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const schedule = await editAdminSchedule(req, 'update');
      res.json({ schedule: schedule.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);
adminRouter.post('/:id/schedules', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const schedule = await editAdminSchedule(req, 'create');
    res.status(201).json({ schedule: schedule.toJSON() });
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
      await editAdminSchedule(req, 'delete');
      res.json({ message: 'Riga eliminata' });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get('/:id/preview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await workflow.preview(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/:id/preview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await workflow.preview(Number(req.params.id), req.body.assignments || []));
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const proposal = await workflow.approvePlan(
      Number(req.params.id),
      req.user,
      req.body.assignments || [],
    );
    res.json({ proposal });
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
    // includePast (opzionale, body): se true il generator materializza anche
    // le occorrenze già trascorse — usato per AA arretrati o ricostruzione
    // storico contabile. Default false: si genera solo dal momento in poi.
    const includePast = req.body?.includePast === true;
    const existing = await MonteOreProposal.findByPk(req.params.id);
    const settings =
      existing &&
      (await MonteOreSettings.findOne({ where: { academicYear: existing.academicYear } }));
    const result = settings
      ? await workflow
          .approvePlan(Number(req.params.id), req.user)
          .then((p) => ({ created: p.generationSummary.created, skipped: [], errors: [] }))
      : await monteOreService.generateBookingsForProposal(Number(req.params.id), {
          actorUser: req.user,
          includePast,
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
    // Atomico: clear booking + status update. Se crash a metà, lo stato resta
    // 'generated' coerente. Senza tx, restavano booking cancellati ma
    // proposta ancora in 'generated' → impossibile rigenerare.
    const result = await sequelize.transaction(async (t) => {
      const proposal = await MonteOreProposal.findByPk(req.params.id, { transaction: t });
      if (!proposal) {
        const e = new Error('Proposta non trovata');
        e.status = 404;
        throw e;
      }
      if (proposal.status !== 'generated') {
        const e = new Error('Solo generated può essere unlocked');
        e.status = 400;
        e.code = 'INVALID_STATE';
        throw e;
      }
      const cleared = await monteOreService.clearGeneratedBookings(Number(req.params.id), {
        transaction: t,
      });
      await proposal.update(
        { status: 'approved', generatedAt: null, generationSummary: null },
        { transaction: t },
      );
      return { proposal, cleared };
    });
    res.json({ proposal: result.proposal.toJSON(), cleared: result.cleared });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * Fase 6.4 — l'admin riporta una proposta in 'draft' per chiedere al docente
 * di modificarla. Ammesso solo per submitted/approved: per 'generated' va
 * fatto prima l'unlock (che cancella i Booking) e poi questo endpoint.
 *
 * Reset di tutti i campi di workflow (approvedAt, rejectedAt, ...) così che
 * il prossimo submit ricalcoli snapshot soglie/giorni a partire da zero.
 * `revalidationReason` è valorizzato con la motivazione dell'admin.
 */
adminRouter.post(
  '/:id/revert-to-draft',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const proposal = await MonteOreProposal.findByPk(req.params.id);
      if (!proposal) return res.status(404).json({ error: 'Proposta non trovata' });
      if (!['submitted', 'approved'].includes(proposal.status)) {
        if (proposal.status === 'generated') {
          return res.status(400).json({
            error: 'Esegui prima "Annulla generazione" per riportare la proposta in draft',
            code: 'INVALID_STATE',
          });
        }
        return res.status(400).json({
          error: 'Solo submitted o approved possono tornare in draft',
          code: 'INVALID_STATE',
        });
      }
      const reason = req.body?.reason
        ? String(req.body.reason).trim().slice(0, 500)
        : "Richiesta modifica dall'amministrazione";
      await proposal.update({
        status: 'draft',
        submittedAt: null,
        approvedAt: null,
        rejectedAt: null,
        approverId: null,
        rejectionReason: null,
        coordinatorNotes: null,
        requiresRevalidation: true,
        revalidationReason: reason,
      });
      res.json({ proposal: proposal.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);

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
    res.json({ amendments: await serializeAmendments(items) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/:id/revalidate', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const amendment = await workflow.decideAmendment(Number(req.params.id), null, req.user, {
      administrative: true,
      operations: req.body.operations,
      reason: req.body.reason,
    });
    res.json({ amendment });
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
      let operations = req.body.operations;
      if (!operations && req.body.roomId) {
        const a = await MonteOreAmendment.findOne({
          where: { id: req.params.aid, proposalId: req.params.id },
        });
        if (a)
          operations = (
            a.operations || [{ kind: a.kind, slotId: a.slotId, payload: a.payload }]
          ).map((op) => ({ ...op, payload: { ...op.payload, roomId: Number(req.body.roomId) } }));
      }
      const amendment = await workflow.decideAmendment(
        Number(req.params.id),
        Number(req.params.aid),
        req.user,
        {
          operations,
          reason: req.body.reason || (req.body.roomId ? 'Aula assegnata dal revisore' : undefined),
        },
      );
      res.json({ amendment });
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
      const amendment = await workflow.decideAmendment(
        Number(req.params.id),
        Number(req.params.aid),
        req.user,
        { reject: true, reason: req.body.reason },
      );
      res.json({ amendment });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = { router, adminRouter };
