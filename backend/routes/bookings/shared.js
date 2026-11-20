'use strict';

const { Transaction } = require('sequelize');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const { Booking, Room, User, Building } = require('../../models');

// Isolation level per le scritture su prenotazioni:
// SERIALIZABLE evita race condition sulla rilevazione conflitti
// (validate + insert eseguiti come una sola unità logica).
// SQLite ignora il livello (è già single-writer); Postgres/MySQL lo applicano.
// Postgres può emettere 40001 (serialization_failure) sui commit in conflitto:
// `withSerializableRetry` ritenta con backoff esponenziale fino a 5 volte.
const WRITE_ISOLATION = Transaction.ISOLATION_LEVELS.SERIALIZABLE;

// =====================================================
// Check-in (anti ghost-booking) — costanti e config
// =====================================================
//
// Soglie lette UNA volta da lib/config.js (via lib/checkInPolicy):
//   CHECKIN_EARLY_MINUTES     (default 5)  → quanto prima si può fare check-in
//   GHOST_GRACE_MINUTES       (default 15) → quanto dopo l'inizio scatta l'auto-cancel
const { earlyMinutes: CHECKIN_EARLY_MINUTES, graceMinutes: GHOST_GRACE_MINUTES } =
  require('../../lib/checkInPolicy').thresholds();

async function fetchBookingFull(id) {
  return Booking.findByPk(id, {
    include: [
      {
        model: User,
        as: 'user',
        attributes: [
          'id',
          'firstName',
          'lastName',
          'role',
          'email',
          'emailNotifications',
          'notifyOnConfirmation',
          'notifyOnCancellation',
        ],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
  });
}

module.exports = {
  dayjs,
  WRITE_ISOLATION,
  CHECKIN_EARLY_MINUTES,
  GHOST_GRACE_MINUTES,
  fetchBookingFull,
};
