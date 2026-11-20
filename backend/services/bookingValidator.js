'use strict';

const dayjs = require('dayjs');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const { Op } = require('sequelize');
const {
  Booking,
  BookingRule,
  BookingRuleException,
  BookingQuota,
  Equipment,
  Room,
} = require('../models');
const institutionTime = require('../lib/institutionTime');
const rules = require('./bookingRules');

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const { STUDIO_MIN_DURATION_MINUTES, exceptionAppliesToDate, overlapsWindow, minutesInsideWindow } =
  rules;

/**
 * Crea un cache vuoto da passare a `validateBooking` quando si esegue la
 * stessa validazione N volte ravvicinate (es. POST /bookings/recurring con
 * 52 settimane). Memorizza:
 *   - BookingRule (1 record per ruolo, invariante per tutto il batch)
 *   - BookingQuota[] (lista record, invariante)
 *   - BookingRuleException[] (lista record, invariante)
 *   - Room (per roomId)
 *   - Equipment[] per roomId (per scopeKind=equipmentType)
 *   - Room.findAll per scope (roomType/building/equipmentType)
 *
 * Ogni chiamata a validateBooking che riceve `cache` evita di rifare quelle
 * query, riducendo da ~10-15 query/call a ~3-5 query/call dopo la prima.
 */
/**
 * Filtro per i conteggi di QUOTA (prenotazioni attive, ore/settimana, ore/giorno,
 * intervallo minimo, eccezioni a fascia oraria, quote per risorsa).
 *
 * Le prenotazioni generate dal monte ore (origin='monte_ore') non consumano le
 * quote delle prenotazioni libere: il docente può prenotare altre aule oltre al
 * proprio piano. NON va usato nei controlli di conflitto (aula occupata, utente
 * già impegnato altrove), dove quelle prenotazioni devono continuare a contare.
 */
const COUNTS_TOWARD_QUOTAS = { origin: { [Op.ne]: 'monte_ore' } };

function createValidationCache() {
  return {
    rule: new Map(), // role → BookingRule
    quotas: new Map(), // role → BookingQuota[]
    exceptions: new Map(), // role → BookingRuleException[] (incluso 'all')
    room: new Map(), // roomId → Room
    roomEquipmentTypes: new Map(), // roomId → Set<string>
    roomsByType: new Map(), // type → number[] (room ids)
    roomsByBuilding: new Map(), // buildingId → number[]
    roomsByEquipment: new Map(), // equipmentType → number[]
  };
}

/**
 * Valida una richiesta di prenotazione rispetto alle regole del ruolo,
 * disponibilità della stanza e permessi.
 *
 * Restituisce `{ valid, issues }` con `issues: [{ message, code|null }]`
 * (messaggio e codice strutturato viaggiano insieme). Per compatibilità sono
 * presenti anche `errors` (= messaggi) e `codes` (= codici, null se assente),
 * derivati da `issues` e quindi sempre allineati.
 *
 * Le regole pure (finestre, durate, anticipo) vivono in ./bookingRules; qui
 * restano i lookup al DB (stanza, regole, conflitti, quote, eccezioni).
 */
function buildResult(issues) {
  return {
    valid: issues.length === 0,
    issues,
    errors: issues.map((i) => i.message),
    codes: issues.map((i) => i.code),
  };
}

