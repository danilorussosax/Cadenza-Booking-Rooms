'use strict';

const {
  sequelize,
  MonteOreProposal,
  MonteOreSettings,
  MonteOreSuspension,
  Institute,
} = require('../../models');
const workflow = require('../../services/monteOreWorkflowService');
const calendarService = require('../../services/monteOreCalendarService');

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
  const { MailOutbox } = require('../../models');
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

async function findOwnProposalEditable(
  userId,
  year = currentAcademicYearLabel(),
  transaction = null,
) {
  const settings = await MonteOreSettings.findOne({ where: { academicYear: year }, transaction });
  if (settings && settings.status !== 'published')
    workflow.fail('Anno non pubblicato per la compilazione', 'ACADEMIC_YEAR_NOT_PUBLISHED', 409);
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

module.exports = {
  currentAcademicYearLabel,
  defaultRangeForYear,
  sanitizeSchedule,
  serializeAmendments,
  serializeProposal,
  findOwnProposalEditable,
  resolveDefaultInstituteId,
  sanitizeSuspension,
  findExistingSuspension,
};
