'use strict';

/**
 * Monte Ore — service di generazione delle prenotazioni ricorrenti a
 * partire dalle righe schedule approvate dal coordinatore.
 *
 * Per ogni `MonteOreSchedule` espande in una serie di `Booking` confermati,
 * uno per ogni occorrenza valida del giorno della settimana nel range
 * [validFrom, validTo] della proposta. Le occorrenze in conflitto o cadute
 * in date escluse (festività, exception block, vacanze custom) vengono
 * SKIPPATE — non bloccanti, ritornate in summary per audit.
 *
 * Il generator NON crea Booking per giorni non lavorativi se la
 * BookingRuleException applicabile li blocca; usa la stessa
 * `validateBooking` del flusso di prenotazione manuale, garantendo
 * coerenza con tutte le regole esistenti (quote, vincoli aula, ecc.).
 *
 * Pattern di ritorno (per audit + UI):
 *   {
 *     created: number,
 *     skipped: { date, reason }[],
 *     errors:  { date, message }[],
 *     bookingIds: number[],
 *   }
 *
 * Idempotenza: prima di rigenerare bisogna invocare
 * `clearGeneratedBookings(proposalId)` per cancellare i Booking precedenti.
 */

const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const { Op } = require('sequelize');
const { sequelize, Booking, MonteOreProposal, MonteOreSchedule, User, Room } = require('../models');
const { validateBooking } = require('./bookingValidator');

dayjs.extend(isoWeek);

const WRITE_ISOLATION = sequelize.Transaction?.ISOLATION_LEVELS?.SERIALIZABLE || undefined;

// Helper: combina YYYY-MM-DD + HH:MM → Date locale
function combine(dateOnly, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return dayjs(dateOnly).hour(h).minute(m).second(0).millisecond(0).toDate();
}

/**
 * Itera tutte le date in [from, to] che cadono nel `dayOfWeek` indicato
 * e non sono nell'array `excludeDates` (formato "YYYY-MM-DD").
 */
function* iterateOccurrences(from, to, dayOfWeek, excludeDates = []) {
  const exclude = new Set((excludeDates || []).map((d) => String(d).slice(0, 10)));
  let cursor = dayjs(from).startOf('day');
  const end = dayjs(to).endOf('day');
  // Allinea cursor al primo `dayOfWeek` >= from
  while (cursor.day() !== dayOfWeek && cursor.isBefore(end)) {
    cursor = cursor.add(1, 'day');
  }
  // Itera di settimana in settimana
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const iso = cursor.format('YYYY-MM-DD');
    if (!exclude.has(iso)) yield iso;
    cursor = cursor.add(7, 'day');
  }
}

/**
 * Cancella i Booking generati da una proposta `generated`. Usata prima
 * di rigenerare (es. dopo modifica di una riga schedule).
 *
 * Per coerenza con il check-in, NON elimina i Booking già consumati
 * (passati con checkedInAt valorizzato) — si limita a quelli ancora
 * confermati e nel futuro.
 */
async function clearGeneratedBookings(proposalId, { transaction = null } = {}) {
  const tx = transaction ? { transaction } : {};
  const schedules = await MonteOreSchedule.findAll({
    where: { proposalId },
    ...tx,
  });
  const allIds = schedules.flatMap((s) =>
    Array.isArray(s.generatedBookingIds) ? s.generatedBookingIds : [],
  );
  if (allIds.length === 0) return { cleared: 0 };

  const now = new Date();
  const cleared = await Booking.update(
    { status: 'cancelled', cancelledAt: now, cancelReason: 'Rigenerazione monte ore' },
    {
      where: {
        id: { [Op.in]: allIds },
        status: 'confirmed',
        checkedInAt: { [Op.is]: null },
        startTime: { [Op.gt]: now },
      },
      ...tx,
    },
  );
  // Reset ids
  for (const s of schedules) {
    await s.update({ generatedBookingIds: [] }, { transaction });
  }
  return { cleared: cleared[0] || 0 };
}

/**
 * Espande tutte le `MonteOreSchedule` di una proposta in `Booking`
 * confermati. Esegue tutto in una transazione SERIALIZABLE: o tutti i
 * Booking creabili passano, o nessuno (ma i giorni con conflitto NON
 * causano rollback — sono skippati come per la POST /recurring).
 */
