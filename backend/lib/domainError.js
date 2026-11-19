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
   * @param {object} [opts.extra]         campi aggiuntivi non standard (es. `field`,
   *                                      `retryAfter`) fusi al primo livello del body
   */
  constructor(code, message, { status = 400, details, fields, extra } = {}) {
    super(message);
    this.name = 'DomainError';
    if (code !== undefined && code !== null) this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (fields !== undefined) this.fields = fields;
    if (extra !== undefined) this.extra = extra;
  }
}

function domainError(code, message, opts) {
  return new DomainError(code, message, opts);
}

/**
 * Errore HTTP storico SENZA `code` (body `{ error }` + eventuali `extra`/`details`).
 * Il gestore centrale lo rende ugualmente perché è un `DomainError`.
 * Preferire `domainError(code, ...)` per i nuovi errori.
 */
function httpError(status, message, opts) {
  return new DomainError(undefined, message, { ...opts, status });
}

module.exports = { DomainError, domainError, httpError };