async function validateBooking({
  user,
  roomId,
  startTime,
  endTime,
  type = null,
  ignoreBookingId = null,
  bypassQuotas = false,
  bypassAdvance = false,
  bypassPastDates = false,
  bypassDuration = false,
  transaction = null,
  cache = null,
}) {
  const issues = [];
  const tx = transaction ? { transaction } : {};
  const push = (message, code = null) => issues.push({ message, code });
  const pushAll = (list) => issues.push(...list);

  const start = dayjs(startTime);
  const end = dayjs(endTime);
  const now = institutionTime.now();

  // ---- Controlli base sulle date ----
  if (!start.isValid() || !end.isValid()) {
    return buildResult([{ message: 'Date non valide', code: null }]);
  }
  pushAll(rules.endAfterStartIssues(start, end));
  pushAll(rules.notInPastIssues(start, now, { bypassPastDates }));

  // ---- Verifica esistenza stanza (cached) ----
  let room;
  if (cache?.room.has(roomId)) {
    room = cache.room.get(roomId);
  } else {
    room = await Room.findByPk(roomId, tx);
    if (cache) cache.room.set(roomId, room);
  }
  if (!room) return buildResult([{ message: 'Aula non trovata', code: null }]);
  if (!room.isBookable) push('Questa aula non è prenotabile');

  // ---- Verifica permessi sull'aula (ruolo) ----
  if (
    Array.isArray(room.allowedRoles) &&
    room.allowedRoles.length > 0 &&
    !room.allowedRoles.includes(user.role)
  ) {
    push(`Il tuo ruolo (${user.role}) non può prenotare questa aula`);
  }

  // ---- Verifica permessi sull'aula (corso) ----
  if (
    Array.isArray(room.allowedCourseIds) &&
    room.allowedCourseIds.length > 0 &&
    user.role !== 'admin' &&
    (!user.courseId || !room.allowedCourseIds.includes(user.courseId))
  ) {
    push('Il tuo corso non è abilitato a prenotare questa aula');
  }

  // ---- Recupera le regole del ruolo (cached) ----
  let rule;
  if (cache?.rule.has(user.role)) {
    rule = cache.rule.get(user.role);
  } else {
    rule = await BookingRule.findOne({ where: { role: user.role }, ...tx });
    if (cache) cache.rule.set(user.role, rule);
  }
  if (!rule) {
    return buildResult([
      { message: `Nessuna regola configurata per il ruolo ${user.role}`, code: null },
    ]);
  }

  // ---- Regole pure: durata, anticipo, fascia oraria ----
  // `bypassDuration` / `bypassAdvance`: usati dal generator monte ore per
  // espandere pattern già approvati (lezioni lunghe, intero AA in anticipo).
  const durationMin = end.diff(start, 'minute');
  pushAll(rules.durationIssues({ durationMin, rule, type, bypassDuration }));
  pushAll(rules.advanceIssues({ start, now, rule, bypassAdvance }));
  pushAll(rules.allowedWindowIssues({ start, end, rule }));

  // ---- Conflitti con altre prenotazioni nella stessa aula ----
  const conflictWhere = {
    roomId,
    status: 'confirmed',
    [Op.and]: [{ startTime: { [Op.lt]: end.toDate() } }, { endTime: { [Op.gt]: start.toDate() } }],
  };
  if (ignoreBookingId) conflictWhere.id = { [Op.ne]: ignoreBookingId };

  const conflict = await Booking.findOne({ where: conflictWhere, ...tx });
  if (conflict) {
    // Emettiamo il code strutturato BOOKING_CONFLICT così il route lo
    // propaga al middleware errori → il frontend lo riconosce e offre
    // l'iscrizione alla waitlist via dialog.
    push('Aula già prenotata in questa fascia oraria', 'BOOKING_CONFLICT');
  }

  // ---- Conflitto logico utente cross-aula ----
  // Stesso utente, sovrapposizione temporale, AULA DIVERSA: l'utente
  // risulterebbe contemporaneamente in due aule. La constraint EXCLUDE su
  // `bookings` copre la stessa aula (sopra), questo check copre il resto.
  // Bypassato per admin che prenota per conto altrui (bypassQuotas) e
  // per il generator monte ore — patterns concentrici dei docenti su più
  // strumenti possono legittimamente sovrapporsi in batch automatici.
  if (!bypassQuotas) {
    const userOverlap = await Booking.findOne({
      where: {
        userId: user.id,
        status: 'confirmed',
        roomId: { [Op.ne]: roomId },
        startTime: { [Op.lt]: end.toDate() },
        endTime: { [Op.gt]: start.toDate() },
        ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
      },
      attributes: ['id', 'roomId', 'startTime', 'endTime'],
      ...tx,
    });
    if (userOverlap) {
      push(
        "Hai già una prenotazione in un'altra aula in questa fascia oraria",
        'USER_LOGICAL_CONFLICT',
      );
    }
  }

  // Gli admin bypassano i limiti quantitativi (max bookings/ore).
  // `bypassQuotas` permette ad un admin di prenotare per conto di un altro
  // utente saltando le quote del target (l'admin si assume la responsabilità).
  if (user.role !== 'admin' && !bypassQuotas) {
    // ---- Numero massimo prenotazioni attive ----
    const activeWhere = {
      userId: user.id,
      status: 'confirmed',
      ...COUNTS_TOWARD_QUOTAS,
      endTime: { [Op.gt]: now },
    };
    if (ignoreBookingId) activeWhere.id = { [Op.ne]: ignoreBookingId };
    const activeCount = await Booking.count({ where: activeWhere, ...tx });
    if (activeCount >= rule.maxActiveBookings) {
      push(`Hai raggiunto il limite di ${rule.maxActiveBookings} prenotazioni attive`);
    }

    // ---- Ore prenotate nella settimana (ISO: Lun-Dom) ----
    // Coerente con quote check (riga 413) e con /usage/me lato frontend,
    // che usano isoWeek. Senza questo allineamento, una prenotazione di
    // domenica veniva contata in settimane diverse dai due check.
    const weekStart = institutionTime.startOfIsoWeek(start);
    const weekEnd = institutionTime.endOfIsoWeek(start);
    const weekBookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        ...COUNTS_TOWARD_QUOTAS,
        startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd },
        ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
      },
      // Riduciamo il payload: serve solo (start, end) per il calcolo minutes.
      attributes: ['startTime', 'endTime'],
      ...tx,
    });
    const minutesThisWeek = weekBookings.reduce(
      (acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'),
      0,
    );
    const totalIfAdded = minutesThisWeek + durationMin;
    if (totalIfAdded > rule.maxHoursPerWeek * 60) {
      push(
        `Limite settimanale superato: max ${rule.maxHoursPerWeek}h, ` +
          `già prenotate ${(minutesThisWeek / 60).toFixed(1)}h`,
      );
    }

    // ---- Ore prenotate nello stesso giorno ----
    const dayStart = institutionTime.startOfDay(start);
    const dayEnd = institutionTime.endOfDay(start);
    const dayBookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        ...COUNTS_TOWARD_QUOTAS,
        startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
        ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
      },
      // Solo (start, end) servono per la somma dei minuti.
      attributes: ['startTime', 'endTime'],
      ...tx,
    });
    const minutesThisDay = dayBookings.reduce(
      (acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'),
      0,
    );
    if (minutesThisDay + durationMin > rule.maxHoursPerDay * 60) {
      push(`Limite giornaliero superato: max ${rule.maxHoursPerDay}h al giorno`);
    }

    // ---- Intervallo minimo tra prenotazioni (cooldown) ----
    // Impedisce di concatenare più prenotazioni di durata massima per
    // aggirare il cap "ore al giorno" (es. cap 4h, durata max 2h →
    // 14:00–16:00 + 16:00–18:00). Cerca la prenotazione confermata più
    // vicina prima/dopo nella finestra [-cooldown, +cooldown] e verifica
    // il gap. Calcolo cross-day sui minuti astronomici.
    const cooldownMin = rule.minIntervalBetweenBookingsMinutes || 0;
    if (cooldownMin > 0) {
      const windowStart = start.subtract(cooldownMin, 'minute').toDate();
      const windowEnd = end.add(cooldownMin, 'minute').toDate();
      // Prenotazioni che potrebbero violare il cooldown: quelle che FINISCONO
      // dopo windowStart (gap "prima") o INIZIANO prima di windowEnd (gap
      // "dopo"). Usiamo l'AND per intersecare entrambi i criteri.
      const nearby = await Booking.findAll({
        where: {
          userId: user.id,
          status: 'confirmed',
          ...COUNTS_TOWARD_QUOTAS,
          endTime: { [Op.gt]: windowStart },
          startTime: { [Op.lt]: windowEnd },
          ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
        },
        attributes: ['startTime', 'endTime'],
        ...tx,
      });
      for (const b of nearby) {
        const bStart = dayjs(b.startTime);
        const bEnd = dayjs(b.endTime);
        // Le sovrapposizioni vere sono già gestite dal check
        // USER_LOGICAL_CONFLICT (cross-aula) e BOOKING_CONFLICT (stessa
        // aula). Qui valutiamo solo il gap tra prenotazioni adiacenti.
        const overlap = bStart.isBefore(end) && bEnd.isAfter(start);
        if (overlap) continue;
        const gapMin = bEnd.isSameOrBefore(start)
          ? start.diff(bEnd, 'minute')
          : bStart.diff(end, 'minute');
        if (gapMin < cooldownMin) {
          push(
            `Devono passare almeno ${cooldownMin} minuti tra una prenotazione e l'altra ` +
              `(gap attuale: ${gapMin} min)`,
            'MIN_INTERVAL_VIOLATED',
          );
          break;
        }
      }
    }

    // ---- Quote dinamiche per risorsa (BookingQuota) ----
    // Limiti più granulari del cap globale: per tipo aula, per equipment,
    // o globali per-ruolo (in aggiunta alla BookingRule). Vedi commento al
    // model BookingQuota per la specifica completa.
    const quotaIssues = await checkResourceQuotas({
      user,
      room,
      durationMin,
      start,
      ignoreBookingId,
      tx,
      cache,
    });
    for (const q of quotaIssues) push(q.message, q.code);

    // ---- Eccezioni alla regola generale (block / time_window, cached) ----
    // Cache per role: fetcho TUTTE le eccezioni del ruolo (globali + scoped
    // per qualsiasi aula) e filtro per aula in JS, così la cache resta hit
    // tra prenotazioni su aule diverse dello stesso utente.
    let exceptions;
    if (cache?.exceptions.has(user.role)) {
      exceptions = cache.exceptions.get(user.role);
    } else {
      exceptions = await BookingRuleException.findAll({
        where: {
          isActive: true,
          role: { [Op.in]: [user.role, 'all'] },
        },
        ...tx,
      });
      if (cache) cache.exceptions.set(user.role, exceptions);
    }

    for (const exc of exceptions) {
      // Scope per aula: roomId null = vale per tutte; valorizzato = solo quell'aula.
      if (exc.roomId != null && exc.roomId !== room.id) continue;
      if (!exceptionAppliesToDate(exc, start)) continue;

      if (exc.kind === 'block') {
        if (overlapsWindow(start, end, exc.startTime, exc.endTime)) {
          push(`Prenotazione non consentita: ${exc.name}`);
        }
        continue;
      }

      if (exc.kind === 'time_window') {
        const newMinsInWindow = minutesInsideWindow(start, end, exc.startTime, exc.endTime);
        if (newMinsInWindow === 0) continue;

        const dayStart = institutionTime.startOfDay(start);
        const dayEnd = institutionTime.endOfDay(start);
        // Se l'eccezione è scoped a un'aula, conteggia SOLO le ore già
        // prenotate in quell'aula (senso: "in aula X max 1h tra 14-16").
        // Globale → conteggio cross-aula (comportamento storico).
        const sameDayBookings = await Booking.findAll({
          where: {
            userId: user.id,
            status: 'confirmed',
            ...COUNTS_TOWARD_QUOTAS,
            startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
            ...(exc.roomId != null ? { roomId: exc.roomId } : {}),
            ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
          },
          // Solo (start, end) servono per minutesInsideWindow.
          attributes: ['startTime', 'endTime'],
          ...tx,
        });
        const alreadyMinsInWindow = sameDayBookings.reduce((acc, b) => {
          return (
            acc +
            minutesInsideWindow(dayjs(b.startTime), dayjs(b.endTime), exc.startTime, exc.endTime)
          );
        }, 0);

        const limitMins = Math.round((exc.maxHoursInWindow || 0) * 60);
        if (alreadyMinsInWindow + newMinsInWindow > limitMins) {
          const win = exc.startTime && exc.endTime ? ` (${exc.startTime}-${exc.endTime})` : '';
          push(
            `${exc.name}${win}: max ${exc.maxHoursInWindow}h, ` +
              `già prenotate ${(alreadyMinsInWindow / 60).toFixed(1)}h`,
          );
        }
      }
    }
  }

  return buildResult(issues);
}

