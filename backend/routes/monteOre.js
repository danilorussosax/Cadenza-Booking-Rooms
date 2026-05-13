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
const { Op, Transaction } = require('sequelize');
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
const slotService = require('../services/monteOreSlotService');
const calendarService = require('../services/monteOreCalendarService');
const { resolveAnnualThreshold } = require('../services/monteOreThresholdService');
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
    res.json({ academicYear: year, ...resolved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

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
    // Validazione finestra di inserimento (configurabile da admin) +
    // deroga individuale (User.monteOreSubmissionAllowedUntil) per docenti
    // subentrati in corso d'anno o casi autorizzati dalla Direzione.
    if (!(await isWithinSubmissionWindow(year, req.user))) {
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
    let bypassDayConstraint = false;
    let thresholdSource = 'default';
    if (settings) {
      // Risoluzione soglia per-docente: se l'admin ha impostato un override
      // individuale (es. contratto orario 60h), quello vince sulla soglia
      // istituzionale. Stessa logica per il bypass del vincolo 2-4 giorni.
      const resolved = await resolveAnnualThreshold(req.user.id, year);
      minRequired = resolved.minHours;
      bypassDayConstraint = resolved.bypassDayConstraint;
      thresholdSource = resolved.source;

      if (!bypassDayConstraint && (distinctDays.size < 2 || distinctDays.size > 4)) {
        return res.status(400).json({
          error:
            `Il monte ore richiede da 2 a 4 giorni lavorativi a settimana ` +
            `(impostati: ${distinctDays.size}). ` +
            `Per docenti a contratto orario richiedi all'admin la deroga.`,
          code: 'WORKING_DAYS_OUT_OF_RANGE',
        });
      }
      totalHours = await slotService.recomputeTotals(proposal.id);
      if (totalHours < minRequired) {
        const sourceMsg =
          thresholdSource === 'user_override'
            ? 'Soglia personalizzata per il tuo contratto.'
            : 'Soglia istituzionale.';
        return res.status(400).json({
          error:
            `Il monte ore deve essere almeno di ${minRequired} ore ` +
            `(attuali: ${totalHours.toFixed(1)} h). ${sourceMsg}`,
          code: 'HOURS_BELOW_THRESHOLD',
        });
      }
    }
    const updates = {
      status: 'submitted',
      submittedAt: new Date(),
    };
    if (settings) {
      // workingDaysCount: in modalità bypass (contratto orario monoday) può
      // essere 1, fuori dal validator min:2 max:5 del model → lasciamo null.
      updates.workingDaysCount = bypassDayConstraint ? null : distinctDays.size;
      updates.totalHoursRequested = totalHours;
      // Snapshot del valore RISOLTO (override o istituzionale): se domani
      // l'admin rimuove l'override, la proposta già submitted resta valida
      // con la soglia originale.
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
    // Atomico: destroy + bulkCreate + recomputeTotals in una sola transazione.
    // Senza tx un crash a metà lasciava la proposta con metà degli slot persi.
    const result = await sequelize.transaction(async (t) =>
      slotService.regenerateSlotsFromPattern(proposal.id, { transaction: t }),
    );
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
      // Tutto in transazione (SERIALIZABLE su Postgres per evitare race su
      // amendmentCount; default su SQLite/MySQL che non lo supportano nativamente).
      // withSerializableRetry gestisce il 40001 (serialization_failure) di Postgres
      // con backoff esponenziale.
      const txOpts =
        sequelize.getDialect() === 'postgres'
          ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
          : {};
      const { withSerializableRetry } = require('../lib/serializableTx');
      const result = await withSerializableRetry(sequelize, txOpts, async (t) => {
        const p = await MonteOreProposal.findByPk(slot.proposalId, { transaction: t });
        const s = await MonteOreSlot.findByPk(slot.id, { transaction: t });
        const kind = s.isActive ? 'toggle_off' : 'toggle_on';
        // Le deselezioni (toggle_off) liberano ore e non consumano il budget
        // annuale di variazioni: il counter sale solo sulle aggiunte.
        const consumesBudget = kind !== 'toggle_off';
        let maxAmend = 3;
        if (consumesBudget) {
          const settings = await MonteOreSettings.findOne({
            where: { academicYear: p.academicYear },
            transaction: t,
          });
          maxAmend = settings?.maxAmendmentsPerYear ?? 3;
        }
        const decided = slotService.classifyAmendment(s, kind);
        const amendment = await MonteOreAmendment.create(
          {
            proposalId: p.id,
            requesterId: req.user.id,
            slotId: s.id,
            kind,
            payload: { from: s.isActive, to: !s.isActive },
            status: decided,
            requestNotes: req.body.notes ?? null,
            decidedAt: decided === 'auto_approved' ? new Date() : null,
          },
          { transaction: t },
        );
        if (decided === 'auto_approved') {
          if (consumesBudget) {
            // Atomic conditional increment: cross-dialect race-safe (no
            // dipendenza da SERIALIZABLE). Se affected=0 il limite è già
            // stato raggiunto (concorrentemente o prima).
            const qcol =
              sequelize.getDialect() === 'mysql' ? '`amendmentCount`' : '"amendmentCount"';
            const [affected] = await MonteOreProposal.update(
              { amendmentCount: sequelize.literal(`${qcol} + 1`) },
              {
                where: {
                  id: p.id,
                  amendmentCount: { [Op.lt]: maxAmend },
                },
                transaction: t,
              },
            );
            if (affected === 0) {
              const e = new Error(
                `Hai raggiunto il limite di ${maxAmend} richieste di variazione per l'anno`,
              );
              e.status = 400;
              e.code = 'AMENDMENT_LIMIT_REACHED';
              throw e;
            }
          }
          await slotService.toggleSlot(s.id, { force: true, transaction: t });
          // Sync booking↔slot solo se la proposta è 'generated' (i booking
          // sono già stati materializzati). In 'approved' lo slot toggle
          // basta — il generator userà il nuovo isActive al prossimo run.
          if (p.status === 'generated') {
            await slotService.syncBookingForSlot(s.id, {
              actorUser: { id: req.user.id, role: 'admin' },
              transaction: t,
            });
          }
        }
        await s.reload({ transaction: t });
        return { amendment, slot: s };
      });
      return res
        .status(201)
        .json({ amendment: result.amendment.toJSON(), slot: result.slot.toJSON() });
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

    // Verifica limite annuale prima di creare l'amendment
    const settings = await MonteOreSettings.findOne({
      where: { academicYear: proposal.academicYear },
    });
    const maxAmend = settings?.maxAmendmentsPerYear ?? 3;
    if ((proposal.amendmentCount || 0) >= maxAmend) {
      return res.status(400).json({
        error: `Hai raggiunto il limite di ${maxAmend} richieste di variazione per l'anno`,
        code: 'AMENDMENT_LIMIT_REACHED',
      });
    }

    const amendment = await MonteOreAmendment.create({
      proposalId: proposal.id,
      requesterId: req.user.id,
      slotId: null,
      kind: 'add_new_day',
      payload: {
        date: isoDate,
        startTime: sT,
        endTime: eT,
        roomId: roomIdNum, // null se non specificata: la assegnerà l'admin
        bookingType: bookingType ? String(bookingType).slice(0, 40) : 'lezione',
        purpose: purpose ? String(purpose).slice(0, 255) : null,
      },
      status: 'pending',
      requestNotes: notes ? String(notes).slice(0, 2000) : null,
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
 * annuale, applica subito la modifica se decisione=auto_approved.
 * Le mutazioni concrete (update slot, sync booking, …) sono lasciate al
 * callback `applyFn`. Tutto in transazione.
 */
async function createAndApplyAmendment({
  req,
  proposal,
  slot,
  kind,
  payload,
  decision,
  consumesBudget,
  applyFn,
}) {
  const txOpts =
    sequelize.getDialect() === 'postgres'
      ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
      : {};
  const { withSerializableRetry } = require('../lib/serializableTx');
  return withSerializableRetry(sequelize, txOpts, async (t) => {
    let maxAmend = 3;
    if (consumesBudget) {
      const settings = await MonteOreSettings.findOne({
        where: { academicYear: proposal.academicYear },
        transaction: t,
      });
      maxAmend = settings?.maxAmendmentsPerYear ?? 3;
    }
    const amendment = await MonteOreAmendment.create(
      {
        proposalId: proposal.id,
        requesterId: req.user.id,
        slotId: slot.id,
        kind,
        payload,
        status: decision,
        requestNotes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : null,
        decidedAt: decision === 'auto_approved' ? new Date() : null,
      },
      { transaction: t },
    );
    if (decision === 'auto_approved' && consumesBudget) {
      const qcol = sequelize.getDialect() === 'mysql' ? '`amendmentCount`' : '"amendmentCount"';
      const [affected] = await MonteOreProposal.update(
        { amendmentCount: sequelize.literal(`${qcol} + 1`) },
        {
          where: { id: proposal.id, amendmentCount: { [Op.lt]: maxAmend } },
          transaction: t,
        },
      );
      if (affected === 0) {
        const e = new Error(
          `Hai raggiunto il limite di ${maxAmend} richieste di variazione per l'anno`,
        );
        e.status = 400;
        e.code = 'AMENDMENT_LIMIT_REACHED';
        throw e;
      }
    }
    if (decision === 'auto_approved') {
      await applyFn(t);
    }
    return amendment;
  });
}

/**
 * POST /api/monte-ore/me/slots/:id/change-time
 * Cambia l'orario di UN'occorrenza ricorrente (lascia il pattern intatto).
 * Body: { startTime?: "HH:MM", endTime?: "HH:MM", notes?: string }
 * Auto-approve se lo slot era originalmente attivo (originalActive=true);
 * altrimenti pending al coordinatore.
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
    const decision = slotService.classifyAmendment(slot, 'change_time');
    const amendment = await createAndApplyAmendment({
      req,
      proposal,
      slot,
      kind: 'change_time',
      payload: { startTime: finalStart, endTime: finalEnd },
      decision,
      consumesBudget: true,
      applyFn: async (t) => {
        await slot.update({ startTime: finalStart, endTime: finalEnd }, { transaction: t });
        if (proposal.status === 'generated') {
          await slotService.syncBookingForSlot(slot.id, {
            actorUser: { id: req.user.id, role: 'admin' },
            transaction: t,
          });
        }
      },
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
      decision: 'pending',
      consumesBudget: false, // budget verrà incrementato all'approve
      applyFn: async () => {}, // pending: nessuna applicazione immediata
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
 * Auto-approve se sia source sia target sono in pattern (scheduleId valorizzati);
 * pending altrimenti (es. target è uno slot fuori pattern di add_new_day).
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
    const decision = slotService.classifyAmendment(source, 'move_to', { targetSlot: target });
    const amendment = await createAndApplyAmendment({
      req,
      proposal,
      slot: source,
      kind: 'move_to',
      payload: { targetSlotId: target.id, sourceDate: source.date, targetDate: target.date },
      decision,
      consumesBudget: true,
      applyFn: async (t) => {
        await source.update({ isActive: false }, { transaction: t });
        await target.update({ isActive: true }, { transaction: t });
        await slotService.recomputeTotals(proposal.id, { transaction: t });
        if (proposal.status === 'generated') {
          // Source: lo slot ora isActive=false → syncBookingForSlot cancella il booking.
          await slotService.syncBookingForSlot(source.id, {
            actorUser: { id: req.user.id, role: 'admin' },
            transaction: t,
          });
          // Target: lo slot ora isActive=true → syncBookingForSlot crea il booking.
          await slotService.syncBookingForSlot(target.id, {
            actorUser: { id: req.user.id, role: 'admin' },
            transaction: t,
          });
        }
      },
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
    const result = await bootstrapAcademicYear({
      academicYear,
      mode: mode === 'from_previous' ? 'from_previous' : 'default',
      previousYear: previousYear || null,
      overwrite: !!overwrite,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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

    const susp = await MonteOreSuspension.create({
      instituteId,
      academicYear: year,
      name: data.name,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      kind: 'partial',
      category: 'exam_session',
      notes: data.notes || null,
    });
    res.status(201).json({ examSession: susp.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
      await susp.update(patch);
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
      await susp.destroy();
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

    // Atomico: o entrambi (exception + suspension) sono creati, o nessuno —
    // così non restano BookingRuleException orfane se la suspension fallisce.
    const susp = await sequelize.transaction(async (t) => {
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
      // Cancella prima l'exception linkata (se presente), poi la suspension.
      if (susp.bookingRuleExceptionId) {
        await BookingRuleException.destroy({ where: { id: susp.bookingRuleExceptionId } });
      }
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
    // Atomico: status approved + snapshotOriginalActive in una sola
    // transazione. Se crash a metà, niente è scritto → l'admin riprova.
    const proposal = await sequelize.transaction(async (t) => {
      const p = await MonteOreProposal.findByPk(req.params.id, { transaction: t });
      if (!p) {
        const e = new Error('Proposta non trovata');
        e.status = 404;
        throw e;
      }
      if (!['submitted', 'rejected'].includes(p.status)) {
        const e = new Error('Solo submitted/rejected possono essere approvate');
        e.status = 400;
        e.code = 'INVALID_STATE';
        throw e;
      }
      await p.update(
        {
          status: 'approved',
          approvedAt: new Date(),
          approverId: req.user.id,
          rejectedAt: null,
          rejectionReason: null,
          coordinatorNotes: req.body.notes ?? p.coordinatorNotes,
        },
        { transaction: t },
      );
      // Congela isActive → originalActive: serve a classifyAmendment per
      // distinguere modifiche su giorni "già nel piano" (auto-approve) da
      // riattivazione/aggiunta di giorni nuovi (pending).
      await slotService.snapshotOriginalActive(p.id, { transaction: t });
      return p;
    });
    res.json({ proposal: proposal.toJSON() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
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
    const result = await monteOreService.generateBookingsForProposal(Number(req.params.id), {
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
      // Atomico in transazione: lookup + update slot + update amendment +
      // increment amendmentCount + recompute totali. Senza transazione,
      // un crash tra slot.update e amendment.update lasciava lo slot
      // modificato ma l'amendment ancora 'pending'.
      const amendment = await sequelize.transaction(async (t) => {
        const proposal = await MonteOreProposal.findByPk(req.params.id, { transaction: t });
        if (!proposal) {
          const e = new Error('Proposta non trovata');
          e.status = 404;
          throw e;
        }
        const a = await MonteOreAmendment.findOne({
          where: { id: req.params.aid, proposalId: proposal.id },
          transaction: t,
        });
        if (!a) {
          const e = new Error('Variazione non trovata');
          e.status = 404;
          throw e;
        }
        if (a.status !== 'pending') {
          const e = new Error('Variazione già decisa');
          e.status = 400;
          e.code = 'INVALID_STATE';
          throw e;
        }
        // Le deselezioni non consumano il budget annuale; il limite si
        // applica solo alle aggiunte (toggle_on, add_new_day, change_time).
        const consumesBudget = a.kind !== 'toggle_off';
        let maxAmend = 3;
        if (consumesBudget) {
          const settings = await MonteOreSettings.findOne({
            where: { academicYear: proposal.academicYear },
            transaction: t,
          });
          maxAmend = settings?.maxAmendmentsPerYear ?? 3;
          // Check rapido fail-fast: il check atomico finale è nell'UPDATE qui sotto.
          if ((proposal.amendmentCount || 0) >= maxAmend) {
            const e = new Error(
              `Limite di ${maxAmend} variazioni per AA raggiunto: rifiuta o sblocca le pending`,
            );
            e.status = 400;
            e.code = 'AMENDMENT_LIMIT_REACHED';
            throw e;
          }
        }
        // Applica la modifica allo slot bersaglio
        if (a.slotId) {
          const slot = await MonteOreSlot.findByPk(a.slotId, { transaction: t });
          if (slot) {
            if (a.kind === 'toggle_off' || a.kind === 'toggle_on') {
              await slot.update({ isActive: a.kind === 'toggle_on' }, { transaction: t });
            } else if (a.kind === 'change_time' && a.payload) {
              const upd = {};
              if (a.payload.startTime) upd.startTime = String(a.payload.startTime).slice(0, 5);
              if (a.payload.endTime) upd.endTime = String(a.payload.endTime).slice(0, 5);
              await slot.update(upd, { transaction: t });
            } else if (a.kind === 'change_room' && a.payload?.roomId) {
              // Override aula sul singolo slot: pattern e altre settimane
              // restano invariate (lo slot ha priorità su schedule.roomId).
              await slot.update({ roomId: Number(a.payload.roomId) }, { transaction: t });
            } else if (a.kind === 'move_to' && a.payload?.targetSlotId) {
              const target = await MonteOreSlot.findByPk(Number(a.payload.targetSlotId), {
                transaction: t,
              });
              if (!target || target.proposalId !== proposal.id) {
                const e = new Error('Slot target non valido');
                e.status = 400;
                e.code = 'TARGET_NOT_FOUND';
                throw e;
              }
              if (target.isLocked || target.isActive) {
                const e = new Error('Slot target non disponibile');
                e.status = 400;
                e.code = 'TARGET_NOT_AVAILABLE';
                throw e;
              }
              await slot.update({ isActive: false }, { transaction: t });
              await target.update({ isActive: true }, { transaction: t });
              if (proposal.status === 'generated') {
                await slotService.syncBookingForSlot(target.id, {
                  actorUser: { id: req.user.id, role: 'admin' },
                  transaction: t,
                });
              }
            }
            // Sync booking↔slot in stato 'generated': cancella o ricrea il
            // Booking corrispondente in coerenza con la decisione admin.
            if (proposal.status === 'generated') {
              await slotService.syncBookingForSlot(a.slotId, {
                actorUser: { id: req.user.id, role: 'admin' },
                transaction: t,
              });
            }
          }
        } else if (a.kind === 'add_new_day' && a.payload) {
          // Variazione "add_new_day": crea lo slot fuori-pattern (scheduleId
          // NULL) e, se la proposta è già generated, materializza il booking
          // via syncBookingForSlot (che legge le info dai campi sullo slot).
          //
          // L'admin può fornire/sovrascrivere il roomId in fase di approvazione
          // (req.body.roomId): è obbligatorio se il docente non l'aveva
          // indicato; opzionalmente sovrascrive la preferenza del docente.
          const p = a.payload;
          if (!p.date || !p.startTime || !p.endTime) {
            const e = new Error('Payload add_new_day incompleto');
            e.status = 400;
            throw e;
          }
          const overrideRoomId =
            req.body &&
            req.body.roomId !== undefined &&
            req.body.roomId !== null &&
            req.body.roomId !== ''
              ? Number(req.body.roomId)
              : null;
          const finalRoomId = overrideRoomId ?? (p.roomId ? Number(p.roomId) : null);
          if (!finalRoomId) {
            const e = new Error(
              'Aula obbligatoria per approvare: il docente non ne ha indicata una',
            );
            e.status = 400;
            e.code = 'ROOM_REQUIRED';
            throw e;
          }
          const dow = dayjs(p.date).day();
          const newSlot = await MonteOreSlot.create(
            {
              proposalId: proposal.id,
              scheduleId: null,
              date: String(p.date).slice(0, 10),
              dayOfWeek: dow,
              startTime: String(p.startTime).slice(0, 5),
              endTime: String(p.endTime).slice(0, 5),
              isActive: true,
              isLocked: false,
              originalActive: false,
              roomId: finalRoomId,
              bookingType: p.bookingType || 'lezione',
              purpose: p.purpose || null,
            },
            { transaction: t },
          );
          // Linka l'amendment allo slot creato; se l'admin ha sovrascritto
          // l'aula, salviamo il valore finale anche nel payload per traccia.
          const updatedPayload = overrideRoomId
            ? { ...p, roomId: finalRoomId, roomIdAssignedBy: 'admin' }
            : p;
          await a.update({ slotId: newSlot.id, payload: updatedPayload }, { transaction: t });
          if (proposal.status === 'generated') {
            await slotService.syncBookingForSlot(newSlot.id, {
              actorUser: { id: req.user.id, role: 'admin' },
              transaction: t,
            });
          }
        }
        await a.update(
          { status: 'approved', decidedAt: new Date(), decidedBy: req.user.id },
          { transaction: t },
        );
        await slotService.recomputeTotals(proposal.id, { transaction: t });
        // Increment atomico CON check del limite nello stesso UPDATE: se due
        // approvazioni concorrenti tentano di superare maxAmend, solo una
        // affected=1; l'altra ottiene affected=0 e fallisce qui sotto.
        if (consumesBudget) {
          const qcol = sequelize.getDialect() === 'mysql' ? '`amendmentCount`' : '"amendmentCount"';
          const [affected] = await MonteOreProposal.update(
            { amendmentCount: sequelize.literal(`${qcol} + 1`) },
            {
              where: { id: proposal.id, amendmentCount: { [Op.lt]: maxAmend } },
              transaction: t,
            },
          );
          if (affected === 0) {
            const e = new Error(
              `Limite di ${maxAmend} variazioni per AA raggiunto: rifiuta o sblocca le pending`,
            );
            e.status = 400;
            e.code = 'AMENDMENT_LIMIT_REACHED';
            throw e;
          }
        }
        return a;
      });
      res.json({ amendment: amendment.toJSON() });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
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
