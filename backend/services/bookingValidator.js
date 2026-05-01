'use strict';

const dayjs = require('dayjs');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const utc = require('dayjs/plugin/utc');
const { Op } = require('sequelize');
const {
  Booking,
  BookingRule,
  BookingRuleException,
  BookingQuota,
  Equipment,
  Room,
} = require('../models');

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.extend(utc);

/**
 * Valida una richiesta di prenotazione rispetto alle regole del ruolo,
 * disponibilità della stanza e permessi.
 *
 * Restituisce: { valid: boolean, errors: string[] }
 */
// Durata minima specifica per le prenotazioni di tipo "studio individuale".
// Si somma al min generico per ruolo (BookingRule.minBookingDurationMinutes):
// per gli altri tipi (lezione, prova, concerto, altro) vale solo il minimo
// per ruolo, lo studio individuale ha un floor aggiuntivo di 1 ora richiesto
// dal direttivo per evitare frammentazione delle aule in slot troppo brevi.
const STUDIO_MIN_DURATION_MINUTES = 60;

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
  const errors = [];
  // Parallelo a `errors`: stesso indice → codice errore strutturato (o null
  // se non specifico). Il route handler usa codes[0] per popolare err.code,
  // così l'error middleware risponde con `{code: 'QUOTA_EXCEEDED_*', ...}`.
  const codes = [];
  const tx = transaction ? { transaction } : {};
  const push = (msg, code = null) => {
    errors.push(msg);
    codes.push(code);
  };

  const start = dayjs(startTime);
  const end = dayjs(endTime);
  const now = dayjs();

  // ---- Controlli base sulle date ----
  if (!start.isValid() || !end.isValid()) {
    return { valid: false, errors: ['Date non valide'] };
  }
  if (end.isSameOrBefore(start)) {
    errors.push("L'orario di fine deve essere successivo a quello di inizio");
  }
  if (start.isBefore(now) && !bypassPastDates) {
    errors.push('Non puoi prenotare nel passato');
  }

  // ---- Verifica esistenza stanza (cached) ----
  let room;
  if (cache?.room.has(roomId)) {
    room = cache.room.get(roomId);
  } else {
    room = await Room.findByPk(roomId, tx);
    if (cache) cache.room.set(roomId, room);
  }
  if (!room) return { valid: false, errors: ['Aula non trovata'] };
  if (!room.isBookable) errors.push('Questa aula non è prenotabile');

  // ---- Verifica permessi sull'aula (ruolo) ----
  if (
    Array.isArray(room.allowedRoles) &&
    room.allowedRoles.length > 0 &&
    !room.allowedRoles.includes(user.role)
  ) {
    errors.push(`Il tuo ruolo (${user.role}) non può prenotare questa aula`);
  }

  // ---- Verifica permessi sull'aula (corso) ----
  if (
    Array.isArray(room.allowedCourseIds) &&
    room.allowedCourseIds.length > 0 &&
    user.role !== 'admin' &&
    (!user.courseId || !room.allowedCourseIds.includes(user.courseId))
  ) {
    errors.push('Il tuo corso non è abilitato a prenotare questa aula');
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
    return { valid: false, errors: [`Nessuna regola configurata per il ruolo ${user.role}`] };
  }

  // ---- Durata prenotazione ----
  // `bypassDuration` salta i check min/max sulla durata: usato dal generator
  // monte ore quando l'admin espande un pattern approvato. La rule
  // maxBookingDurationMinutes è pensata per le prenotazioni manuali (es. uno
  // studente non deve prenotare 6h consecutive), ma un docente ha
  // legittimamente lezioni da 6h che il coordinatore ha già approvato.
  const durationMin = end.diff(start, 'minute');
  if (!bypassDuration) {
    if (durationMin < rule.minBookingDurationMinutes) {
      errors.push(`Durata minima prenotazione: ${rule.minBookingDurationMinutes} minuti`);
    }
    if (durationMin > rule.maxBookingDurationMinutes) {
      errors.push(`Durata massima prenotazione: ${rule.maxBookingDurationMinutes} minuti`);
    }
    // Floor specifico per studio individuale (vedi STUDIO_MIN_DURATION_MINUTES).
    if (type === 'studio_individuale' && durationMin < STUDIO_MIN_DURATION_MINUTES) {
      errors.push(`Durata minima per lo studio individuale: ${STUDIO_MIN_DURATION_MINUTES} minuti`);
    }
  }

  // ---- Anticipo massimo / minimo ----
  // `bypassAdvance` salta entrambi i check: usato dal generator monte ore
  // dove l'admin sta espandendo prenotazioni già approvate per l'intero AA
  // (quindi naturalmente molte sono > maxAdvanceDays nel futuro).
  if (!bypassAdvance) {
    const daysAhead = start.startOf('day').diff(now.startOf('day'), 'day');
    if (daysAhead > rule.maxAdvanceDays) {
      errors.push(`Puoi prenotare al massimo con ${rule.maxAdvanceDays} giorni di anticipo`);
    }
    const hoursAhead = start.diff(now, 'hour', true);
    if (hoursAhead < rule.minAdvanceHours) {
      errors.push(`Devi prenotare almeno ${rule.minAdvanceHours} ore prima dell'inizio`);
    }
  }

  // ---- Fascia oraria consentita ----
  if (rule.allowedStartTime && rule.allowedEndTime) {
    const startMins = start.hour() * 60 + start.minute();
    const endMins = end.hour() * 60 + end.minute();
    const [aH, aM] = rule.allowedStartTime.split(':').map(Number);
    const [bH, bM] = rule.allowedEndTime.split(':').map(Number);
    const allowedStart = aH * 60 + aM;
    const allowedEnd = bH * 60 + bM;
    if (startMins < allowedStart || (endMins > allowedEnd && endMins !== 0)) {
      errors.push(
        `Le prenotazioni sono consentite solo dalle ${rule.allowedStartTime} alle ${rule.allowedEndTime}`,
      );
    }
  }

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
      endTime: { [Op.gt]: now.toDate() },
    };
    if (ignoreBookingId) activeWhere.id = { [Op.ne]: ignoreBookingId };
    const activeCount = await Booking.count({ where: activeWhere, ...tx });
    if (activeCount >= rule.maxActiveBookings) {
      errors.push(`Hai raggiunto il limite di ${rule.maxActiveBookings} prenotazioni attive`);
    }

    // ---- Ore prenotate nella settimana (ISO: Lun-Dom) ----
    // Coerente con quote check (riga 413) e con /usage/me lato frontend,
    // che usano isoWeek. Senza questo allineamento, una prenotazione di
    // domenica veniva contata in settimane diverse dai due check.
    const weekStart = start.startOf('isoWeek');
    const weekEnd = start.endOf('isoWeek');
    const weekBookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        startTime: { [Op.gte]: weekStart.toDate(), [Op.lte]: weekEnd.toDate() },
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
      errors.push(
        `Limite settimanale superato: max ${rule.maxHoursPerWeek}h, ` +
          `già prenotate ${(minutesThisWeek / 60).toFixed(1)}h`,
      );
    }

    // ---- Ore prenotate nello stesso giorno ----
    const dayStart = start.startOf('day');
    const dayEnd = start.endOf('day');
    const dayBookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        startTime: { [Op.gte]: dayStart.toDate(), [Op.lte]: dayEnd.toDate() },
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
      errors.push(`Limite giornaliero superato: max ${rule.maxHoursPerDay}h al giorno`);
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
      if (!exceptionAppliesToDate(exc, start)) continue;

      if (exc.kind === 'block') {
        if (overlapsWindow(start, end, exc.startTime, exc.endTime)) {
          errors.push(`Prenotazione non consentita: ${exc.name}`);
        }
        continue;
      }

      if (exc.kind === 'time_window') {
        const newMinsInWindow = minutesInsideWindow(start, end, exc.startTime, exc.endTime);
        if (newMinsInWindow === 0) continue;

        const dayStart = start.startOf('day');
        const dayEnd = start.endOf('day');
        const sameDayBookings = await Booking.findAll({
          where: {
            userId: user.id,
            status: 'confirmed',
            startTime: { [Op.gte]: dayStart.toDate(), [Op.lte]: dayEnd.toDate() },
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
          errors.push(
            `${exc.name}${win}: max ${exc.maxHoursInWindow}h, ` +
              `già prenotate ${(alreadyMinsInWindow / 60).toFixed(1)}h`,
          );
        }
      }
    }
  }

  // Normalizza la lunghezza di `codes` a quella di `errors`: tutti gli
  // errori "legacy" (push diretto su errors) ricevono code=null.
  while (codes.length < errors.length) codes.push(null);
  return { valid: errors.length === 0, errors, codes };
}

