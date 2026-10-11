'use strict';

const { Op } = require('sequelize');

// I conteggi /usage/me e la disponibilità /availability ragionano su
// "giorno solare" e "settimana ISO" istituzionali (Europe/Rome). Su un
// VPS UTC vicino a mezzanotte italiana il dayStart può cadere il giorno
// prima/dopo, falsando i totali ora.
const DEFAULT_TZ = 'Europe/Rome';

const { Booking, Room, User } = require('../../models');
const { authenticate } = require('../../middleware/auth');

const { BookingRule } = require('../../models');
const { dayjs } = require('./shared');

module.exports = function registerAvailability(router) {
  // =====================================================
  // GET /api/bookings/usage/me
  // Restituisce ore prenotate / residue per l'utente corrente,
  // settimanali e giornaliere (settimana ISO lun→dom, giorno odierno).
  // =====================================================
  router.get('/usage/me', authenticate, async (req, res, next) => {
    try {
      const rule = await BookingRule.findOne({ where: { role: req.user.role } });
      const nowLocal = dayjs().tz(DEFAULT_TZ);
      const weekStart = nowLocal.startOf('isoWeek').toDate();
      const weekEnd = nowLocal.endOf('isoWeek').toDate();
      const dayStart = nowLocal.startOf('day').toDate();
      const dayEnd = nowLocal.endOf('day').toDate();

      // P1-3: caricamento booking con `attributes` selettivi (riduce payload
      // ~80% rispetto al fetch dei record completi) + `roomId` invece di
      // include Room → faremo un singolo round-trip aggiuntivo per Room.type.
      // Una query include con N JOIN per N booking è più costoso di 1 query
      // base + 1 query Room IN (touchedRoomIds).
      const [weekBookings, dayBookings] = await Promise.all([
        Booking.findAll({
          where: {
            userId: req.user.id,
            status: 'confirmed',
            startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd },
          },
          attributes: ['id', 'roomId', 'startTime', 'endTime'],
        }),
        Booking.findAll({
          where: {
            userId: req.user.id,
            status: 'confirmed',
            startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
          },
          attributes: ['id', 'roomId', 'startTime', 'endTime'],
        }),
      ]);

      const minutesOf = (b) => dayjs(b.endTime).diff(dayjs(b.startTime), 'minute');
      const round1 = (mins) => Math.round(mins / 6) / 10; // minuti → ore con 1 decimale

      const weekUsed = round1(weekBookings.reduce((a, b) => a + minutesOf(b), 0));
      const dayUsed = round1(dayBookings.reduce((a, b) => a + minutesOf(b), 0));
      const isAdmin = req.user.role === 'admin';
      const weekMax = rule?.maxHoursPerWeek ?? null;
      const dayMax = rule?.maxHoursPerDay ?? null;

      // -------- Quote per risorsa: aggregazione consumi per scope --------
      // Recuperiamo le quote attive del ruolo e pre-aggreghiamo i consumi
      // PER TIPO (room.type, equipment.type) UNA SOLA VOLTA. Le quote
      // diventano lookup O(1) sulle Map invece di un O(N×Q) filter+reduce.
      // Per un coordinatore admin con 200 booking/sett × 10 quote attive,
      // passa da ~2000 iterazioni filter a 1 build + 10 lookup.
      const { BookingQuota, Equipment } = require('../../models');
      const quotas = await BookingQuota.findAll({
        where: { role: req.user.role, isActive: true },
      });

      // Solo se ci sono quote: altrimenti niente da aggregare.
      let weekMinutesByRoomType = new Map();
      let dayMinutesByRoomType = new Map();
      let weekMinutesByEquipType = new Map();
      let dayMinutesByEquipType = new Map();

      if (quotas.length > 0) {
        // Pre-fetch room types in batch per le stanze toccate.
        const touchedRoomIds = [
          ...new Set([...weekBookings.map((b) => b.roomId), ...dayBookings.map((b) => b.roomId)]),
        ];
        const roomTypeById = new Map();
        const equipByRoom = new Map();
        if (touchedRoomIds.length > 0) {
          // 2 query parallele invece di 2 sequenziali.
          const [rooms, eqs] = await Promise.all([
            Room.findAll({
              where: { id: { [Op.in]: touchedRoomIds } },
              attributes: ['id', 'type'],
            }),
            Equipment.findAll({
              where: { roomId: { [Op.in]: touchedRoomIds } },
              attributes: ['roomId', 'type'],
            }),
          ]);
          for (const r of rooms) roomTypeById.set(r.id, r.type);
          for (const e of eqs) {
            if (!equipByRoom.has(e.roomId)) equipByRoom.set(e.roomId, new Set());
            equipByRoom.get(e.roomId).add(e.type);
          }
        }

        // Aggregazione single-pass: per ogni booking aggiungi i suoi minuti
        // alle Map by-room-type e by-equipment-type. O(N booking × E equip/room),
        // tipicamente E ≤ 5 → O(5N).
        const aggregate = (bookings, mapRoomType, mapEquipType) => {
          for (const b of bookings) {
            const m = minutesOf(b);
            const rt = roomTypeById.get(b.roomId);
            if (rt) {
              mapRoomType.set(rt, (mapRoomType.get(rt) ?? 0) + m);
            }
            const equipTypes = equipByRoom.get(b.roomId);
            if (equipTypes) {
              for (const et of equipTypes) {
                mapEquipType.set(et, (mapEquipType.get(et) ?? 0) + m);
              }
            }
          }
        };
        aggregate(weekBookings, weekMinutesByRoomType, weekMinutesByEquipType);
        aggregate(dayBookings, dayMinutesByRoomType, dayMinutesByEquipType);
      }

      // Pre-calcolato fuori dalla closure per evitare di ricalcolarlo per ogni quota.
      const totalWeekMinutes = weekBookings.reduce((a, b) => a + minutesOf(b), 0);
      const totalDayMinutes = dayBookings.reduce((a, b) => a + minutesOf(b), 0);

      // Lookup O(1) per scope. `global` somma tutto, `roomType`/`equipmentType`
      // chiavato sulle Map pre-aggregate.
      const minutesForQuotaScope = (quota, periodKind) => {
        if (quota.scopeKind === 'global') {
          return periodKind === 'week' ? totalWeekMinutes : totalDayMinutes;
        }
        if (quota.scopeKind === 'roomType') {
          const m = periodKind === 'week' ? weekMinutesByRoomType : dayMinutesByRoomType;
          return m.get(quota.scopeValue) ?? 0;
        }
        if (quota.scopeKind === 'equipmentType') {
          const m = periodKind === 'week' ? weekMinutesByEquipType : dayMinutesByEquipType;
          return m.get(quota.scopeValue) ?? 0;
        }
        return 0;
      };

      const quotaUsage = quotas.map((q) => {
        const usedWeek = q.maxHoursPerWeek > 0 ? round1(minutesForQuotaScope(q, 'week')) : 0;
        const usedDay = q.maxHoursPerDay > 0 ? round1(minutesForQuotaScope(q, 'day')) : 0;
        return {
          id: q.id,
          scopeKind: q.scopeKind,
          scopeValue: q.scopeKind === 'global' ? null : q.scopeValue,
          maxHoursPerWeek: q.maxHoursPerWeek,
          maxHoursPerDay: q.maxHoursPerDay,
          usedHoursWeek: usedWeek,
          usedHoursDay: usedDay,
          remainingHoursWeek:
            q.maxHoursPerWeek > 0
              ? Math.max(0, Math.round((q.maxHoursPerWeek - usedWeek) * 10) / 10)
              : null,
          remainingHoursDay:
            q.maxHoursPerDay > 0
              ? Math.max(0, Math.round((q.maxHoursPerDay - usedDay) * 10) / 10)
              : null,
        };
      });

      // Per comodità del frontend, separiamo le quote per scope in 3 array.
      // Gli admin sono "unlimited" rispetto a BookingRule ma le BookingQuota
      // del loro ruolo, se attive, vengono comunque applicate dal validator
      // (futura politica): le ritorniamo per trasparenza.
      const byRoomType = quotaUsage.filter((q) => q.scopeKind === 'roomType');
      const byEquipment = quotaUsage.filter((q) => q.scopeKind === 'equipmentType');
      const globalQuotas = quotaUsage.filter((q) => q.scopeKind === 'global');

      res.json({
        unlimited: isAdmin,
        // Backward-compat: i due blocchi `weekly` e `daily` non cambiano.
        weekly: {
          max: weekMax,
          usedHours: weekUsed,
          remainingHours:
            weekMax != null && !isAdmin
              ? Math.max(0, Math.round((weekMax - weekUsed) * 10) / 10)
              : null,
          periodFrom: dayjs(weekStart).format('YYYY-MM-DD'),
          periodTo: dayjs(weekEnd).format('YYYY-MM-DD'),
        },
        daily: {
          max: dayMax,
          usedHours: dayUsed,
          remainingHours:
            dayMax != null && !isAdmin
              ? Math.max(0, Math.round((dayMax - dayUsed) * 10) / 10)
              : null,
        },
        // Nuovo: aggregazione per quote dinamiche.
        global: globalQuotas,
        byRoomType,
        byEquipment,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/availability/:roomId', authenticate, async (req, res) => {
    const roomId = Number.parseInt(req.params.roomId, 10);
    if (!Number.isInteger(roomId)) {
      return res.status(400).json({ error: 'roomId non valido' });
    }
    // Il parametro `date` è YYYY-MM-DD (calendario italiano). Il filtro
    // [dayStart, dayEnd] deve essere il giorno solare Europe/Rome:
    // un concerto delle 22:30 italiane = 20:30 UTC, su VPS UTC sarebbe
    // fuori da [00:00 UTC, 23:59 UTC] di "ieri".
    const dateStr = req.query.date ? String(req.query.date) : null;
    const parsed = dateStr ? dayjs.tz(dateStr, DEFAULT_TZ) : dayjs().tz(DEFAULT_TZ);
    const date = parsed.isValid() ? parsed : dayjs().tz(DEFAULT_TZ);
    const dayStart = date.startOf('day').toDate();
    const dayEnd = date.endOf('day').toDate();

    const bookings = await Booking.findAll({
      where: {
        roomId,
        status: 'confirmed',
        startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'role'] }],
      order: [['startTime', 'ASC']],
    });

    res.json({ date: date.format('YYYY-MM-DD'), bookings });
  });
};
