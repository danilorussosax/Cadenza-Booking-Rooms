'use strict';

const { Transaction } = require('sequelize');
const { sequelize } = require('../models');

/**
 * Wrapper dichiarativo per scritture complesse che devono essere atomiche.
 *
 *   - `isolation`: default SERIALIZABLE (massima protezione contro race
 *     su validazioni come "non avere booking sovrapposte"). Abbassabile
 *     con Transaction.ISOLATION_LEVELS.READ_COMMITTED dove non serve.
 *   - `retries`: ritenta su `serialization_failure` (Postgres SQLSTATE
 *     40001), che capita quando due transazioni concorrenti toccano gli
 *     stessi dati. SQLite ignora il livello di isolamento e non emette
 *     mai 40001 → su SQLite il retry è no-op.
 *
 * Pattern d'uso:
 *
 *   const result = await withTransaction(async (t) => {
 *     const booking = await Booking.create(payload, { transaction: t });
 *     await Audit.create({ bookingId: booking.id }, { transaction: t });
 *     return booking;
 *   });
 *
 * Se la callback throwa per qualunque motivo, Sequelize fa ROLLBACK
 * automatico. L'errore è ri-lanciato senza wrapping così il middleware
 * `dbErrors.js` lo riceve nella sua forma originale.
 */
async function withTransaction(fn, opts = {}) {
  const isolation = opts.isolation || Transaction.ISOLATION_LEVELS.SERIALIZABLE;
  const retries = Number.isInteger(opts.retries) ? opts.retries : 2;
  const baseDelayMs = opts.baseDelayMs || 50;

  let attempt = 0;
  for (;;) {
    try {
      return await sequelize.transaction({ isolationLevel: isolation }, fn);
    } catch (err) {
      const pgCode = err?.parent?.code || err?.original?.code;
      // 40001 → un'altra transazione ha "vinto"; back-off lineare e ritenta.
      if (pgCode === '40001' && attempt < retries) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        continue;
      }
      throw err;
    }
  }
}

module.exports = { withTransaction };
