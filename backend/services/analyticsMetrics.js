'use strict';

/**
 * Metriche analytics admin (heatmap 7×24, top rooms/users, no-show, trend).
 *
 * Interface: `gatherAnalytics(range)` → shape della response JSON di
 * GET /api/admin/analytics. `range` = { from: Date|dayjs, to: Date|dayjs }.
 *
 * Una sola definizione di:
 *   - «minuti prenotati»        → `bookedMinutesSql()`
 *   - «prenotazione contabile»  → `COUNTABLE_BOOKING_SQL` (raw) /
 *                                 `countableBookingWhere()` (Sequelize)
 * Le query raw e i findAll Sequelize devono passare da qui: così le cifre del
 * dashboard non divergono tra loro.
 *
 * SQL Postgres-only (`EXTRACT`, `date_trunc`, cast `::int`): la parte pura
 * (frammenti SQL, mapping righe → oggetti) è testabile su SQLite, le query no
 * (vedi tests/integration/analyticsAggregations.postgres.test.js).
 */

const { Op, fn, col, literal } = require('sequelize');
const dayjs = require('dayjs');
const { sequelize, Booking, Room, Building, User } = require('../models');
const institutionTime = require('../lib/institutionTime');

// =====================================================
// Frammenti SQL condivisi
// =====================================================

/**
 * Minuti prenotati di una riga bookings: (end - start) / 60.
 * @param {string} [alias] alias/tabella a cui qualificare le colonne (es. 'Booking');
 *   omesso → colonne non qualificate (query raw su `FROM bookings`).
 */
function bookedMinutesSql(alias) {
  const q = alias ? `"${alias}".` : '';
  return `EXTRACT(EPOCH FROM (${q}"endTime" - ${q}"startTime")) / 60`;
}

/** Stesso frammento come literal Sequelize, per SUM() nei findAll su `Booking`. */
const BOOKED_MINUTES_LITERAL = literal(bookedMinutesSql('Booking'));

/**
 * «Prenotazione contabile» per query raw: confermata e non cancellata
 * logicamente (soft delete). Non qualificato: `FROM bookings`.
 */
const COUNTABLE_BOOKING_SQL = `status = 'confirmed' AND "deletedAt" IS NULL`;

/**
 * Stessa definizione per i findAll Sequelize (il modello Booking è paranoid:
 * `deletedAt IS NULL` viene aggiunto automaticamente).
 */
function countableBookingWhere(range) {
  return {
    status: 'confirmed',
    startTime: { [Op.between]: [range.from, range.to] },
  };
}

// =====================================================
// Mapping puro righe → oggetti
// =====================================================

/** Minuti → ore con 1 decimale. */
function minutesToHours(minutes) {
  return Math.round((Number(minutes) / 60) * 10) / 10;
}

/**
 * Righe {dow, hour, count, minutes} (dow Postgres 0=Domenica) → matrice 7×24
 * di {count, hours}, riga 0=Lunedì … 6=Domenica.
 */
function buildHeatmap(rows) {
  const heatmap = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, hours: 0 })),
  );
  for (const row of rows) {
    const pgDow = Number(row.dow); // 0..6, 0=Sunday
    const localDow = (pgDow + 6) % 7; // 0=Mon … 6=Sun
    const hour = Math.max(0, Math.min(23, Number(row.hour)));
    heatmap[localDow][hour] = {
      count: Number(row.count),
      hours: minutesToHours(row.minutes),
    };
  }
  return heatmap;
}

function mapTopRooms(rows) {
  return rows.map((r) => ({
    roomId: r.roomId,
    name: r.room?.name,
    building: r.room?.building?.name,
    floor: r.room?.floor,
    hours: minutesToHours(r.dataValues.minutes),
    count: Number(r.dataValues.count),
  }));
}

function mapTopUsers(rows) {
  return rows.map((r) => ({
    userId: r.userId,
    firstName: r.user?.firstName,
    lastName: r.user?.lastName,
    email: r.user?.email,
    role: r.user?.role,
    matricola: r.user?.matricola,
    hours: minutesToHours(r.dataValues.minutes),
    count: Number(r.dataValues.count),
  }));
}

function mapTrendRows(rows) {
  return rows.map((r) => ({
    weekStart: r.week_start,
    count: Number(r.count),
    hours: minutesToHours(r.minutes),
  }));
}

/** ghosted / totalCreated in % con 1 decimale (0 se nessuna prenotazione). */
function noShowRatePct(ghosted, totalCreated) {
  return totalCreated > 0 ? Math.round((ghosted / totalCreated) * 1000) / 10 : 0;
}

