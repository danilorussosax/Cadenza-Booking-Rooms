'use strict';

// =============================================================================
// Rendering testo Telegram (Markdown legacy) e formattazione di giorni/orari.
// Giorni e orari sono sempre calcolati nel fuso istituzionale.
// =============================================================================

const dayjs = require('dayjs');
require('dayjs/locale/it');
const institutionTime = require('../../lib/institutionTime');

// Tronca un messaggio Telegram (limite hard ~4096) in modo da:
//   - rispettare un budget conservativo (default 4000 char)
//   - tagliare all'ultimo newline disponibile sotto il budget, così non
//     spezziamo a metà di un'entità Markdown (es. `*Aula 12*` diventerebbe
//     `*Aula` e Telegram risponderebbe 400 → invio fallisce silentemente)
//   - aggiungere un suffix che spieghi il troncamento
function truncateForTelegram(text, suffix, maxLen = 4000) {
  if (text.length <= maxLen) return text;
  const sliceEnd = Math.max(0, maxLen - suffix.length);
  const newlineIdx = text.lastIndexOf('\n', sliceEnd);
  const cut = newlineIdx > sliceEnd - 400 && newlineIdx > 0 ? newlineIdx : sliceEnd;
  return text.slice(0, cut) + suffix;
}

// Caratteri "speciali" del Markdown legacy di Telegram: se non bilanciati il
// Bot API risponde 400 "can't parse entities" e l'utente non riceve nulla.
// Strategia conservativa: stripping dalle stringhe dinamiche prima
// dell'interpolazione nei template.
const MD_SPECIAL_RE = /[*_`[\]]/g;
function mdSafe(s) {
  return String(s ?? '')
    .replace(MD_SPECIAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'ddd D MMM' (locale it) di una data ISO di calendario. */
function dayLabelIso(iso, fmt = 'ddd D MMM') {
  return dayjs(`${iso}T12:00:00`).locale('it').format(fmt);
}

/** 'ddd D MMM' del giorno istituzionale che contiene l'istante `at`. */
function dayLabelOf(at, fmt = 'ddd D MMM') {
  return dayLabelIso(institutionTime.todayIso(at), fmt);
}

/** "ven 1 mag 14:00–15:00" per un intervallo di istanti (ora istituzionale). */
function formatSlot(start, end) {
  return `${dayLabelOf(start)} ${institutionTime.hhmmOf(start)}–${institutionTime.hhmmOf(end)}`;
}

/** "14:00–15:00" per un intervallo di istanti (ora istituzionale). */
function formatTimeSpan(start, end) {
  return `${institutionTime.hhmmOf(start)}–${institutionTime.hhmmOf(end)}`;
}

module.exports = {
  truncateForTelegram,
  mdSafe,
  dayLabelIso,
  dayLabelOf,
  formatSlot,
  formatTimeSpan,
};
