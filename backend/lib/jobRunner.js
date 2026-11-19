'use strict';

/**
 * Esecutore unico dei lavori pianificati.
 *
 * Possiede: gate dell'istanza (default `clusterRole.isSchedulerMaster`,
 * sostituibile con un gate custom), timer, start/stop idempotenti e il
 * calcolo "ms alla prossima esecuzione alle HH:MM nel fuso".
 *
 * Politiche di scheduling (oggetto, oppure funzione che lo restituisce e
 * viene valutata a ogni armamento: fuso e orari si leggono quando servono):
 *   { type: 'interval', everyMs, initialDelayMs? }
 *   { type: 'daily',  hour, minute?, tz? }
 *   { type: 'weekly', dayOfWeek, hour, minute?, tz? }   (0 = domenica)
 *
 * Il corpo del job (`run`) puo' chiamare `job.reschedule()` da solo (come
 * fanno gli scheduler storici): l'esecutore riarma dopo il run solo se
 * nessun timer e' gia' armato.
 *
 * Gate: `gate` e' sincrono e valutato allo start (default: master PM2);
 * `guard` e' asincrono e valutato a ogni esecuzione (es. lease su DB).
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const logger = require('./logger').child({ scope: 'jobRunner' });

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

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {() => any} opts.run  corpo del job; un'eccezione viene loggata e NON ferma il job
 * @param {object|(() => object)} opts.schedule  politica, o funzione valutata a ogni armamento
 * @param {() => boolean} [opts.gate]  gate sincrono all'avvio (default: istanza master PM2)
 * @param {() => Promise<boolean>|boolean} [opts.guard]  gate asincrono a OGNI esecuzione
 *   (es. lease su DB): se ritorna false l'esecuzione viene saltata
 * @param {() => void} [opts.onStop]  hook eseguito a ogni stop() (es. rilascio lease)
 * @param {() => boolean} [opts.enabled]
 */
function createJob({
  name,
  run,
  schedule,
  gate = defaultGate,
  guard = null,
  onStop = null,
  enabled = () => true,
}) {
  let timer = null;
  let initialTimer = null;
  let kind = null; // 'timeout' | 'interval'
  const policy = () => (typeof schedule === 'function' ? schedule() : schedule);

  function clear() {
    if (timer) {
      if (kind === 'interval') clearInterval(timer);
      else clearTimeout(timer);
      timer = null;
    }
  }

  // Un'esecuzione che lancia non deve mai fermare il job ne' produrre
  // unhandled rejection: l'errore viene loggato e il timer resta armato.
  async function safeRun() {
    try {
      if (guard && !(await guard())) return;
      await run();
    } catch (err) {
      logger.error({ err: err?.message, job: name }, 'job run failed');
    }
  }

  // Il timer scattato resta "attivo" durante il run (come negli scheduler
  // storici): si riarma solo se il corpo non l'ha gia' fatto e non e' stato
  // chiamato stop() nel frattempo.
  async function fire(fired) {
    await safeRun();
    if (timer === fired) arm();
  }

  function arm() {
    clear();
    if (!enabled()) return;
    const p = policy();
    if (p.type === 'interval') {
      kind = 'interval';
      timer = setInterval(() => void safeRun(), p.everyMs);
    } else {
      kind = 'timeout';
      const t = setTimeout(() => void fire(t), msUntilNextRun(p));
      timer = t;
    }
  }

  return {
    name,
    /** @returns {boolean} true se il job e' stato armato ora. */
    start() {
      if (timer) return false;
      if (!gate()) return false;
      if (!enabled()) return false;
      const p = policy();
      if (p.type === 'interval' && p.initialDelayMs != null) {
        if (initialTimer) clearTimeout(initialTimer);
        initialTimer = setTimeout(() => {
          initialTimer = null;
          void safeRun();
        }, p.initialDelayMs);
      }
      arm();
      return timer != null;
    },
    stop() {
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      clear();
      if (onStop) {
        try {
          onStop();
        } catch (err) {
          logger.warn({ err: err?.message, job: name }, 'job onStop failed');
        }
      }
    },
    /** Riarma (idempotente): usato dal corpo del job a fine tick. */
    reschedule: arm,
    isActive: () => timer != null,
    /** True se il gate sincrono dell'istanza e' aperto (senza avviare nulla). */
    isGateOpen: () => gate(),
    msToNext: () => {
      const p = policy();
      return p.type === 'interval' ? p.everyMs : msUntilNextRun(p);
    },
  };
}

module.exports = { createJob, msUntilNextRun, DEFAULT_TZ };
