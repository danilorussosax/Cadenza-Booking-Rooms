'use strict';

/**
 * Servizio invio email per il modulo Prestiti Strumenti.
 * Parallelo a `sendBookingEmail` in `emailService.js`: condivide
 * configurazione SMTP, template renderer e store dei template
 * (DB con fallback ai defaults).
 *
 * Kind supportati (vedi mailTemplateDefaults.js):
 *   - loan_requested  (utente, conferma ricezione richiesta)
 *   - loan_approved   (utente, dopo approvazione admin)
 *   - loan_rejected   (utente, dopo rifiuto admin)
 *   - loan_returned   (utente, dopo registrazione restituzione)
 *   - loan_reminder   (utente, 2 giorni prima della scadenza)
 *   - loan_overdue    (utente, prima notifica overdue)
 */

const dayjs = require('dayjs');
require('dayjs/locale/it');
dayjs.locale('it');
const { render, renderText } = require('./templateRenderer');
const { getTemplate, buildBookingContext: _unused } = require('./emailService');

// Riusa il loadConfig di emailService via accesso side-effect
// (loadConfig è privato; getTemplate/sendTestEmail attivano la cache).
// Per non duplicare logica, accediamo al transporter via emailService:
const emailService = require('./emailService');

const KIND_PREF_FIELD = {
  // I prestiti non hanno un toggle granulare dedicato per ora:
  // rispettano solo il master switch `emailNotifications`.
  // Eventuali toggle per-prestito si possono aggiungere in futuro.
};

function durationLabel(fromDate, toDate) {
  const start = dayjs(fromDate);
  const end = dayjs(toDate);
  if (!start.isValid() || !end.isValid()) return '—';
  const days = end.diff(start, 'day') + 1; // inclusivo
  if (days <= 0) return '—';
  if (days === 1) return '1 giorno';
  return `${days} giorni`;
}

async function buildLoanContext({ user, loan }) {
  const { Institute } = require('../models');
  const inst = await Institute.findOne({
    attributes: ['name', 'copyright'],
    order: [['id', 'ASC']],
  }).catch(() => null);

  const instrument = loan.instrument || {};
  const start = dayjs(loan.fromDate);
  const end = dayjs(loan.toDate);
  const daysToReturn = Math.max(0, end.diff(dayjs().startOf('day'), 'day'));

  return {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      matricola: user.matricola || '',
    },
    instrument: {
      name: instrument.name || '',
      code: instrument.code || '',
      brand: instrument.brand || '',
      model: instrument.model || '',
      serialNumber: instrument.serialNumber || '',
    },
    loan: {
      fromDateLong: start.format('dddd D MMMM YYYY'),
      toDateLong: end.format('dddd D MMMM YYYY'),
      fromDateShort: start.format('DD/MM/YYYY'),
      toDateShort: end.format('DD/MM/YYYY'),
      durationLabel: durationLabel(loan.fromDate, loan.toDate),
      daysToReturn,
      notes: loan.notes || '',
      status: loan.status || '',
    },
    institute: {
      name: inst?.name || 'Cadenza',
      copyright:
        inst?.copyright || 'Cadenza · Per disattivare le notifiche email vai sul tuo profilo.',
    },
    now: { dateTime: dayjs().format('DD MMM YYYY · HH:mm') },
  };
}

async function sendInstrumentLoanEmail({ user, loan, kind }) {
  if (!user?.email || user.emailNotifications === false) return;
  // Eventuale futuro: KIND_PREF_FIELD per toggle granulari sui prestiti.
  if (KIND_PREF_FIELD[kind] && user[KIND_PREF_FIELD[kind]] === false) return;

  const tpl = await getTemplate(kind);
  if (!tpl) return;

  const ctx = await buildLoanContext({ user, loan });
  const idempotencyKey = loan?.id ? `loan:${loan.id}:${kind}` : null;
  await emailService.enqueueMail({
    kind,
    to: user.email,
    subject: renderText(tpl.subject, ctx),
    html: render(tpl.bodyHtml, ctx),
    priority: 5,
    idempotencyKey,
  });
}

module.exports = { sendInstrumentLoanEmail, buildLoanContext };
