'use strict';

/**
 * Validatore puro per i vincoli giornalieri del Monte Ore.
 *
 *  - Z2 (Art. 2.2 Regolamento): max ore di lezione nello stesso giorno
 *    (somma di TUTTE le schedules con lo stesso dayOfWeek).
 *  - Z3 (Art. 2.1 Regolamento): se un blocco di lezioni consecutive
 *    supera `dailyBreakAfterHours`, deve essere "spezzato" da una pausa
 *    di almeno `dailyBreakMinutes` minuti.
 *
 * Le 3 soglie vivono in `MonteOreSettings`. NULL = vincolo disabilitato
 * (comportamento legacy pre-v1.14, retro-compatibilità).
 *
 * Funzione stateless e deterministica, no I/O: testabile in isolamento.
 */

/**
 * @param {Array<{dayOfWeek:number, startTime:string, endTime:string}>} schedules
 * @param {{maxHoursPerDay?:number|null, dailyBreakAfterHours?:number|null, dailyBreakMinutes?:number|null}} settings
 * @returns {{ ok: boolean, violations: Array<object> }}
 */
function validateDailyConstraints(schedules, settings) {
  const violations = [];
  if (!Array.isArray(schedules) || schedules.length === 0 || !settings) {
    return { ok: true, violations };
  }

  const maxHours = settings.maxHoursPerDay;
  const breakAfter = settings.dailyBreakAfterHours;
  const breakMin = settings.dailyBreakMinutes;
  const z2Active = maxHours != null;
  const z3Active = breakAfter != null && breakMin != null;
  if (!z2Active && !z3Active) return { ok: true, violations };

  // Raggruppa per giorno della settimana.
  const byDay = new Map();
  for (const s of schedules) {
    const arr = byDay.get(s.dayOfWeek) || [];
    arr.push(s);
    byDay.set(s.dayOfWeek, arr);
  }

  for (const [dayOfWeek, daySchedules] of byDay) {
    // Z2 — totale ore nel giorno
    if (z2Active) {
      let total = 0;
      for (const s of daySchedules) total += hoursBetween(s.startTime, s.endTime);
      if (total > maxHours + 1e-6) {
        violations.push({
          code: 'DAILY_HOURS_EXCEEDED',
          dayOfWeek,
          totalHours: round1(total),
          limit: maxHours,
        });
      }
    }

    // Z3 — pausa dopo blocco consecutivo
    if (z3Active) {
      const sorted = [...daySchedules].sort(
        (a, b) => minutesOf(a.startTime) - minutesOf(b.startTime),
      );
      let blockStart = minutesOf(sorted[0].startTime);
      let blockEnd = minutesOf(sorted[0].endTime);
      for (let i = 1; i < sorted.length; i++) {
        const gap = minutesOf(sorted[i].startTime) - blockEnd;
        if (gap >= breakMin) {
          // Pausa sufficiente: chiudi blocco corrente, verifica e ricomincia
          flushBlock(blockStart, blockEnd, dayOfWeek, breakAfter, breakMin, violations);
          blockStart = minutesOf(sorted[i].startTime);
          blockEnd = minutesOf(sorted[i].endTime);
        } else {
          // Pausa insufficiente: estendi il blocco corrente.
          blockEnd = Math.max(blockEnd, minutesOf(sorted[i].endTime));
        }
      }
      flushBlock(blockStart, blockEnd, dayOfWeek, breakAfter, breakMin, violations);
    }
  }

  return { ok: violations.length === 0, violations };
}

function flushBlock(startMin, endMin, dayOfWeek, threshold, breakNeeded, violations) {
  const hours = (endMin - startMin) / 60;
  if (hours > threshold + 1e-6) {
    // Evita duplicati sullo stesso giorno se più blocchi violano (raro).
    violations.push({
      code: 'BREAK_REQUIRED',
      dayOfWeek,
      consecutiveHours: round1(hours),
      threshold,
      breakNeeded,
    });
  }
}

function minutesOf(hhmm) {
  // Accetta "HH:MM" o "HH:MM:SS". Tollerante a input malformati → 0.
  if (typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function hoursBetween(start, end) {
  return Math.max(0, (minutesOf(end) - minutesOf(start)) / 60);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = { validateDailyConstraints };
