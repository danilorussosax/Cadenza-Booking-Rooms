'use strict';

/**
 * Scheduler periodico (5 min): gestisce due famiglie di notifiche.
 *
 *  1) tickBookings()
 *     Prenotazioni aule confermate che iniziano nei prossimi 55-65 min
 *     e che non hanno ancora ricevuto il promemoria → invia email reminder.
 *
 *  2) tickLoans()
 *     Prestiti strumenti:
 *       - reminder 2gg prima: status='active', toDate ∈ [today+1, today+2],
 *         reminderSentAt=null  →  invia loan_reminder + setReminderSentAt.
 *       - overdue: status='active' e toDate < today, overdueNotifiedAt=null
 *         →  status='overdue', invia loan_overdue + setOverdueNotifiedAt.
 *
 *  Entrambi i tick sono no-op se SMTP non è configurato.
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { Booking, User, Room, Building, InstrumentLoan, Instrument } = require('../models');
const { sendBookingEmail, emailEnabled } = require('./emailService');
const { sendInstrumentLoanEmail } = require('./instrumentLoanEmail');

const TICK_MS = 5 * 60 * 1000; // 5 minuti
const WINDOW_BEFORE_MS = 65 * 60 * 1000; // fino a 65 min nel futuro
const WINDOW_AFTER_MS = 55 * 60 * 1000; // almeno 55 min nel futuro
// Reminder prestiti: 2 giorni prima (intervallo [+1, +2] giorni rispetto a oggi).
const LOAN_REMINDER_DAYS_AHEAD = 2;

let timer = null;

async function tick() {
  if (!(await emailEnabled())) return;
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WINDOW_BEFORE_MS);
    const windowStart = new Date(now.getTime() + WINDOW_AFTER_MS);
    const due = await Booking.findAll({
      where: {
        status: 'confirmed',
        reminderSentAt: null,
        startTime: { [Op.gte]: windowStart, [Op.lte]: windowEnd },
      },
      include: [
        { model: User, as: 'user' },
        {
          model: Room,
          as: 'room',
          include: [{ model: Building, as: 'building' }],
        },
      ],
    });
    for (const bk of due) {
      // Salta utenti senza email o con notifiche globali/promemoria disattivate.
      // In ogni caso marca reminderSentAt per non riconsiderare la prenotazione.
      if (!bk.user || bk.user.emailNotifications === false || bk.user.notifyOnReminder === false) {
        await bk.update({ reminderSentAt: now });
        continue;
      }
      await sendBookingEmail({ user: bk.user, booking: bk, kind: 'reminder' });
      await bk.update({ reminderSentAt: now });
    }
    if (due.length > 0) {
      console.log(`[reminder] ${due.length} promemoria inviati`);
    }
  } catch (err) {
    console.error('[reminder] errore tick:', err.message);
  }
}

// =========================================================
// Tick prestiti strumenti — reminder + overdue
// =========================================================
async function tickLoans() {
  if (!(await emailEnabled())) return;
  const today = dayjs().startOf('day');
  const minRemind = today.add(1, 'day').format('YYYY-MM-DD'); // domani
  const maxRemind = today.add(LOAN_REMINDER_DAYS_AHEAD, 'day').format('YYYY-MM-DD');
  const todayStr = today.format('YYYY-MM-DD');

  try {
    // ---- Reminder 2gg prima ----
    const due = await InstrumentLoan.findAll({
      where: {
        status: 'active',
        reminderSentAt: null,
        toDate: { [Op.between]: [minRemind, maxRemind] },
      },
      include: [
        { model: User, as: 'user' },
        { model: Instrument, as: 'instrument' },
      ],
    });
    for (const loan of due) {
      if (!loan.user) {
        await loan.update({ reminderSentAt: new Date() });
        continue;
      }
      await sendInstrumentLoanEmail({ user: loan.user, loan, kind: 'loan_reminder' });
      await loan.update({ reminderSentAt: new Date() });
    }
    if (due.length > 0) {
      console.log(`[reminder][loans] ${due.length} promemoria scadenza inviati`);
    }

    // ---- Overdue (toDate < oggi, ancora active, mai notificato) ----
    const overdue = await InstrumentLoan.findAll({
      where: {
        status: 'active',
        overdueNotifiedAt: null,
        toDate: { [Op.lt]: todayStr },
      },
      include: [
        { model: User, as: 'user' },
        { model: Instrument, as: 'instrument' },
      ],
    });
    for (const loan of overdue) {
      await loan.update({ status: 'overdue', overdueNotifiedAt: new Date() });
      if (!loan.user) continue;
      const refreshed = await InstrumentLoan.findByPk(loan.id, {
        include: [
          { model: User, as: 'user' },
          { model: Instrument, as: 'instrument' },
        ],
      });
      await sendInstrumentLoanEmail({
        user: refreshed.user,
        loan: refreshed,
        kind: 'loan_overdue',
      });
    }
    if (overdue.length > 0) {
      console.log(`[reminder][loans] ${overdue.length} prestiti marcati overdue + notificati`);
    }
  } catch (err) {
    console.error('[reminder][loans] errore tick:', err.message);
  }
}

// =========================================================
// Tick ghost-cancel: cancella le prenotazioni senza check-in
// =========================================================
//
// Trova prenotazioni:
//   - status='confirmed', checkedInAt=null, autoCancelledAt=null
//   - startTime + GHOST_GRACE_MINUTES < now
//
// Le marca: status='cancelled', cancelReason='auto: ghost booking',
// autoCancelledAt=now. Se l'invio email è attivo manda kind='ghost_cancellation'.
const GHOST_GRACE_MINUTES = Math.max(1, Number(process.env.GHOST_GRACE_MINUTES) || 15);

async function tickGhostCancel() {
  try {
    const cutoff = dayjs().subtract(GHOST_GRACE_MINUTES, 'minute').toDate();
    const candidates = await Booking.findAll({
      where: {
        status: 'confirmed',
        checkedInAt: null,
        autoCancelledAt: null,
        startTime: { [Op.lt]: cutoff },
      },
      include: [
        { model: User, as: 'user' },
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      ],
    });
    // Salta le booking di aule con check-in disattivato (Room.requireCheckIn=false):
    // l'admin ha esplicitamente scelto di non far valere il ghost-cancel su quell'aula.
    const due = candidates.filter((bk) => bk.room?.requireCheckIn !== false);
    if (due.length === 0) return;

    const emailOn = await emailEnabled();
    for (const bk of due) {
      await bk.update({
        status: 'cancelled',
        cancelReason: 'auto: ghost booking',
        cancelledAt: new Date(),
        autoCancelledAt: new Date(),
      });
      if (emailOn && bk.user) {
        // Refetch per avere dati aggiornati post-update
        const fresh = await Booking.findByPk(bk.id, {
          include: [
            { model: User, as: 'user' },
            { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
          ],
        });
        sendBookingEmail({ user: fresh.user, booking: fresh, kind: 'ghost_cancellation' }).catch(
          () => {},
        );
      }
    }
    console.log(
      `[reminder][ghost] ${due.length} prenotazioni auto-cancellate per mancato check-in`,
    );
  } catch (err) {
    console.error('[reminder][ghost] errore tick:', err.message);
  }
}

// =========================================================
// Tick waitlist expiry — promuove il successivo in coda
// =========================================================
//
// Le entries in BookingWaitlist con expiresAt nel passato e ancora
// "notificate-non-claim" vengono cancellate auto e si tenta di notificare
// il successivo per lo stesso slot. Logica in services/waitlistService.
async function tickWaitlist() {
  try {
    const { cleanupExpired } = require('./waitlistService');
    const n = await cleanupExpired();
    if (n > 0) console.log(`[reminder][waitlist] processed ${n} expired entries`);
  } catch (err) {
    console.error('[reminder][waitlist] errore tick:', err.message);
  }
}

async function tickAll() {
  await tick();
  await tickGhostCancel();
  await tickLoans();
  await tickWaitlist();
}

function start() {
  if (timer) return;
  // primo tick subito (utile in dev) poi ogni TICK_MS
  setTimeout(tickAll, 10_000);
  timer = setInterval(tickAll, TICK_MS);
  console.log(
    `[reminder] scheduler avviato (ogni ${TICK_MS / 1000 / 60} min · bookings + loans + waitlist)`,
  );
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop };
