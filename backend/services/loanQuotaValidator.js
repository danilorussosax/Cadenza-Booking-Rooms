'use strict';

/**
 * Verifica che una richiesta di prestito non superi le quote attive
 * applicabili all'utente.
 *
 * Restituisce un array di issue: ogni issue è
 *   { message: string, code: 'LOAN_QUOTA_EXCEEDED_<SCOPE>' }
 *
 * Gli admin sono esclusi a priori (i prestiti che gestiscono come admin
 * restano comunque imputati al `userId` impostato nel route, quindi le
 * quote dell'utente sono comunque valutate; il bypass riguarda solo gli
 * admin che richiedono prestiti per sé stessi).
 */

const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { InstrumentLoanQuota, InstrumentLoan, Instrument } = require('../models');

const ACTIVE_LOAN_STATUSES = ['requested', 'active', 'overdue'];

const SCOPE_CODE = {
  global: 'LOAN_QUOTA_EXCEEDED_GLOBAL',
  family: 'LOAN_QUOTA_EXCEEDED_FAMILY',
  instrument: 'LOAN_QUOTA_EXCEEDED_INSTRUMENT',
};

function daysBetween(fromDate, toDate) {
  // Conteggio inclusivo: 2026-04-27 → 2026-04-27 = 1 giorno.
  const a = dayjs(fromDate);
  const b = dayjs(toDate);
  return Math.max(1, b.diff(a, 'day') + 1);
}

/**
 * Carica gli id degli strumenti che ricadono in uno scope di quota:
 *   global     → null (= tutti gli strumenti)
 *   family     → tutti gli Instrument con family = scopeValue
 *   instrument → [Number(scopeValue)]
 *
 * Ritorna `null` per indicare "tutti" (comodo per usare in WHERE).
 */
async function instrumentIdsForScope(quota, tx) {
  if (quota.scopeKind === 'global') return null;
  if (quota.scopeKind === 'instrument') return [Number(quota.scopeValue)];
  // family
  const list = await Instrument.findAll({
    where: { family: quota.scopeValue },
    attributes: ['id'],
    ...tx,
  });
  return list.map((i) => i.id);
}

/**
 * Determina se la quota si applica al prestito che si sta richiedendo.
 * (utile per evitare query inutili quando lo scope non centra)
 */
function quotaAppliesToRequest(quota, instrument) {
  if (quota.scopeKind === 'global') return true;
  if (quota.scopeKind === 'family') return quota.scopeValue === instrument.family;
  if (quota.scopeKind === 'instrument') return Number(quota.scopeValue) === instrument.id;
  return false;
}

/**
 * Validatore principale.
 *
 * @param {object} args
 * @param {object} args.user        utente richiedente
 * @param {object} args.instrument  strumento richiesto (deve avere `family` e `id`)
 * @param {string} args.fromDate    YYYY-MM-DD
 * @param {string} args.toDate      YYYY-MM-DD
 * @param {number=} args.ignoreLoanId  esclude un prestito specifico (es. modifica)
 * @param {object=} args.transaction
 */
async function checkLoanQuotas({
  user,
  instrument,
  fromDate,
  toDate,
  ignoreLoanId = null,
  transaction = null,
}) {
  const issues = [];
  if (user.role === 'admin') return issues;

  const tx = transaction ? { transaction } : {};

  const quotas = await InstrumentLoanQuota.findAll({
    where: { role: user.role, isActive: true },
    ...tx,
  });
  if (quotas.length === 0) return issues;

  const requestedDays = daysBetween(fromDate, toDate);
  const yearAgo = dayjs().subtract(365, 'day').startOf('day').format('YYYY-MM-DD');

  for (const quota of quotas) {
    if (!quotaAppliesToRequest(quota, instrument)) continue;

    const matchingIds = await instrumentIdsForScope(quota, tx);
    if (Array.isArray(matchingIds) && matchingIds.length === 0) continue;

    const baseWhere = {
      userId: user.id,
      ...(ignoreLoanId ? { id: { [Op.ne]: ignoreLoanId } } : {}),
      ...(matchingIds ? { instrumentId: { [Op.in]: matchingIds } } : {}),
    };

    // ---- maxConcurrent: prestiti attivi adesso (requested|active|overdue) ----
    if (quota.maxConcurrent > 0) {
      const concurrent = await InstrumentLoan.count({
        where: {
          ...baseWhere,
          status: { [Op.in]: ACTIVE_LOAN_STATUSES },
        },
        ...tx,
      });
      if (concurrent + 1 > quota.maxConcurrent) {
        const what = quotaScopeLabel(quota);
        issues.push({
          code: SCOPE_CODE[quota.scopeKind] || 'LOAN_QUOTA_EXCEEDED_GLOBAL',
          message: `Limite contemporaneo superato (${what}): max ${quota.maxConcurrent}, già attivi ${concurrent}`,
        });
      }
    }

    // ---- maxDaysPerYear: somma giorni dei prestiti negli ultimi 365gg ----
    if (quota.maxDaysPerYear > 0) {
      const recent = await InstrumentLoan.findAll({
        where: {
          ...baseWhere,
          status: { [Op.notIn]: ['rejected'] },
          // Considera prestiti il cui intervallo si interseca con l'ultimo anno.
          fromDate: { [Op.gte]: yearAgo },
        },
        attributes: ['fromDate', 'toDate'],
        ...tx,
      });
      const usedDays = recent.reduce((sum, r) => sum + daysBetween(r.fromDate, r.toDate), 0);
      if (usedDays + requestedDays > quota.maxDaysPerYear) {
        const what = quotaScopeLabel(quota);
        issues.push({
          code: SCOPE_CODE[quota.scopeKind] || 'LOAN_QUOTA_EXCEEDED_GLOBAL',
          message:
            `Limite annuo superato (${what}): max ${quota.maxDaysPerYear} gg, ` +
            `usati ${usedDays} negli ultimi 365 gg, richiesti ${requestedDays}`,
        });
      }
    }
  }

  return issues;
}

function quotaScopeLabel(quota) {
  if (quota.scopeKind === 'global') return 'tutti gli strumenti';
  if (quota.scopeKind === 'family') return `famiglia ${quota.scopeValue}`;
  return `strumento #${quota.scopeValue}`;
}

module.exports = { checkLoanQuotas };
