'use strict';

/**
 * Monte Ore — calendario didattico.
 *
 * Date un settings (con `lessonsStartDate`/`lessonsEndDate`) e l'array
 * `suspensions`, espone:
 *
 *   computeWeeks(settings, suspensions) →
 *     [{
 *       weekStart: 'YYYY-MM-DD' (lunedì),
 *       weekEnd:   'YYYY-MM-DD' (sabato),
 *       weekIndex: 1, 2, 3, …    (numero progressivo settimana)
 *       weekLabel: '03 Nov – 08 Nov',
 *       days: [{
 *         date: 'YYYY-MM-DD',
 *         dayOfWeek: 1..6,
 *         isLocked: bool,
 *         lockReason: 'Festa della Repubblica' | null,
 *       } × 5]   ← Lun-Ven (sabato escluso dalla pianificazione)
 *     }]
 *
 * Logica di filtro (richiesta dalla spec):
 *   - se una `MonteOreSuspension` con `kind='full_week'` copre la settimana
 *     INTERA (lunedì..sabato dentro [dateFrom, dateTo]) → la settimana è
 *     SCARTATA dal risultato (non compare in lista).
 *   - se una `kind='partial'` copre alcuni giorni → quei giorni hanno
 *     `isLocked=true` con lockReason = nome della sospensione.
 *
 * Tutte le date sono trattate come "DATEONLY" (locale Italia, niente UTC).
 */

const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');

dayjs.extend(isoWeek);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const DAYS_IT_SHORT = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

function dateInRange(date, from, to) {
  return dayjs(date).isSameOrAfter(dayjs(from)) && dayjs(date).isSameOrBefore(dayjs(to));
}

function suspensionContainsDate(susp, dateIso) {
  return dateInRange(dateIso, susp.dateFrom, susp.dateTo);
}

/**
 * Una settimana è "full_week sospesa" se TUTTI i giorni Lun..Sab cadono
 * dentro almeno una sospensione `full_week`. Basta che una singola
 * sospensione full_week copra l'intera settimana.
 */
function isWeekFullySuspended(weekStart, weekEnd, suspensions) {
  const fullWeeks = (suspensions || []).filter((s) => s.kind === 'full_week');
  // Modello "single suspension che copre l'intera settimana"
  return fullWeeks.some(
    (s) =>
      dayjs(s.dateFrom).isSameOrBefore(dayjs(weekStart)) &&
      dayjs(s.dateTo).isSameOrAfter(dayjs(weekEnd)),
  );
}

/**
 * Trova la sospensione `partial` che copre il giorno; ritorna {name} o null.
 */
function findPartialLock(dateIso, suspensions) {
  const partials = (suspensions || []).filter((s) => s.kind === 'partial');
  for (const s of partials) {
    if (suspensionContainsDate(s, dateIso)) return s;
  }
  return null;
}

function computeWeeks(settings, suspensions = []) {
  if (!settings || !settings.lessonsStartDate || !settings.lessonsEndDate) {
    throw new Error(
      'Settings monte ore mancanti o non configurate (lessonsStartDate/lessonsEndDate)',
    );
  }
  const start = dayjs(settings.lessonsStartDate).startOf('day');
  const end = dayjs(settings.lessonsEndDate).endOf('day');

  // Allinea cursor al lunedì della settimana di start
  let weekStart = start.startOf('isoWeek'); // lunedì
  // Se start è dopo lunedì, comunque la prima settimana parte da quel lunedì:
  // la specifica chiede di mostrare il lunedì della settimana anche se le
  // lezioni partono in un giorno successivo (e il lunedì verrà bloccato come
  // "fuori periodo"). Per semplicità però partiamo dal lunedì >= start.
  if (weekStart.isBefore(start, 'day')) weekStart = weekStart.add(7, 'day');
  // Però la spec mostra "03 Nov - 08 Nov" e 3 nov (lunedì) coincide con
  // start. Quindi se start è di lunedì usiamo quello. Se start è di
  // martedì (es. 4 nov) la prima settimana inizierebbe il 10 nov: meglio
  // includere la settimana del 3-8 nov con il 3 lockato. Compromesso:
  // partiamo dal lunedì <= start.
  weekStart = dayjs(settings.lessonsStartDate).startOf('isoWeek');

  const weeks = [];
  let weekIndex = 0;

  while (weekStart.isSameOrBefore(end, 'day')) {
    weekIndex += 1;
    const weekEnd = weekStart.add(5, 'day'); // sabato (lunedì + 5)
    const weekStartIso = weekStart.format('YYYY-MM-DD');
    const weekEndIso = weekEnd.format('YYYY-MM-DD');

    // Filter: se l'INTERA settimana è full-week-sospesa, skippiamo
    if (isWeekFullySuspended(weekStartIso, weekEndIso, suspensions)) {
      weekStart = weekStart.add(7, 'day');
      continue;
    }

    // Costruisci 5 giorni Lun-Ven
    const days = [];
    for (let dow = 1; dow <= 5; dow++) {
      const d = weekStart.add(dow - 1, 'day');
      const dIso = d.format('YYYY-MM-DD');
      // Fuori dal periodo lezioni → lockato
      let isLocked = false;
      let lockReason = null;
      if (d.isBefore(start, 'day') || d.isAfter(end, 'day')) {
        isLocked = true;
        lockReason = d.isBefore(start, 'day')
          ? "Prima dell'inizio lezioni"
          : 'Dopo la fine lezioni';
      } else {
        // Sospensione parziale?
        const partial = findPartialLock(dIso, suspensions);
        if (partial) {
          isLocked = true;
          lockReason = partial.name;
        }
      }
      days.push({
        date: dIso,
        dayOfWeek: d.day(), // 0..6 (lunedì=1)
        isLocked,
        lockReason,
      });
    }

    weeks.push({
      weekStart: weekStartIso,
      weekEnd: weekEndIso,
      weekIndex,
      weekLabel: `${weekStart.format('DD MMM')} – ${weekEnd.format('DD MMM')}`,
      days,
    });

    weekStart = weekStart.add(7, 'day');
  }

  return weeks;
}

/**
 * Helper per il default dei settings: dato un AA "2025/2026", calcola le
 * date "1 nov 2025 → 31 ott 2026".
 */
function defaultRangeForAcademicYear(academicYear) {
  const [a] = academicYear.split('/').map(Number);
  return {
    academicYearStart: `${a}-11-01`,
    academicYearEnd: `${a + 1}-10-31`,
    // Default lezioni: leggermente dentro il range AA (3 nov → 30 giu)
    lessonsStartDate: `${a}-11-03`,
    lessonsEndDate: `${a + 1}-10-31`,
    // Finestra inserimento: tutto settembre-ottobre dell'anno X
    submissionWindowStart: `${a}-09-01`,
    submissionWindowEnd: `${a}-10-31`,
  };
}

/** Anno accademico corrente: 1 nov → 31 ott. */
function currentAcademicYear(today = new Date()) {
  const d = dayjs(today);
  const month = d.month() + 1;
  const year = d.year();
  // Da novembre in poi → AA = year/year+1
  // Da gennaio a ottobre → AA = year-1/year
  if (month >= 11) return `${year}/${year + 1}`;
  return `${year - 1}/${year}`;
}

module.exports = {
  computeWeeks,
  defaultRangeForAcademicYear,
  currentAcademicYear,
  DAYS_IT_SHORT,
};
