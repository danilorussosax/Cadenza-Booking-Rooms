'use strict';

/**
 * Codici errore emessi dal backend che NON hanno (e non devono avere) una
 * traduzione `errors.code.<CODE>` nel frontend, con la motivazione.
 *
 * Il test `tests/unit/errorCodesCatalog.test.js` estrae tutti i letterali
 * `code` dal backend e impone che ciascuno sia tradotto nelle 5 lingue, oppure
 * elencato qui (cap sulla dimensione: l'allowlist non può crescere in silenzio).
 */
const INTERNAL_ONLY_CODES = {
  SENTRY_SMOKE_TEST: 'solo endpoint diagnostico Sentry, mai mostrato agli utenti',
  DESTRUCTIVE_SYNC_BLOCKED: 'errore di boot del processo, non è una risposta HTTP',
  VALIDATION_FAILED:
    'generico con details[]: httpErrorMessage mostra details/messaggio server (GENERIC_CODES_WITH_DETAILS)',
  INTERNAL: 'errore 500 generico, il frontend usa errors.generic',
  NOT_IMPLEMENTED: 'endpoint non supportato, messaggio server esplicativo e senza azione utente',
  PARSE_FAILED: 'errore di parsing file import: il messaggio server riporta il dettaglio del file',
  EMPTY_FILE: 'errore di parsing file import: il messaggio server riporta il dettaglio del file',
  MASS_DEACTIVATION:
    'warning della preview import (non errore HTTP), testo parametrico nel payload',
  MASS_CREATION: 'warning della preview import (non errore HTTP), testo parametrico nel payload',
  UNKNOWN_COURSE_CODE:
    'warning della preview import (non errore HTTP), testo parametrico nel payload',
  DAILY_HOURS_EXCEEDED: 'violazione validatore giornaliero, resa lato client con testo parametrico',
  BREAK_REQUIRED: 'violazione validatore giornaliero, resa lato client con testo parametrico',
  BOOKING_OVERLAP:
    'motivo per-occorrenza nel report ricorrenze legacy, non è un errore di risposta',
  USER_INVALID: 'esito interno di services/auth/sendSetupLink, mai esposto come codice utente',
  PURPOSE_INVALID: 'esito interno di services/auth/sendSetupLink, mai esposto come codice utente',
  TEMPLATE_MISSING: 'esito interno di services/auth/sendSetupLink, mai esposto come codice utente',
  BACKUP_UNSAFE_SYMLINK: 'diagnostica restore backup (admin), messaggio server esplicativo',
  BACKUP_UNSAFE_HARDLINK: 'diagnostica restore backup (admin), messaggio server esplicativo',
  BACKUP_UNSAFE_PATH: 'diagnostica restore backup (admin), messaggio server esplicativo',
  BACKUP_BAD_MANIFEST: 'diagnostica restore backup (admin), messaggio server esplicativo',
};

module.exports = { INTERNAL_ONLY_CODES };
