'use strict';

/**
 * Errore di dominio: unico modo previsto per sollevare un errore API con
 * `code` stabile. Il gestore centrale in `app.js` rende `{ error, code,
 * details, fields }` per ogni errore con `status` + `code`, quindi basta
 * `throw domainError(...)` (o `next(...)`) senza costruire a mano la risposta.
 *
 * Retro-compatibile: `Object.assign(new Error(m), { status, code })` e le
 * factory locali (`workflow.fail`, `academicYearConfig.invalid`) producono
 * oggetti con la stessa shape e continuano a funzionare. Ogni nuovo `code`
 * emesso va tradotto in `frontend/src/i18n/locales/*.json` (`errors.code.*`):
 * lo verifica `tests/unit/errorCodesCatalog.test.js`.
 */
class DomainError extends Error {
  /**
   * @param {string} code    codice stabile (UPPER_SNAKE), chiave `errors.code.<CODE>`
   * @param {string} message testo italiano di fallback
   * @param {object} [opts]
   * @param {number} [opts.status=400]
   * @param {object|Array} [opts.details] dettagli strutturati per il client
   * @param {string[]} [opts.fields]      campi coinvolti
   */
  constructor(code, message, { status = 400, details, fields } = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (fields !== undefined) this.fields = fields;
  }
}

function domainError(code, message, opts) {
  return new DomainError(code, message, opts);
}

module.exports = { DomainError, domainError };