/**
 * Verifica se un utente può cancellare una prenotazione.
 */
async function canCancel(user, booking) {
  if (user.role === 'admin') return { ok: true };
  if (booking.userId !== user.id)
    return { ok: false, reason: 'Non sei il proprietario della prenotazione' };
  const rule = await BookingRule.findOne({ where: { role: user.role } });
  if (!rule) return { ok: true };
  const hoursUntilStart = dayjs(booking.startTime).diff(dayjs(), 'hour', true);
  if (hoursUntilStart < rule.cancellationDeadlineHours) {
    return {
      ok: false,
      reason: `Le cancellazioni vanno fatte almeno ${rule.cancellationDeadlineHours}h prima dell'inizio`,
    };
  }
  return { ok: true };
}

// =====================================================
// Quote per risorsa — verifica e produzione errori
// =====================================================
//
// Per ciascuna BookingQuota active matching il ruolo dell'utente:
//   1. Determina se lo scope si applica alla stanza/equipment richiesti.
//   2. Calcola le ore già usate dall'utente nelle stanze "matching scope"
//      nella settimana ISO corrente e nel giorno dell'inizio booking.
//   3. Se l'aggiunta della booking supera maxHoursPerWeek o
//      maxHoursPerDay, ritorna un errore strutturato con `code` per scope:
//        - QUOTA_EXCEEDED_GLOBAL
//        - QUOTA_EXCEEDED_ROOM_TYPE
//        - QUOTA_EXCEEDED_EQUIPMENT_TYPE
//
// Gli admin sono già esclusi dal caller (questo blocco è dentro l'if
// "user.role !== 'admin'"). Anche se un admin avesse quote attive, non
// vengono applicate (coerente con BookingRule).
async function checkResourceQuotas({
  user,
  room,
  durationMin,
  start,
  ignoreBookingId,
  tx,
  cache = null,
}) {
  const issues = [];

  // Cache scope: BookingQuota per ruolo è invariante per tutta la request.
  let quotas;
  if (cache?.quotas.has(user.role)) {
    quotas = cache.quotas.get(user.role);
  } else {
    quotas = await BookingQuota.findAll({
      where: { role: user.role, isActive: true },
      ...tx,
    });
    if (cache) cache.quotas.set(user.role, quotas);
  }
  if (quotas.length === 0) return issues;

  // Set di equipment-type della stanza, cachato per roomId. Risolve N+1 quando
  // ci sono più quote scopeKind=equipmentType — finora era cachato solo
  // intra-call, ora è cachato anche tra call successive nella stessa request.
  const ensureRoomEquipmentTypes = async () => {
    if (cache?.roomEquipmentTypes.has(room.id)) {
      return cache.roomEquipmentTypes.get(room.id);
    }
    const list = await Equipment.findAll({
      where: { roomId: room.id },
      attributes: ['type'],
      ...tx,
    });
    const set = new Set(list.map((e) => e.type));
    if (cache) cache.roomEquipmentTypes.set(room.id, set);
    return set;
  };

  const weekStart = institutionTime.startOfIsoWeek(start);
  const weekEnd = institutionTime.endOfIsoWeek(start);
  const dayStart = institutionTime.startOfDay(start);
  const dayEnd = institutionTime.endOfDay(start);

  // Mese di calendario (per cap maxHoursPerMonth).
  const monthStart = institutionTime.startOfMonth(start);
  const monthEnd = institutionTime.endOfMonth(start);

  // Giorno della settimana della booking (0=domenica .. 6=sabato).
  const bookingDow = institutionTime.dayOfWeek(start);

  // Fine intervallo derivata da `durationMin` (il chiamante non passa `end`).
  const endTimeForOverlap = start.add(durationMin, 'minute');

  for (const quota of quotas) {
    // ---- 1) Filtri "applicabilità" ----
    // a) daysOfWeek: se valorizzato e non include il giorno della booking, skip.
    const daysOfWeek = Array.isArray(quota.daysOfWeek) ? quota.daysOfWeek : [];
    if (daysOfWeek.length > 0 && !daysOfWeek.includes(bookingDow)) continue;

    // b) timeFrom/timeTo: la quota si applica solo se la booking interseca
    //    la fascia oraria specificata. Se entrambi NULL, sempre attiva.
    if (quota.timeFrom && quota.timeTo) {
      const overlap = overlapsWindow(start, endTimeForOverlap, quota.timeFrom, quota.timeTo);
      if (!overlap) continue;
    }

    // ---- 2) Lo scope si applica alla stanza richiesta? ----
    let appliesToCurrent = false;
    if (quota.scopeKind === 'global') {
      appliesToCurrent = true;
    } else if (quota.scopeKind === 'roomType') {
      appliesToCurrent = quota.scopeValue === room.type;
    } else if (quota.scopeKind === 'room') {
      appliesToCurrent = Number(quota.scopeValue) === room.id;
    } else if (quota.scopeKind === 'building') {
      appliesToCurrent = Number(quota.scopeValue) === room.buildingId;
    } else if (quota.scopeKind === 'equipmentType') {
      const types = await ensureRoomEquipmentTypes();
      appliesToCurrent = types.has(quota.scopeValue);
    }
    if (!appliesToCurrent) continue;

    // ---- 3) Stanze matching lo scope per il calcolo del consumo (cached) ----
    let matchingRoomIds = null; // null = "tutte"
    if (quota.scopeKind === 'roomType') {
      if (cache?.roomsByType.has(quota.scopeValue)) {
        matchingRoomIds = cache.roomsByType.get(quota.scopeValue);
      } else {
        const rooms = await Room.findAll({
          where: { type: quota.scopeValue },
          attributes: ['id'],
          ...tx,
        });
        matchingRoomIds = rooms.map((r) => r.id);
        if (cache) cache.roomsByType.set(quota.scopeValue, matchingRoomIds);
      }
      if (matchingRoomIds.length === 0) continue;
    } else if (quota.scopeKind === 'room') {
      matchingRoomIds = [Number(quota.scopeValue)];
    } else if (quota.scopeKind === 'building') {
      const key = Number(quota.scopeValue);
      if (cache?.roomsByBuilding.has(key)) {
        matchingRoomIds = cache.roomsByBuilding.get(key);
      } else {
        const rooms = await Room.findAll({
          where: { buildingId: key },
          attributes: ['id'],
          ...tx,
        });
        matchingRoomIds = rooms.map((r) => r.id);
        if (cache) cache.roomsByBuilding.set(key, matchingRoomIds);
      }
      if (matchingRoomIds.length === 0) continue;
    } else if (quota.scopeKind === 'equipmentType') {
      if (cache?.roomsByEquipment.has(quota.scopeValue)) {
        matchingRoomIds = cache.roomsByEquipment.get(quota.scopeValue);
      } else {
        const eqs = await Equipment.findAll({
          where: { type: quota.scopeValue },
          attributes: ['roomId'],
          ...tx,
        });
        matchingRoomIds = [...new Set(eqs.map((e) => e.roomId))];
        if (cache) cache.roomsByEquipment.set(quota.scopeValue, matchingRoomIds);
      }
      if (matchingRoomIds.length === 0) continue;
    }

    // ---- 4) Calcolo consumi per settimana / giorno / mese / count ----
    const baseWhere = {
      userId: user.id,
      status: 'confirmed',
      ...COUNTS_TOWARD_QUOTAS,
      ...(ignoreBookingId ? { id: { [Op.ne]: ignoreBookingId } } : {}),
      ...(matchingRoomIds ? { roomId: { [Op.in]: matchingRoomIds } } : {}),
    };

    if (quota.maxHoursPerWeek > 0) {
      const weekRows = await Booking.findAll({
        where: { ...baseWhere, startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd } },
        attributes: ['startTime', 'endTime'],
        ...tx,
      });
      const minsThisWeek = weekRows.reduce(
        (acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'),
        0,
      );
      if (minsThisWeek + durationMin > quota.maxHoursPerWeek * 60) {
        issues.push(formatQuotaIssue(quota, 'week', minsThisWeek));
      }
    }

    if (quota.maxHoursPerDay > 0) {
      const dayRows = await Booking.findAll({
        where: { ...baseWhere, startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
        attributes: ['startTime', 'endTime'],
        ...tx,
      });
      const minsThisDay = dayRows.reduce(
        (acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'),
        0,
      );
      if (minsThisDay + durationMin > quota.maxHoursPerDay * 60) {
        issues.push(formatQuotaIssue(quota, 'day', minsThisDay));
      }
    }

    if (quota.maxHoursPerMonth > 0) {
      const monthRows = await Booking.findAll({
        where: { ...baseWhere, startTime: { [Op.gte]: monthStart, [Op.lte]: monthEnd } },
        attributes: ['startTime', 'endTime'],
        ...tx,
      });
      const minsThisMonth = monthRows.reduce(
        (acc, b) => acc + dayjs(b.endTime).diff(dayjs(b.startTime), 'minute'),
        0,
      );
      if (minsThisMonth + durationMin > quota.maxHoursPerMonth * 60) {
        issues.push(formatQuotaIssue(quota, 'month', minsThisMonth));
      }
    }

    if (quota.maxBookings > 0) {
      const count = await Booking.count({
        where: { ...baseWhere, startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd } },
        ...tx,
      });
      if (count + 1 > quota.maxBookings) {
        issues.push(formatQuotaIssue(quota, 'count', count));
      }
    }
  }
  return issues;
}

const SCOPE_TO_CODE = {
  global: 'QUOTA_EXCEEDED_GLOBAL',
  roomType: 'QUOTA_EXCEEDED_ROOM_TYPE',
  equipmentType: 'QUOTA_EXCEEDED_EQUIPMENT_TYPE',
  room: 'QUOTA_EXCEEDED_ROOM',
  building: 'QUOTA_EXCEEDED_BUILDING',
};

function formatQuotaIssue(quota, kind, already) {
  let scopeLabel;
  if (quota.scopeKind === 'global') scopeLabel = 'globale';
  else if (quota.scopeKind === 'roomType') scopeLabel = `tipo aula "${quota.scopeValue}"`;
  else if (quota.scopeKind === 'room') scopeLabel = `aula #${quota.scopeValue}`;
  else if (quota.scopeKind === 'building') scopeLabel = `edificio #${quota.scopeValue}`;
  else scopeLabel = `strumentazione "${quota.scopeValue}"`;

  const code = SCOPE_TO_CODE[quota.scopeKind] || 'QUOTA_EXCEEDED_GLOBAL';

  if (kind === 'count') {
    return {
      message: `Quota numerica superata per ${scopeLabel}: max ${quota.maxBookings} prenotazioni/sett., già fatte ${already}`,
      code,
    };
  }

  const cap = {
    week: quota.maxHoursPerWeek,
    day: quota.maxHoursPerDay,
    month: quota.maxHoursPerMonth,
  }[kind];
  const usedH = (already / 60).toFixed(1);
  const period = { week: 'settimanale', day: 'giornaliero', month: 'mensile' }[kind];
  return {
    message: `Quota ${period} superata per ${scopeLabel}: max ${cap}h, già usate ${usedH}h`,
    code,
  };
}

module.exports = {
  validateBooking,
  canCancel,
  checkResourceQuotas,
  createValidationCache,
  COUNTS_TOWARD_QUOTAS,
  STUDIO_MIN_DURATION_MINUTES,
};
