'use strict';

/**
 * Regole pure del ciclo di vita del piano monte ore: tabelle di stato
 * nominate, errore di dominio, minuti attivi e decoder delle variazioni.
 * Nessuna dipendenza dal DB, così servono sia al workflow sia alle route.
 */

const STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  GENERATED: 'generated',
  REJECTED: 'rejected',
});

// Stati in cui il docente modifica direttamente pattern e griglia.
const TEACHER_EDITABLE = Object.freeze([STATUS.DRAFT, STATUS.REJECTED]);
// Stati in cui il piano è operativo e si cambia solo via variazioni (amendment).
const AMENDABLE = Object.freeze([STATUS.APPROVED, STATUS.GENERATED]);
// Stati da cui l'admin può approvare/generare.
const APPROVABLE = Object.freeze([STATUS.SUBMITTED, STATUS.APPROVED]);
// Stati da cui l'admin può riportare in bozza (generated richiede prima l'unlock).
const REVERTIBLE = Object.freeze([STATUS.SUBMITTED, STATUS.APPROVED]);
// Stati sovrascrivibili da un import senza force.
const IMPORT_REPLACEABLE = Object.freeze([STATUS.DRAFT, STATUS.SUBMITTED, STATUS.REJECTED]);

const isTeacherEditable = (status) => TEACHER_EDITABLE.includes(status);
const isAmendable = (status) => AMENDABLE.includes(status);
const isApprovable = (status) => APPROVABLE.includes(status);
const isRevertible = (status) => REVERTIBLE.includes(status);
const isImportReplaceable = (status) => IMPORT_REPLACEABLE.includes(status);

function fail(message, code = 'VALIDATION_FAILED', status = 400, params) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (params !== undefined) error.params = params;
  throw error;
}

function minuteOf(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    fail('Orario non valido');
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Unica definizione di "minuti attivi": slot attivi e non bloccati. */
function activeMinutes(slots) {
  return slots
    .filter((s) => s.isActive && !s.isLocked)
    .reduce((total, s) => total + minuteOf(s.endTime) - minuteOf(s.startTime), 0);
}

/**
 * Unico decoder della forma legacy di una variazione: le richieste vecchie
 * hanno kind/slotId/payload sulla riga invece dell'array `operations`.
 */
function amendmentOperations(amendment) {
  return (
    amendment.operations || [
      { kind: amendment.kind, slotId: amendment.slotId, payload: amendment.payload },
    ]
  );
}

module.exports = {
  STATUS,
  TEACHER_EDITABLE,
  AMENDABLE,
  APPROVABLE,
  REVERTIBLE,
  IMPORT_REPLACEABLE,
  isTeacherEditable,
  isAmendable,
  isApprovable,
  isRevertible,
  isImportReplaceable,
  fail,
  minuteOf,
  activeMinutes,
  amendmentOperations,
};
