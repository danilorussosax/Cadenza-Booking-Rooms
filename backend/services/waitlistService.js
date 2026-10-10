'use strict';

/**
 * Logica condivisa della waitlist (Booking conflict queue):
 *  - notifyNextOnSlot(): trova il primo in coda per (room + interval overlap)
 *    non ancora notificato e gli manda email "claim_waitlist" con scadenza
 *    a 30 minuti.
 *  - cleanupExpired(): scadenze scadute → cancellate auto, poi richiama
 *    notifyNextOnSlot() per cercare il successivo.
 *
 * Usata da Booking.afterDestroy hook e dallo scheduler ogni 5 min.
 *
 * Tutte le operazioni usano `dayjs` per coerenza con il resto del codebase.
 */

const dayjs = require('dayjs');
const { Op, Transaction } = require('sequelize');
const { withSerializableRetry } = require('../lib/serializableTx');
const { sequelize, BookingWaitlist, Booking, Room, Building, User } = require('../models');
const { sendBookingEmail, emailEnabled } = require('./emailService');
const logger = require('../lib/logger');

const CLAIM_WINDOW_MINUTES = Math.max(5, Number(process.env.WAITLIST_CLAIM_MINUTES) || 30);

/**
 * Notifica il prossimo in coda per un dato slot. Idempotente: se nessuno
 * matching, no-op. Usato sia dall'hook (subito dopo cancel) sia dallo
 * scheduler (dopo expiry).
 *
 * Strategia di matching:
 *   - same roomId
 *   - waitlist.interval overlaps cancelled booking interval
 *     (waitlist.startTime < bookingEnd AND waitlist.endTime > bookingStart)
 *   - notifiedAt = null (non ancora avvisato)
 *   - claimedAt = null
 *   - cancelledAt = null
 *   - ORDER BY position ASC, createdAt ASC LIMIT 1
 *
 * NB: prima di notificare verifichiamo che non ci sia già una booking
 * confermata che copre quello slot (es. un altro utente è "saltato avanti"
 * creando una nuova booking nel frattempo). Se sì, salta la notifica.
 *
 * @param {object} cancelled - oggetto con {roomId, startTime, endTime} della
 *                             prenotazione appena cancellata o waitlist scaduta
 */
async function notifyNextOnSlot({ roomId, startTime, endTime }) {
  if (!roomId || !startTime || !endTime) return null;

  const start = startTime instanceof Date ? startTime : new Date(startTime);
  const end = endTime instanceof Date ? endTime : new Date(endTime);

  const next = await withSerializableRetry(
    sequelize,
    {
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
    },
    async (transaction) => {
      await Room.findByPk(roomId, { transaction, lock: transaction.LOCK.UPDATE });
      const candidates = await BookingWaitlist.findAll({
        where: {
          roomId,
          notifiedAt: null,
          claimedAt: null,
          cancelledAt: null,
          startTime: { [Op.lt]: end, [Op.gt]: new Date() },
          endTime: { [Op.gt]: start },
        },
        include: [
          { model: User, as: 'user' },
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        ],
        order: [
          ['position', 'ASC'],
          ['createdAt', 'ASC'],
        ],
        transaction,
      });
      for (const candidate of candidates) {
        if (!candidate.user?.isActive) continue;
        const overlap = {
          roomId,
          startTime: { [Op.lt]: candidate.endTime },
          endTime: { [Op.gt]: candidate.startTime },
        };
        if (await Booking.findOne({ where: { ...overlap, status: 'confirmed' }, transaction }))
          continue;
        if (
          await BookingWaitlist.findOne({
            where: {
              ...overlap,
              notifiedAt: { [Op.ne]: null },
              claimedAt: null,
              cancelledAt: null,
              expiresAt: { [Op.gt]: new Date() },
            },
            transaction,
          })
        )
          continue;
        await candidate.update(
          {
            notifiedAt: new Date(),
            expiresAt: dayjs().add(CLAIM_WINDOW_MINUTES, 'minute').toDate(),
          },
          { transaction },
        );
        return candidate;
      }
      return null;
    },
  );
  if (!next) return null;
  const expires = next.expiresAt;

  // 4) email (fire-and-forget)
  if (await emailEnabled()) {
    sendBookingEmail({
      user: next.user,
      booking: next, // shape compatibile con il template (room, startTime, endTime)
      kind: 'claim_waitlist',
      extra: { claimUrl: `/waitlist/claim/${next.id}`, expiresAt: expires },
    }).catch((e) =>
      logger.warn({ err: e.message, scope: 'waitlist.email' }, 'waitlist email failed'),
    );
  }

  logger.info(
    {
      userId: next.userId,
      entryId: next.id,
      roomId,
      expiresAt: expires.toISOString(),
      scope: 'waitlist.notify',
    },
    'waitlist next notified',
  );
  return next;
}

/**
 * Tick periodico: scaduti senza claim → marcati cancelled, poi notifica
 * il successivo nello stesso slot.
 *
 * Eseguito dallo scheduler ogni 5 min. Idempotente.
 */
async function cleanupExpired() {
  const now = new Date();
  const expired = await BookingWaitlist.findAll({
    where: {
      notifiedAt: { [Op.ne]: null },
      claimedAt: null,
      cancelledAt: null,
      expiresAt: { [Op.lt]: now },
    },
    order: [['expiresAt', 'ASC']],
    limit: 50, // safety cap per tick
  });

  if (expired.length === 0) return 0;

  let count = 0;
  for (const entry of expired) {
    if (await closeEntry(entry.id, 'auto: claim window expired', true)) count++;
  }

  logger.info(
    { count: expired.length, scope: 'waitlist.cleanup' },
    'waitlist expired entries processed',
  );
  return count;
}

async function closeEntry(id, reason, expiredOnly = false) {
  const entry = await withSerializableRetry(
    sequelize,
    {
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
    },
    async (transaction) => {
      const current = await BookingWaitlist.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!current || current.cancelledAt || current.claimedAt) return null;
      if (expiredOnly && (!current.expiresAt || current.expiresAt >= new Date())) return null;
      await current.update({ cancelledAt: new Date(), cancelReason: reason }, { transaction });
      await BookingWaitlist.decrement('position', {
        by: 1,
        where: {
          roomId: current.roomId,
          position: { [Op.gt]: current.position },
          cancelledAt: null,
          claimedAt: null,
        },
        transaction,
      });
      return current;
    },
  );
  if (entry) await notifyNextOnSlot(entry);
  return entry;
}

module.exports = {
  notifyNextOnSlot,
  closeEntry,
  cleanupExpired,
  CLAIM_WINDOW_MINUTES,
};
