'use strict';

/**
 * Calcolo puro delle statistiche del kiosk /display (GET /api/public/stats).
 *
 * Nessun accesso a DB né al clock globale: la route esegue le query e
 * passa prenotazioni e `now`; qui si aggrega. Giorno, settimana e fasce
 * orarie sono quelli dell'istituto (lib/institutionTime).
 */

const institutionTime = require('../lib/institutionTime');

const MINUTES_PER_DAY = 24 * 60;
const HOUR_FROM = 7;
const HOUR_TO = 23;

const ms = (at) => new Date(at).getTime();
const minutesBetween = (start, end) => Math.max(0, (ms(end) - ms(start)) / 60000);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Fasce orarie (0-23) occupate da una prenotazione nel giorno `todayIso`.
 * Semantica «fascia occupata»: l'istante finale è esclusivo, quindi
 * 09:00-10:00 occupa solo la fascia 9, 09:30-10:30 le fasce 9 e 10.
 * Parti fuori dal giorno (inizio ieri / fine domani) sono tagliate;
 * fine <= inizio occupa la sola fascia di inizio.
 */
function occupiedHours(booking, todayIso) {
  const startMin =
    institutionTime.todayIso(booking.startTime) < todayIso
      ? 0
      : institutionTime.minutesOfDay(booking.startTime);
  let endMin =
    institutionTime.todayIso(booking.endTime) > todayIso
      ? MINUTES_PER_DAY
      : institutionTime.minutesOfDay(booking.endTime);
  if (endMin <= startMin) endMin = startMin + 1; // difensivo: durata nulla/negativa
  const first = Math.floor(startMin / 60);
  const last = Math.min(23, Math.floor((endMin - 1) / 60));
  const hours = [];
  for (let h = first; h <= last; h++) hours.push(h);
  return hours;
}

function computeKioskStats({ todayBookings = [], weekBookings = [], now, roomsTotal = 0 }) {
  const nowMs = ms(now);
  const todayIso = institutionTime.todayIso(now);

  const inUseRoomIds = new Set(
    todayBookings
      .filter((b) => ms(b.startTime) <= nowMs && ms(b.endTime) > nowMs)
      .map((b) => b.roomId),
  );

  const todayHours = todayBookings.reduce((s, b) => s + minutesBetween(b.startTime, b.endTime), 0);
  const weekHours = weekBookings.reduce((s, b) => s + minutesBetween(b.startTime, b.endTime), 0);

  const roomMap = new Map();
  for (const bk of weekBookings) {
    const r = bk.room;
    if (!r) continue;
    if (!roomMap.has(r.id)) {
      roomMap.set(r.id, {
        id: r.id,
        name: r.name,
        building: r.building?.name ?? '',
        minutes: 0,
        count: 0,
      });
    }
    const entry = roomMap.get(r.id);
    entry.minutes += minutesBetween(bk.startTime, bk.endTime);
    entry.count += 1;
  }
  const topRooms = Array.from(roomMap.values())
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const typeMap = new Map();
  for (const bk of todayBookings) typeMap.set(bk.type, (typeMap.get(bk.type) || 0) + 1);
  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const buckets = new Array(24).fill(0);
  for (const bk of todayBookings) {
    for (const h of occupiedHours(bk, todayIso)) buckets[h] += 1;
  }
  const bookingsByHour = buckets
    .map((count, hour) => ({ hour, count }))
    .filter((b) => b.hour >= HOUR_FROM && b.hour <= HOUR_TO);

  const nextConcert =
    todayBookings
      .filter((b) => b.type === 'concerto' && ms(b.startTime) > nowMs)
      .sort((a, b) => ms(a.startTime) - ms(b.startTime))[0] || null;

  return {
    timestamp: new Date(now).toISOString(),
    today: {
      bookings: todayBookings.length,
      inUse: inUseRoomIds.size,
      roomsTotal,
      hours: round1(todayHours / 60),
      occupancyPct: roomsTotal > 0 ? Math.round((inUseRoomIds.size / roomsTotal) * 100) : 0,
    },
    week: { bookings: weekBookings.length, hours: round1(weekHours / 60) },
    topRooms,
    byType,
    bookingsByHour,
    nextConcert: nextConcert
      ? {
          startTime: nextConcert.startTime,
          endTime: nextConcert.endTime,
          purpose: nextConcert.purpose || null,
          room: nextConcert.room
            ? { name: nextConcert.room.name, building: nextConcert.room.building?.name ?? '' }
            : null,
        }
      : null,
  };
}

module.exports = { computeKioskStats, occupiedHours };
