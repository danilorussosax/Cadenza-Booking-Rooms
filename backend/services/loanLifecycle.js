'use strict';

/**
 * Ciclo di vita del prestito strumento: `request`, `approve`, `reject`,
 * `returnLoan`, `cancel`.
 *
 * Possiede, in un unico punto:
 *   - l'elenco degli stati e quello di quelli che «occupano» lo strumento;
 *   - la definizione di overdue (derivato in lettura == persistito dallo
 *     scheduler: `active` con toDate oltre fine giornata istituzionale);
 *   - le transizioni come UPDATE atomici condizionati allo stato di partenza
 *     (di due richieste concorrenti vince una sola), con diagnosi quando
 *     nessuna riga viene aggiornata;
 *   - validazione di richiesta, conflitto di periodo e quote (nella stessa tx);
 *   - le mail best-effort DOPO la transizione (testi in instrumentLoanEmail).
 *
 * Le route restano adapter HTTP: parse, can/assertCan, chiamata, risposta.
 */

const dayjs = require('dayjs');
const { Op, Transaction } = require('sequelize');
const institutionTime = require('../lib/institutionTime');
const { withSerializableRetry } = require('../lib/serializableTx');
const { domainError } = require('../lib/domainError');
const { isAdmin, can } = require('../lib/access');
const { sequelize, Instrument, InstrumentLoan, User } = require('../models');
// Riferimento via oggetto-modulo: i test possono spiare sendInstrumentLoanEmail.
const instrumentLoanEmail = require('./instrumentLoanEmail');

const STATUS = Object.freeze({
  REQUESTED: 'requested',
  ACTIVE: 'active',
  OVERDUE: 'overdue',
  RETURNED: 'returned',
  REJECTED: 'rejected',
});

/** Stati in cui il prestito occupa lo strumento / conta per le quote. */
const OCCUPYING_STATUSES = Object.freeze([STATUS.REQUESTED, STATUS.ACTIVE, STATUS.OVERDUE]);
/** Stati da cui si puo' restituire. */
const RETURNABLE_STATUSES = Object.freeze([STATUS.ACTIVE, STATUS.OVERDUE]);

function isOccupying(status) {
  return OCCUPYING_STATUSES.includes(status);
}

function isOverdue(loan, now = institutionTime.now()) {
  return (
    loan.status === STATUS.ACTIVE &&
    dayjs(now).isAfter(institutionTime.endOfDay(institutionTime.toInstant(loan.toDate)))
  );
}

// Status "calcolato" per il client: `active` oltre la scadenza e' mostrato
// come `overdue` anche se lo scheduler non l'ha ancora persistito.
function annotateStatus(loan, now) {
  const obj = loan.toJSON ? loan.toJSON() : loan;
  if (obj.status === STATUS.ACTIVE && isOverdue(loan, now)) obj.status = STATUS.OVERDUE;
  return obj;
}

const userPublicAttrs = ['id', 'firstName', 'lastName', 'email', 'matricola', 'role'];

// Include riusabile per i listing admin: instrument + user + approver.
function loanAdminIncludes() {
  return [
    { model: Instrument, as: 'instrument' },
    { model: User, as: 'user', attributes: userPublicAttrs },
    { model: User, as: 'approver', attributes: userPublicAttrs },
  ];
}

async function findLoanFull(id) {
  return InstrumentLoan.findByPk(id, { include: loanAdminIncludes() });
}

function notify(full, kind) {
  Promise.resolve(
    instrumentLoanEmail.sendInstrumentLoanEmail({ user: full.user, loan: full, kind }),
  ).catch(() => {});
}