// =====================================================
// Aggregazione completa — riusata da GET / e GET /export.pdf.
// =====================================================
async function gatherAnalytics(range) {
  // Fuso letto a ogni chiamata: può essere configurato dopo il caricamento.
  const TZ_SQL = institutionTime.sqlTimezoneLiteral();
  // 1) Heatmap 7×24 — count di booking confermati / fascia (giorno settimana × ora di start).
  //    Postgres: EXTRACT(DOW) → 0=Sunday, 1=Monday, …, 6=Saturday
  //    AT TIME ZONE <fuso istituto> fa l'extract in ora locale dell'istituto: un concerto
  //    lunedì 00:30 (= dom 22:30 UTC) finisce sulla riga lunedì-00 invece
  //    che domenica-22. Senza questo, su VPS UTC la heatmap è sfasata di
  //    1-2h e occasionalmente sbaglia anche il giorno.
  const heatmapRows = await Booking.findAll({
    attributes: [
      [literal(`EXTRACT(DOW FROM "startTime" AT TIME ZONE ${TZ_SQL})::int`), 'dow'],
      [literal(`EXTRACT(HOUR FROM "startTime" AT TIME ZONE ${TZ_SQL})::int`), 'hour'],
      [fn('COUNT', col('id')), 'count'],
      [fn('SUM', BOOKED_MINUTES_LITERAL), 'minutes'],
    ],
    where: countableBookingWhere(range),
    group: [literal('dow'), literal('hour')],
    raw: true,
  });
  const heatmap = buildHeatmap(heatmapRows);

  // 2) Top 10 stanze per ore prenotate
  const topRoomsRows = await Booking.findAll({
    attributes: [
      'roomId',
      [fn('SUM', BOOKED_MINUTES_LITERAL), 'minutes'],
      [fn('COUNT', col('Booking.id')), 'count'],
    ],
    where: countableBookingWhere(range),
    include: [
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'name', 'floor'],
        include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
      },
    ],
    group: ['Booking.roomId', 'room.id', 'room->building.id'],
    order: [[fn('SUM', BOOKED_MINUTES_LITERAL), 'DESC']],
    limit: 10,
  });
  const topRooms = mapTopRooms(topRoomsRows);

  // 3) Top 10 utenti per ore prenotate
  const topUsersRows = await Booking.findAll({
    attributes: [
      'userId',
      [fn('SUM', BOOKED_MINUTES_LITERAL), 'minutes'],
      [fn('COUNT', col('Booking.id')), 'count'],
    ],
    where: countableBookingWhere(range),
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola'],
      },
    ],
    group: ['Booking.userId', 'user.id'],
    order: [[fn('SUM', BOOKED_MINUTES_LITERAL), 'DESC']],
    limit: 10,
  });
  const topUsers = mapTopUsers(topUsersRows);

  // 4) No-show rate: bookings con autoCancelledAt valorizzato / totale "confirmed creati nel periodo"
  //    Distinguiamo: confirmed = booking attualmente confermati; ghosted = quelli auto-cancellati.
  //    Numeratore: status='cancelled' AND autoCancelledAt IS NOT NULL nel range
  //    Denominatore: tutti i booking creati nel range (confermati + auto-cancellati + cancellati manualmente)
  const [{ confirmed }] = await sequelize.query(
    `SELECT COUNT(*)::int AS confirmed FROM bookings
       WHERE ${COUNTABLE_BOOKING_SQL}
         AND "startTime" BETWEEN $1 AND $2`,
    { bind: [range.from, range.to], type: sequelize.QueryTypes.SELECT },
  );
  const [{ ghosted }] = await sequelize.query(
    `SELECT COUNT(*)::int AS ghosted FROM bookings
       WHERE "autoCancelledAt" IS NOT NULL
         AND "deletedAt" IS NULL
         AND "startTime" BETWEEN $1 AND $2`,
    { bind: [range.from, range.to], type: sequelize.QueryTypes.SELECT },
  );
  const [{ totalCreated }] = await sequelize.query(
    `SELECT COUNT(*)::int AS "totalCreated" FROM bookings
       WHERE "deletedAt" IS NULL
         AND "startTime" BETWEEN $1 AND $2`,
    { bind: [range.from, range.to], type: sequelize.QueryTypes.SELECT },
  );
  const noShowRate = noShowRatePct(ghosted, totalCreated);

  // 5) Trend ultimi 8 settimane indipendentemente dal range (vista "memoria storica")
  //    date_trunc('week') con AT TIME ZONE <fuso istituto>: la "settimana"
  //    inizia il lunedì italiano. Senza la conversione, su VPS UTC i
  //    booking notturni di domenica italiana finiscono nella settimana
  //    precedente UTC, falsando il trend.
  const trendRows = await sequelize.query(
    `SELECT
         to_char(date_trunc('week', "startTime" AT TIME ZONE ${TZ_SQL}), 'YYYY-MM-DD') AS week_start,
         COUNT(*)::int AS count,
         (SUM(${bookedMinutesSql()}))::float AS minutes
       FROM bookings
       WHERE ${COUNTABLE_BOOKING_SQL}
         AND "startTime" >= $1
       GROUP BY week_start
       ORDER BY week_start ASC`,
    {
      bind: [institutionTime.startOfIsoWeek(dayjs(institutionTime.now()).subtract(8, 'week'))],
      type: sequelize.QueryTypes.SELECT,
    },
  );
  const trend = mapTrendRows(trendRows);

  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    summary: {
      confirmedBookings: confirmed,
      ghostedBookings: ghosted,
      totalCreated,
      noShowRatePct: noShowRate,
    },
    heatmap,
    topRooms,
    topUsers,
    trend,
  };
}

module.exports = {
  gatherAnalytics,
  // esposti per i test unitari (parte pura)
  bookedMinutesSql,
  COUNTABLE_BOOKING_SQL,
  countableBookingWhere,
  minutesToHours,
  buildHeatmap,
  mapTopRooms,
  mapTopUsers,
  mapTrendRows,
  noShowRatePct,
};
