'use strict';

/**
 * Esecutore unico dei lavori pianificati.
 *
 * Possiede: gate dell'istanza (default `clusterRole.isSchedulerMaster`,
 * sostituibile con un gate custom), timer, start/stop idempotenti e il
 * calcolo "ms alla prossima esecuzione alle HH:MM nel fuso".
 *
 * Politiche di scheduling:
 *   { type: 'interval', everyMs, initialDelayMs? }
 *   { type: 'daily',  hour, minute?, tz? }
 *   { type: 'weekly', dayOfWeek, hour, minute?, tz? }   (0 = domenica)
 *
 * Il corpo del job (`run`) puo' chiamare `job.reschedule()` da solo (come
 * fanno gli scheduler storici): l'esecutore riarma dopo il run solo se
 * nessun timer e' gia' armato.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Europe/Rome';

/**
 * Millisecondi dall'istante `now` alla prossima occorrenza HH:MM nel fuso `tz`
 * (strettamente nel futuro). L'orario e' "da muro": nei giorni di cambio ora
 * legale l'esecuzione resta alle HH:MM locali.
 * Con `dayOfWeek` definito l'occorrenza e' quella settimanale.
 */
function msUntilNextRun({ hour, minute = 0, dayOfWeek, tz = DEFAULT_TZ }, now = dayjs()) {
  const nowMs = dayjs(now).valueOf();
  const local = dayjs(now).tz(tz);
  // Ricostruisce il target dal calendario "da muro" (dayjs.tz(stringa, tz))
  // invece di muovere un oggetto tz: i setter .hour()/.add() di dayjs sbagliano
  // di un'ora attorno al cambio ora legale.
  const pad = (n) => String(n).padStart(2, '0');
  const atDay = (d) =>
    dayjs.tz(`${d.format('YYYY-MM-DD')} ${pad(hour)}:${pad(minute)}:00`, tz).valueOf();
  // Solo la parte data (senza orario): l'aritmetica sui giorni e' sicura.
  let day = dayjs(local.format('YYYY-MM-DD'));
  if (dayOfWeek !== undefined) day = day.add(dayOfWeek - local.day(), 'day');
  const step = dayOfWeek !== undefined ? 7 : 1;
  let target = atDay(day);
  while (target <= nowMs) {
    day = day.add(step, 'day');
    target = atDay(day);
  }
  return target - nowMs;
}

function defaultGate() {
  return require('./clusterRole').isSchedulerMaster();
}

function createJob({ name, run, schedule, gate = defaultGate, enabled = () => true }) {
  let timer = null;
  let kind = null; // 'timeout' | 'interval'

  function clear() {
    if (timer) {
      if (kind === 'interval') clearInterval(timer);
      else clearTimeout(timer);
      timer = null;
    }
  }

  function arm() {
    clear();
    if (!enabled()) return;
    if (schedule.type === 'interval') {
      kind = 'interval';
      timer = setInterval(() => void run(), schedule.everyMs);
    } else {
      kind = 'timeout';
      timer = setTimeout(() => void fire(), msUntilNextRun(schedule));
    }
  }

  async function fire() {
    timer = null;
    try {
      await run();
    } finally {
      if (!timer) arm();
    }
  }

  return {
    name,
    /** @returns {boolean} true se il job e' stato armato ora. */
    start() {
      if (timer) return false;
      if (!gate()) return false;
      if (!enabled()) return false;
      if (schedule.type === 'interval' && schedule.initialDelayMs != null) {
        setTimeout(() => void run(), schedule.initialDelayMs);
      }
      arm();
      return timer != null;
    },
    stop: clear,
    /** Riarma (idempotente): usato dal corpo del job a fine tick. */
    reschedule: arm,
    isActive: () => timer != null,
    msToNext: () => (schedule.type === 'interval' ? schedule.everyMs : msUntilNextRun(schedule)),
  };
}

module.exports = { createJob, msUntilNextRun, DEFAULT_TZ };
