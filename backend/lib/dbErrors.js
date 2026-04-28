'use strict';

/**
 * Mappa errori Sequelize / `pg` (e altri DB driver) verso una shape uniforme:
 *
 *   { status, code, message, fields?, details?, constraint? }
 *
 *  - `status`: codice HTTP da rispondere (409, 400, ecc.)
 *  - `code`: stringa stabile lato API. Il frontend la traduce via i18n
 *    (`errors.code.<CODE>`) quindi DEVE rimanere costante nel tempo.
 *  - `message`: testo italiano di fallback (i18n primario passa per `code`)
 *  - `fields`: per UNIQUE_VIOLATION, lista delle colonne in conflitto
 *  - `details`: per VALIDATION_FAILED, lista [{field, message}]
 *  - `constraint`: nome del vincolo lato DB (utile per debug/log)
 *
 * Vincoli gestiti:
 *   - UNIQUE      → 409 UNIQUE_VIOLATION       (es. email duplicata)
 *   - EXCLUSION   → 409 EXCLUSION_VIOLATION    (es. range overlap PG)
 *   - FOREIGN KEY → 409 FK_VIOLATION           (es. cancellare un utente
 *                                              ancora referenziato)
 *   - CHECK       → 400 CHECK_VIOLATION
 *   - VALIDATION  → 400 VALIDATION_FAILED      (Sequelize-side validators)
 *
 * Restituisce `null` se l'errore non è riconosciuto: in quel caso il chiamante
 * (error middleware) ricade su 500 generico.
 *
 * Riferimento codici Postgres SQLSTATE:
 *   23505 unique_violation
 *   23P01 exclusion_violation
 *   23503 foreign_key_violation
 *   23514 check_violation
 *   40001 serialization_failure (gestito altrove con retry)
 */
function mapSequelizeError(err) {
  if (!err) return null;
  const pgCode = err?.parent?.code || err?.original?.code;

  // UNIQUE
  if (err.name === 'SequelizeUniqueConstraintError' || pgCode === '23505') {
    const fields = Array.isArray(err.errors) ? err.errors.map((e) => e.path).filter(Boolean) : [];
    return {
      status: 409,
      code: 'UNIQUE_VIOLATION',
      fields,
      message: fields.length
        ? `Esiste già un record con valore duplicato in: ${fields.join(', ')}`
        : 'Esiste già un record con questi valori',
      constraint: err?.parent?.constraint,
    };
  }

  // EXCLUSION (esclusività di range, tipica per booking-conflict in Postgres)
  if (err.name === 'SequelizeExclusionConstraintError' || pgCode === '23P01') {
    return {
      status: 409,
      code: 'EXCLUSION_VIOLATION',
      message: 'Operazione in conflitto con un record esistente (sovrapposizione non permessa)',
      constraint: err?.parent?.constraint,
    };
  }

  // FOREIGN KEY
  if (err.name === 'SequelizeForeignKeyConstraintError' || pgCode === '23503') {
    return {
      status: 409,
      code: 'FK_VIOLATION',
      message: 'Operazione bloccata: il record è ancora referenziato da altri dati',
      constraint: err?.parent?.constraint,
    };
  }

  // CHECK
  if (pgCode === '23514') {
    return {
      status: 400,
      code: 'CHECK_VIOLATION',
      message: 'Dati non validi per i vincoli applicati',
      constraint: err?.parent?.constraint,
    };
  }

  // Sequelize VALIDATION (validators applicati dai model prima di colpire il DB)
  if (err.name === 'SequelizeValidationError' && Array.isArray(err.errors)) {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      details: err.errors.map((e) => ({ field: e.path, message: e.message })),
      message: 'Validazione fallita',
    };
  }

  return null;
}

module.exports = { mapSequelizeError };