// =====================================================
// Helper: l'eccezione si applica al giorno della prenotazione?
// =====================================================
function exceptionAppliesToDate(exception, dateLike) {
  const d = dayjs(dateLike);
  if (
    exception.daysOfWeek &&
    Array.isArray(exception.daysOfWeek) &&
    exception.daysOfWeek.length > 0 &&
    !exception.daysOfWeek.includes(d.day())
  ) {
    return false;
  }
  if (exception.dateFrom) {
    if (d.format('YYYY-MM-DD') < exception.dateFrom) return false;
  }
  if (exception.dateTo) {
    if (d.format('YYYY-MM-DD') > exception.dateTo) return false;
  }
  return true;
}

// =====================================================
// Helper: la prenotazione [start,end] si sovrappone alla finestra HH:mm?
// Se startTime/endTime mancano, la finestra copre l'intero giorno.
// =====================================================
function overlapsWindow(start, end, winStart, winEnd) {
  if (!winStart || !winEnd) return true;
  const s = start.hour() * 60 + start.minute();
  const e = end.hour() * 60 + end.minute();
  const ws = parseHHmm(winStart);
  const we = parseHHmm(winEnd);
  return s < we && e > ws;
}

// =====================================================
// Helper: minuti della prenotazione che cadono dentro la finestra HH:mm
// =====================================================
function minutesInsideWindow(start, end, winStart, winEnd) {
  const sM = start.hour() * 60 + start.minute();
  const eM = end.hour() * 60 + end.minute();
  const ws = winStart ? parseHHmm(winStart) : 0;
  const we = winEnd ? parseHHmm(winEnd) : 24 * 60;
  const overlapStart = Math.max(sM, ws);
  const overlapEnd = Math.min(eM, we);
  return Math.max(0, overlapEnd - overlapStart);
}

function parseHHmm(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
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
  const errors = [];

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
  if (quotas.length === 0) return errors;

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

  const weekStart = start.startOf('isoWeek').toDate();
  const weekEnd = start.endOf('isoWeek').toDate();
  const dayStart = start.startOf('day').toDate();
  const dayEnd = start.endOf('day').toDate();

  // Mese di calendario (per cap maxHoursPerMonth).
  const monthStart = start.startOf('month').toDate();
  const monthEnd = start.endOf('month').toDate();

  // Giorno della settimana della booking (0=domenica .. 6=sabato).
  const bookingDow = start.day();

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
        errors.push(formatQuotaIssue(quota, 'week', minsThisWeek));
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
        errors.push(formatQuotaIssue(quota, 'day', minsThisDay));
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
        errors.push(formatQuotaIssue(quota, 'month', minsThisMonth));
      }
    }

    if (quota.maxBookings > 0) {
      const count = await Booking.count({
        where: { ...baseWhere, startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd } },
        ...tx,
      });
      if (count + 1 > quota.maxBookings) {
        errors.push(formatQuotaIssue(quota, 'count', count));
      }
    }
  }
  return errors;
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
  STUDIO_MIN_DURATION_MINUTES,
};
