'use strict';

const express = require('express');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const {
  Booking,
  Room,
  Building,
  Institute,
  User,
  ConcertInfo,
  Announcement,
} = require('../models');

// Etichetta da mostrare nel display pubblico in base al ruolo del prenotante.
// - admin    → "Direzione" (anonimizzato)
// - docente  → "Prof. Nome Cognome"
// - studente → "Stud." (anonimizzato)
function bookedByLabel(user) {
  if (!user) return null;
  if (user.role === 'admin') return 'Direzione';
  if (user.role === 'docente') {
    return `Prof. ${user.firstName ?? ''} ${user.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
  }
  return 'Stud.';
}

dayjs.extend(isoWeek);
dayjs.extend(utc);
dayjs.extend(timezone);

// Widget pubblici (display kiosk + landing istituto): le fasce orarie
// del giorno e l'identificazione del "prossimo concerto oggi" devono
// essere in ora italiana, non nel TZ del processo Node.
const PUBLIC_TZ = 'Europe/Rome';

const router = express.Router();

// Helper: minutes between two date-like values
const minutesBetween = (start, end) =>
  Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);

// =====================================================
// GET /api/public/institute
// Minimal institute info for the public display header
// =====================================================
router.get('/institute', async (req, res) => {
  const inst = await Institute.findOne({
    attributes: ['id', 'name', 'code', 'city', 'logoUrl', 'copyright'],
    order: [['id', 'ASC']],
  });
  res.json({ institute: inst });
});

// =====================================================
// GET /api/public/display-config
// Configurazione di rotazione del kiosk /display.
// Restituisce solo gli edifici con displayEnabled=true, ordinati per nome,
// con il loro intervallo di visualizzazione in secondi.
// Usato dal client per ciclare un edificio alla volta.
// =====================================================
router.get('/display-config', async (req, res) => {
  const buildings = await Building.findAll({
    where: { displayEnabled: true },
    attributes: [
      'id',
      'code',
      'name',
      'displayIntervalSec',
      'displayBookingsEnabled',
      'displayConcertsDays',
      'displayConcertsEnabled',
      'displayConcertsCount',
      'displayConcertsIntervalSec',
      'displayAnnouncementsEnabled',
      'displayAnnouncementsCount',
      'displayAnnouncementsIntervalSec',
      'displayAnnouncementsPinnedOnly',
      'displayViewMode',
    ],
    order: [['name', 'ASC']],
  });
  res.json({
    buildings: buildings.map((b) => ({
      id: b.id,
      code: b.code ?? null,
      name: b.name,
      intervalSec: Math.max(5, Math.min(600, b.displayIntervalSec || 30)),
      bookingsEnabled: b.displayBookingsEnabled !== false,
      concertsEnabled: b.displayConcertsEnabled !== false,
      concertsDays: Math.max(0, Math.min(365, b.displayConcertsDays ?? 30)),
      concertsCount: Math.max(0, Math.min(50, b.displayConcertsCount ?? 0)),
      concertsIntervalSec: Math.max(5, Math.min(600, b.displayConcertsIntervalSec ?? 15)),
      announcementsEnabled: b.displayAnnouncementsEnabled !== false,
      announcementsCount: Math.max(0, Math.min(30, b.displayAnnouncementsCount ?? 5)),
      announcementsIntervalSec: Math.max(5, Math.min(600, b.displayAnnouncementsIntervalSec ?? 12)),
      announcementsPinnedOnly: b.displayAnnouncementsPinnedOnly === true,
      viewMode: b.displayViewMode === 'daily' ? 'daily' : 'weekly',
    })),
  });
});

// =====================================================
// GET /api/public/concerts?days=N
// Concerti confermati nelle prossime N giornate (incluso oggi).
// `N` è clampato a [0, 365]; default 30. Restituisce solo le booking di
// tipo 'concerto' con scheda informativa associata, ordinate per startTime.
// =====================================================
router.get('/concerts', async (req, res) => {
  // Number(undefined)=NaN → fallback 30; Number('0')=0 → rispetta lo "0=disattivato"
  const raw = Number(req.query.days);
  const days = Math.max(0, Math.min(365, Number.isFinite(raw) ? raw : 30));
  if (days === 0) return res.json({ concerts: [] });

  const now = dayjs();
  const horizon = now.add(days, 'day').endOf('day').toDate();

  const concerts = await Booking.findAll({
    where: {
      type: 'concerto',
      status: 'confirmed',
      endTime: { [Op.gt]: now.toDate() },
      startTime: { [Op.lte]: horizon },
    },
    include: [
      { model: ConcertInfo, as: 'concertInfo', required: true },
      {
        model: Room,
        as: 'room',
        attributes: ['id', 'name', 'floor'],
        include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
      },
    ],
    order: [['startTime', 'ASC']],
  });

  res.json({
    concerts: concerts.map((b) => ({
      id: b.id,
      startTime: b.startTime,
      endTime: b.endTime,
      title: b.concertInfo.title,
      performers: b.concertInfo.performers || '',
      program: b.concertInfo.program || '',
      posterUrl: b.concertInfo.posterUrl || null,
      room: b.room
        ? {
            id: b.room.id,
            name: b.room.name,
            floor: b.room.floor,
            building: b.room.building
              ? { id: b.room.building.id, name: b.room.building.name }
              : null,
          }
        : null,
    })),
  });
});

// =====================================================
// GET /api/public/agenda
// Bookings grouped by building and room. Modalità:
//   - default / ?date=YYYY-MM-DD              → giornata singola (legacy)
//   - ?from=YYYY-MM-DD&to=YYYY-MM-DD          → range custom (kiosk weekly)
// Range max consentito: 14 giorni. Nessuna identità utente esposta;
// PublicBooking.bookedBy.lastName è usato dalla weekly view per costruire
// "Prof. {cognome}". concertTitle è popolato per type='concerto'.
// =====================================================
router.get('/agenda', async (req, res) => {
  let rangeStart;
  let rangeEnd;
  let responseDate; // mantenuto per backward compat (legacy daily clients)
  if (req.query.from || req.query.to) {
    const from = dayjs(req.query.from);
    const to = dayjs(req.query.to);
    if (!from.isValid() || !to.isValid()) {
      return res.status(400).json({ error: 'Range non valido' });
    }
    if (to.diff(from, 'day') > 14) {
      return res.status(400).json({ error: 'Range troppo ampio (max 14 giorni)' });
    }
    rangeStart = from.startOf('day').toDate();
    rangeEnd = to.endOf('day').toDate();
    responseDate = from.format('YYYY-MM-DD');
  } else {
    const date = req.query.date ? dayjs(req.query.date) : dayjs();
    if (!date.isValid()) return res.status(400).json({ error: 'Data non valida' });
    rangeStart = date.startOf('day').toDate();
    rangeEnd = date.endOf('day').toDate();
    responseDate = date.format('YYYY-MM-DD');
  }

  const buildings = await Building.findAll({
    include: [
      { model: Institute, as: 'institute', attributes: ['id', 'name'] },
      {
        model: Room,
        as: 'rooms',
        where: { isBookable: true },
        required: false,
        include: [
          {
            model: Booking,
            as: 'bookings',
            required: false,
            where: {
              status: 'confirmed',
              startTime: { [Op.lt]: rangeEnd },
              endTime: { [Op.gt]: rangeStart },
            },
            attributes: ['id', 'startTime', 'endTime', 'type', 'purpose'],
            include: [
              {
                model: User,
                as: 'user',
                attributes: ['firstName', 'lastName', 'role'],
              },
              {
                model: ConcertInfo,
                as: 'concertInfo',
                attributes: ['title'],
                required: false,
              },
            ],
          },
        ],
      },
    ],
    order: [
      ['name', 'ASC'],
      [{ model: Room, as: 'rooms' }, 'name', 'ASC'],
    ],
  });

  const data = buildings.map((b) => ({
    id: b.id,
    code: b.code ?? null,
    name: b.name,
    floors: b.floors,
    displayViewMode: b.displayViewMode || 'weekly',
    institute: b.institute ? { id: b.institute.id, name: b.institute.name } : null,
    rooms: (b.rooms || []).map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code ?? null,
      floor: r.floor,
      type: r.type,
      capacity: r.capacity,
      bookings: (r.bookings || [])
        .map((bk) => ({
          id: bk.id,
          startTime: bk.startTime,
          endTime: bk.endTime,
          type: bk.type,
          purpose: bk.purpose || null,
          concertTitle: bk.concertInfo ? bk.concertInfo.title : null,
          bookedBy: bk.user
            ? {
                role: bk.user.role,
                displayName: bookedByLabel(bk.user),
                // Nome e cognome esposti SOLO per i docenti (per costruire
                // "Prof. {cognome}" lato kiosk e per disambiguare cognomi
                // omonimi inserendo l'iniziale del nome → "Prof. M. Rossi").
                // Per admin/studenti restituiamo null così il client non può
                // accidentalmente comporre etichette tipo "Prof. Sistema"
                // anche con bundle datati.
                firstName: bk.user.role === 'docente' ? (bk.user.firstName ?? null) : null,
                lastName: bk.user.role === 'docente' ? (bk.user.lastName ?? null) : null,
              }
            : null,
        }))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
    })),
  }));

  res.json({ date: responseDate, buildings: data });
});

// =====================================================
// GET /api/public/stats
// Institute-wide occupancy & activity KPIs (no user data).
// =====================================================
router.get('/stats', async (req, res) => {
  const now = dayjs();
  const dayStart = now.startOf('day').toDate();
  const dayEnd = now.endOf('day').toDate();
  const weekStart = now.startOf('isoWeek').toDate();
  const weekEnd = now.endOf('isoWeek').toDate();
  const nowDate = now.toDate();

  const [roomsTotal, todayBookings, weekBookings] = await Promise.all([
    // Defense-in-depth: i delete handler ora cascadano il soft-delete e la
    // migration cleanup-orphan-rooms-and-buildings sistema lo storico, ma
    // qui filtriamo comunque via Building→Institute (required: true) per
    // escludere eventuali aule orfane sopravvissute. Senza questo, KPI
    // "Aule attive" su /display includerebbe rooms con parent paranoid-
    // deleted (non visibili dall'admin Structure → numeri non allineati).
    Room.count({
      where: { isBookable: true },
      include: [
        {
          model: Building,
          as: 'building',
          attributes: [],
          required: true,
          include: [{ model: Institute, as: 'institute', attributes: [], required: true }],
        },
      ],
      distinct: true,
      col: 'id',
    }),
    Booking.findAll({
      where: {
        status: 'confirmed',
        startTime: { [Op.lt]: dayEnd },
        endTime: { [Op.gt]: dayStart },
      },
      attributes: ['id', 'roomId', 'startTime', 'endTime', 'type', 'purpose'],
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'name'],
          include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
        },
      ],
    }),
    Booking.findAll({
      where: {
        status: 'confirmed',
        startTime: { [Op.lt]: weekEnd },
        endTime: { [Op.gt]: weekStart },
      },
      attributes: ['id', 'roomId', 'startTime', 'endTime', 'type', 'purpose'],
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'name'],
          include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
        },
      ],
    }),
  ]);

  const inUseRoomIds = new Set(
    todayBookings
      .filter(
        (b) =>
          new Date(b.startTime).getTime() <= nowDate.getTime() &&
          new Date(b.endTime).getTime() > nowDate.getTime(),
      )
      .map((b) => b.roomId),
  );

  const todayHours = todayBookings.reduce(
    (sum, b) => sum + minutesBetween(b.startTime, b.endTime),
    0,
  );
  const weekHours = weekBookings.reduce(
    (sum, b) => sum + minutesBetween(b.startTime, b.endTime),
    0,
  );

  // Top rooms by booked minutes this week
  const roomMap = new Map();
  for (const bk of weekBookings) {
    const r = bk.room;
    if (!r) continue;
    const key = r.id;
    if (!roomMap.has(key)) {
      roomMap.set(key, {
        id: r.id,
        name: r.name,
        building: r.building?.name ?? '',
        minutes: 0,
        count: 0,
      });
    }
    const entry = roomMap.get(key);
    entry.minutes += minutesBetween(bk.startTime, bk.endTime);
    entry.count += 1;
  }
  const topRooms = Array.from(roomMap.values())
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  // Booking types breakdown today
  const typeMap = new Map();
  for (const bk of todayBookings) {
    typeMap.set(bk.type, (typeMap.get(bk.type) || 0) + 1);
  }
  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Hour-by-hour booking count today (07-23) — fasce orarie in ora italiana
  // anche se il processo Node gira in UTC (container/CI/VPS managed).
  const buckets = new Array(24).fill(0);
  for (const bk of todayBookings) {
    const sh = Math.max(0, dayjs(bk.startTime).tz(PUBLIC_TZ).hour());
    const eh = Math.min(24, dayjs(bk.endTime).tz(PUBLIC_TZ).hour() + 1);
    for (let h = sh; h < eh; h++) buckets[h] += 1;
  }
  const bookingsByHour = buckets
    .map((count, hour) => ({ hour, count }))
    .filter((b) => b.hour >= 7 && b.hour <= 23);

  // Next concerto today (special event highlight)
  const nextConcert =
    todayBookings
      .filter((b) => b.type === 'concerto' && new Date(b.startTime).getTime() > nowDate.getTime())
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0] || null;

  res.json({
    timestamp: now.toISOString(),
    today: {
      bookings: todayBookings.length,
      inUse: inUseRoomIds.size,
      roomsTotal,
      hours: Math.round((todayHours / 60) * 10) / 10,
      occupancyPct: roomsTotal > 0 ? Math.round((inUseRoomIds.size / roomsTotal) * 100) : 0,
    },
    week: {
      bookings: weekBookings.length,
      hours: Math.round((weekHours / 60) * 10) / 10,
    },
    topRooms,
    byType,
    bookingsByHour,
    nextConcert: nextConcert
      ? {
          startTime: nextConcert.startTime,
          endTime: nextConcert.endTime,
          purpose: nextConcert.purpose || null,
          room: nextConcert.room
            ? {
                name: nextConcert.room.name,
                building: nextConcert.room.building?.name ?? '',
              }
            : null,
        }
      : null,
  });
});

// =====================================================
// GET /api/public/announcements
// Avvisi attivi pubblicabili sul kiosk. Filtri:
//   - ?pinned=true  → solo i pinned (default per la rotazione /display)
//   - ?building=ID  → solo gli avvisi che hanno audience='all' o
//                     audience.building={value:ID} (kiosk per-edificio)
//   - ?limit=N      → cap sul numero (default 10, max 30)
// Non richiede auth: il display kiosk è pubblico.
// =====================================================
router.get('/announcements', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(30, parseInt(req.query.limit, 10) || 10));
    const pinnedOnly = req.query.pinned === 'true';
    const buildingId = req.query.building ? Number(req.query.building) : null;
    const now = new Date();

    const where = {
      isActive: true,
      publishedAt: { [Op.lte]: now },
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }],
    };
    if (pinnedOnly) where.isPinned = true;

    const all = await Announcement.findAll({
      where,
      order: [
        ['isPinned', 'DESC'],
        ['publishedAt', 'DESC'],
      ],
      limit: limit * 2, // overfetch per filtro audience.building
    });

    // Filtro audience compatibile col kiosk: 'all' sempre; 'building' solo
    // se buildingId match (o se non specificato → tutti i building);
    // 'role'/'course' NON sono pertinenti per il display pubblico → escluse.
    const visible = all
      .filter((a) => {
        const aud = a.audience || { kind: 'all' };
        if (aud.kind === 'all') return true;
        if (aud.kind === 'building') {
          if (buildingId == null) return true; // kiosk generico → mostra
          return Number(aud.value) === buildingId;
        }
        return false;
      })
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        publishedAt: a.publishedAt,
        expiresAt: a.expiresAt,
        isPinned: a.isPinned,
      }));

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ announcements: visible });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