// -------------------------------------------------------
// Richiesta
// -------------------------------------------------------
async function request({ user, instrumentId, fromDate, toDate, notes }) {
  const start = dayjs(fromDate);
  const end = dayjs(toDate);
  if (!start.isValid() || !end.isValid()) {
    throw domainError('LOAN_INVALID_DATE', 'Date non valide');
  }
  if (end.isBefore(start)) {
    throw domainError(
      'LOAN_INVALID_DATE',
      'La data di restituzione deve essere successiva alla data di inizio',
    );
  }
  if (start.isBefore(institutionTime.startOfDay())) {
    throw domainError('LOAN_INVALID_DATE', 'Non puoi richiedere un prestito nel passato');
  }

  const instrument = await Instrument.findByPk(instrumentId);
  if (!instrument) throw domainError('NOT_FOUND', 'Strumento non trovato', { status: 404 });
  if (!instrument.isLoanable) {
    throw domainError('INSTRUMENT_NOT_LOANABLE', 'Strumento non disponibile per il prestito');
  }
  if (instrument.condition === 'fuori_uso' || instrument.condition === 'da_riparare') {
    throw domainError('INSTRUMENT_NOT_LOANABLE', 'Strumento non disponibile (condizione)');
  }

  // Abilitazione per corso: array vuoto = permissivo; gli admin bypassano.
  if (!isAdmin(user)) {
    const allowedCourseIds = Array.isArray(instrument.allowedCourseIds)
      ? instrument.allowedCourseIds
      : [];
    if (allowedCourseIds.length > 0) {
      if (!user.courseId || !allowedCourseIds.includes(user.courseId)) {
        throw domainError(
          'INSTRUMENT_NOT_ALLOWED_FOR_COURSE',
          'Il tuo corso non è abilitato a richiedere il prestito di questo strumento',
          { status: 403 },
        );
      }
    }
  }

  const from = start.format('YYYY-MM-DD');
  const to = end.format('YYYY-MM-DD');

  // Conflitto + quote + create nella stessa tx (SERIALIZABLE su Postgres).
  const txOpts =
    sequelize.getDialect() === 'postgres'
      ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
      : {};
  const loan = await withSerializableRetry(sequelize, txOpts, async (t) => {
    const conflict = await InstrumentLoan.findOne({
      where: {
        instrumentId,
        status: { [Op.in]: OCCUPYING_STATUSES },
        [Op.and]: [{ fromDate: { [Op.lte]: to } }, { toDate: { [Op.gte]: from } }],
      },
      transaction: t,
    });
    if (conflict) {
      throw domainError('LOAN_CONFLICT', 'Lo strumento è già impegnato nel periodo richiesto', {
        status: 409,
      });
    }

    if (!isAdmin(user)) {
      // Lazy: loanQuotaValidator importa le costanti di questo modulo.
      const { checkLoanQuotas } = require('./loanQuotaValidator');
      const quotaIssues = await checkLoanQuotas({
        user,
        instrument,
        fromDate: from,
        toDate: to,
        transaction: t,
      });
      if (quotaIssues.length > 0) {
        const first = quotaIssues[0];
        throw domainError(first.code, first.message, {
          status: 409,
          details: quotaIssues.map((i) => ({ message: i.message, code: i.code })),
        });
      }
    }

    return InstrumentLoan.create(
      {
        instrumentId,
        userId: user.id,
        fromDate: from,
        toDate: to,
        notes: notes || null,
        status: STATUS.REQUESTED,
      },
      { transaction: t },
    );
  });
  const full = await findLoanFull(loan.id);
  notify(full, 'loan_requested');
  return full;
}

// -------------------------------------------------------
// Transizioni atomiche
// -------------------------------------------------------
async function approve({ id, actor }) {
  const [affected] = await InstrumentLoan.update(
    { status: STATUS.ACTIVE, approvedBy: actor.id, approvedAt: new Date() },
    { where: { id, status: STATUS.REQUESTED } },
  );
  if (affected === 0) {
    const exists = await InstrumentLoan.findByPk(id);
    if (!exists) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
    throw domainError('LOAN_INVALID_STATE', "Stato non valido per l'approvazione");
  }
  const full = await findLoanFull(id);
  notify(full, 'loan_approved');
  return full;
}

async function reject({ id, actor }) {
  const [affected] = await InstrumentLoan.update(
    { status: STATUS.REJECTED, approvedBy: actor.id, approvedAt: new Date() },
    { where: { id, status: STATUS.REQUESTED } },
  );
  if (affected === 0) {
    const exists = await InstrumentLoan.findByPk(id);
    if (!exists) throw domainError('NOT_FOUND', 'Prestito non trovato', { status: 404 });
    throw domainError('LOAN_INVALID_STATE', 'Stato non valido per il rifiuto');
  }
  const full = await findLoanFull(id);
  notify(full, 'loan_rejected');
  return full;
}

async function returnLoan({ id }) {
  const [affected] = await InstrumentLoan.update(
    { status: STATUS.RETURNED, returnedAt: new Date() },
    { where: { id, status: { [Op.in]: RETURNABLE_STATUSES } } },
  );
  if (affected === 0) {
    const fresh = await InstrumentLoan.findByPk(id);
    if (fresh?.status === STATUS.RETURNED) {
      throw domainError('LOAN_ALREADY_RETURNED', 'Prestito già restituito');
    }
    throw domainError('LOAN_INVALID_STATE', 'Stato non valido per la restituzione');
  }
  const full = await findLoanFull(id);
  notify(full, 'loan_returned');
  return full;
}

/**
 * Cancellazione. L'admin puo' eliminare un prestito in qualsiasi stato
 * (pulizia inventario); l'utente solo la propria richiesta in attesa.
 * Il controllo di proprieta' (assertCan 'loan:cancel') resta alla route.
 */
async function cancel({ loan, actor }) {
  if (!can(actor, 'loan:cancel-processed') && loan.status !== STATUS.REQUESTED) {
    throw domainError('LOAN_INVALID_STATE', 'Puoi cancellare solo richieste ancora in attesa');
  }
  const removed = await InstrumentLoan.destroy({
    where: {
      id: loan.id,
      ...(isAdmin(actor) ? {} : { userId: actor.id, status: STATUS.REQUESTED }),
    },
  });
  if (!removed) {
    throw domainError('LOAN_INVALID_STATE', 'Lo stato del prestito è cambiato', { status: 409 });
  }
}

module.exports = {
  STATUS,
  OCCUPYING_STATUSES,
  RETURNABLE_STATUSES,
  isOccupying,
  isOverdue,
  annotateStatus,
  loanAdminIncludes,
  findLoanFull,
  request,
  approve,
  reject,
  returnLoan,
  cancel,
};