async function generateBookingsForProposal(proposalId, { actorUser, includePast = false } = {}) {
  const proposal = await MonteOreProposal.findByPk(proposalId, {
    include: [
      { model: User, as: 'user' },
      { model: MonteOreSchedule, as: 'schedules', include: [{ model: Room, as: 'room' }] },
    ],
  });
  if (!proposal) {
    const e = new Error('Proposta non trovata');
    e.status = 404;
    throw e;
  }
  if (!['approved', 'generated'].includes(proposal.status)) {
    const e = new Error('La proposta deve essere approved (o generated) per generare prenotazioni');
    e.status = 400;
    e.code = 'MONTE_ORE_NOT_APPROVED';
    throw e;
  }
  if (!proposal.schedules || proposal.schedules.length === 0) {
    const e = new Error('Nessuna riga schedule da generare');
    e.status = 400;
    throw e;
  }
  // Verifica che TUTTE le righe abbiano un'aula assegnata (campo opzionale
  // in draft, ma obbligatorio per generate)
  const missingRoom = proposal.schedules.find((s) => !s.roomId);
  if (missingRoom) {
    const e = new Error(
      "Tutte le righe devono avere un'aula assegnata prima di generare le prenotazioni",
    );
    e.status = 400;
    e.code = 'MONTE_ORE_MISSING_ROOM';
    throw e;
  }

  const created = [];
  const skipped = [];
  const errors = [];
  const bookingIdsByScheduleId = new Map();

  // Eseguiamo in transazione SERIALIZABLE per coerenza (alcuni DB potrebbero
  // non supportarla → fallback al default).
  const txOpts = WRITE_ISOLATION ? { isolationLevel: WRITE_ISOLATION } : {};
  await sequelize.transaction(txOpts, async (t) => {
    // Se la proposta è già 'generated' e stiamo rigenerando, prima cancella
    // i booking precedenti.
    if (proposal.status === 'generated') {
      await clearGeneratedBookings(proposalId, { transaction: t });
      // Refresh schedules (i generatedBookingIds sono stati azzerati)
      for (const s of proposal.schedules) {
        await s.reload({ transaction: t });
      }
    }

    for (const sched of proposal.schedules) {
      const idsForThis = [];
      for (const dateIso of iterateOccurrences(
        proposal.validFrom,
        proposal.validTo,
        sched.dayOfWeek,
        sched.excludeDates,
      )) {
        const startTime = combine(dateIso, sched.startTime);
        const endTime = combine(dateIso, sched.endTime);
        try {
          const validation = await validateBooking({
            user: proposal.user,
            roomId: sched.roomId,
            startTime,
            endTime,
            type: sched.bookingType,
            // L'admin che genera è il responsabile della validazione globale:
            //   - bypassQuotas: un docente legittimamente può avere 30h/settimana
            //     di lezione, sopra il cap "student-friendly" della rule
            //   - bypassAdvance: il monte ore copre l'intero AA, naturalmente
            //     molte occorrenze sono oltre maxAdvanceDays. La validazione
            //     temporale è già stata fatta dal coordinatore in fase di
            //     approvazione della proposta.
            //   - bypassPastDates: opt-in. Quando l'admin genera a metà AA,
            //     le occorrenze già trascorse sarebbero saltate ("non puoi
            //     prenotare nel passato"). Con `includePast=true` il generator
            //     materializza anche quelle (utile per piani contabili e
            //     storico monte ore già svolto).
            //   - bypassDuration: il pattern del docente può legittimamente
            //     contenere blocchi di 6h consecutive (es. lezioni di
            //     strumento principale), che eccedono il maxBookingDurationMinutes
            //     della rule "docente" (tipicamente 240 min, pensato per
            //     prenotazioni manuali). Il coordinatore ha già approvato la
            //     proposta, quindi le durate sono consentite.
            bypassQuotas: !!actorUser && actorUser.role === 'admin',
            bypassAdvance: !!actorUser && actorUser.role === 'admin',
            bypassPastDates: includePast,
            bypassDuration: !!actorUser && actorUser.role === 'admin',
            transaction: t,
          });
          if (!validation.valid) {
            // I conflitti non sono fatali: skippiamo
            skipped.push({
              date: dateIso,
              scheduleId: sched.id,
              reason: validation.errors[0] || 'validation_failed',
            });
            continue;
          }
          const b = await Booking.create(
            {
              userId: proposal.userId,
              roomId: sched.roomId,
              startTime,
              endTime,
              type: sched.bookingType,
              purpose: sched.purpose || null,
              notes: sched.notes || null,
              status: 'confirmed',
            },
            { transaction: t },
          );
          created.push(b.id);
          idsForThis.push(b.id);
        } catch (err) {
          errors.push({ date: dateIso, scheduleId: sched.id, message: err.message });
        }
      }
      // Salva gli id per questa riga schedule (per supportare un eventuale
      // clear/regen futuro)
      await sched.update({ generatedBookingIds: idsForThis }, { transaction: t });
      bookingIdsByScheduleId.set(sched.id, idsForThis);
    }

    // Aggiorna proposta: stato + summary
    const summary = {
      created: created.length,
      skipped: skipped.length,
      errors: errors.length,
      details: { skipped, errors },
    };
    await proposal.update(
      {
        status: 'generated',
        generatedAt: new Date(),
        approverId: actorUser?.id ?? proposal.approverId,
        generationSummary: summary,
      },
      { transaction: t },
    );
  });

  return {
    created: created.length,
    skipped,
    errors,
    bookingIds: created,
  };
}

module.exports = {
  generateBookingsForProposal,
  clearGeneratedBookings,
  iterateOccurrences,
};
