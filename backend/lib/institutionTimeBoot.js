'use strict';

/**
 * Collega `Institute.timezone` al modulo del tempo (`institutionTime`).
 *
 * Da chiamare all'avvio (dopo connessione, pre-sync, sync e seed) e dopo che
 * l'admin salva l'istituto. Non solleva mai: in caso di riga assente, vuota,
 * non valida o di errore DB resta attivo il fuso corrente (default
 * Europe/Rome / INSTITUTION_TZ).
 *
 * Il valore di default del model ('Europe/Rome') non è una scelta esplicita:
 * se INSTITUTION_TZ è impostata, quel default non la sovrascrive.
 */

const institutionTime = require('./institutionTime');

const MODEL_DEFAULT_TZ = 'Europe/Rome';

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ Institute: object, logger?: { info?: Function, warn?: Function } }} deps
 * @returns {Promise<string>} il fuso istituzionale attivo dopo la chiamata
 */
async function configureFromInstitute({ Institute, logger } = {}) {
  try {
    const inst = await Institute.findOne({
      order: [['id', 'ASC']],
      attributes: ['id', 'timezone'],
    });
    const tz = typeof inst?.timezone === 'string' ? inst.timezone.trim() : '';
    if (!tz) return institutionTime.getTimezone();
    if (!isValidTz(tz)) {
      logger?.warn?.(
        `Institute.timezone non valido ("${tz}"): resta ${institutionTime.getTimezone()}`,
      );
      return institutionTime.getTimezone();
    }
    if (tz === MODEL_DEFAULT_TZ && isValidTz(process.env.INSTITUTION_TZ)) {
      return institutionTime.getTimezone();
    }
    const before = institutionTime.getTimezone();
    const active = institutionTime.configure({ timezone: tz });
    if (active !== before) logger?.info?.(`Fuso istituzionale: ${before} → ${active}`);
    return active;
  } catch (err) {
    logger?.warn?.(`Lettura Institute.timezone fallita (${err.message}): fuso invariato`);
    return institutionTime.getTimezone();
  }
}

module.exports = { configureFromInstitute };
