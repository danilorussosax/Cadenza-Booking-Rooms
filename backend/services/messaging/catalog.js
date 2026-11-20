'use strict';

// =============================================================================
// Risoluzione di sedi / aule / tipi attività: query DB + matcher e renderer
// puri (testabili senza DB). Usato da comandi di lettura e wizard /book.
// =============================================================================

const { Op } = require('sequelize');
const { Room, Building, BookingTypeCatalog } = require('../../models');
const { mdSafe } = require('./telegramText');

async function findRoomByQuery(q, opts = {}) {
  const term = String(q || '').trim();
  if (!term) return null;
  const where = {
    isBookable: true,
    [Op.or]: [
      { code: term },
      { name: term },
      { code: { [Op.like]: `%${term}%` } },
      { name: { [Op.like]: `%${term}%` } },
    ],
  };
  // Scope opzionale alla sede: utile dal wizard per evitare collisioni
  // tra aule con lo stesso codice in edifici diversi.
  if (opts.buildingId != null) where.buildingId = opts.buildingId;
  return Room.findOne({ where });
}

/** Spezza una query "aula@sede" o "sede/aula" in parti separate. La forma
 *  pura "aula" lascia `buildingTerm = null`. Lo scope su sede serve a
 *  disambiguare aule omonime in edifici diversi. */
function splitRoomBuildingQuery(q) {
  const term = String(q || '').trim();
  if (!term) return { roomTerm: '', buildingTerm: null };
  // "<aula>@<sede>" — preferito perché auto-esplicativo e non collide con
  // codici aula che possono contenere "/" (es. "A/12").
  const at = term.split('@');
  if (at.length === 2 && at[0].trim() && at[1].trim()) {
    return { roomTerm: at[0].trim(), buildingTerm: at[1].trim() };
  }
  // "<sede>/<aula>" — solo se la metà sinistra non sembra un codice aula
  // breve. Per sicurezza accettiamo solo se il `/` è presente UNA volta e
  // la parte sinistra è almeno 3 char (riduce falsi positivi tipo "A/12").
  const slashIdx = term.indexOf('/');
  if (slashIdx >= 3 && term.indexOf('/', slashIdx + 1) === -1) {
    const left = term.slice(0, slashIdx).trim();
    const right = term.slice(slashIdx + 1).trim();
    if (left && right) return { roomTerm: right, buildingTerm: left };
  }
  return { roomTerm: term, buildingTerm: null };
}

/** Carica le sedi attive (= con almeno 1 aula prenotabile, niente edifici
 *  vuoti o cestinati). Cap a 25 per non rendere il messaggio Telegram
 *  troppo lungo. */
async function listActiveBuildings() {
  const buildings = await Building.findAll({
    attributes: ['id', 'name'],
    include: [
      {
        model: Room,
        as: 'rooms',
        attributes: ['id'],
        where: { isBookable: true },
        required: true, // INNER JOIN: solo edifici con aule prenotabili
      },
    ],
    order: [['name', 'ASC']],
    limit: 25,
  });
  // Dedup per id (l'INNER JOIN può generare righe per ciascuna aula)
  const seen = new Set();
  const out = [];
  for (const b of buildings) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({ id: b.id, name: b.name });
  }
  return out;
}

/** Match flessibile: numero (1-based dell'elenco), id numerico, oppure
 *  ricerca case-insensitive sul nome. */
function matchBuildingByQuery(buildings, q) {
  const term = String(q || '').trim();
  if (!term) return null;
  // Numero 1-based dalla lista mostrata all'utente
  const asIndex = Number.parseInt(term, 10);
  if (!Number.isNaN(asIndex) && asIndex >= 1 && asIndex <= buildings.length) {
    return buildings[asIndex - 1];
  }
  // Match esatto su nome (case-insensitive)
  const lower = term.toLowerCase();
  const exact = buildings.find((b) => b.name.toLowerCase() === lower);
  if (exact) return exact;
  // Match parziale (substring)
  const partial = buildings.find((b) => b.name.toLowerCase().includes(lower));
  return partial || null;
}

/** Render della lista sedi numerata, formato Telegram-friendly. */
function renderBuildingsList(buildings) {
  return buildings.map((b, i) => `${i + 1}. *${mdSafe(b.name)}*`).join('\n');
}

// =============================================================================
// BookingType helpers (Step 4 del wizard /book)
// =============================================================================

/** Carica i tipi di prenotazione attivi dal catalogo, ordinati come l'admin
 *  ha previsto. Il bot mostra solo `code` + `label` — color/icon non hanno
 *  senso in chat testuale. */
async function listActiveBookingTypes() {
  const rows = await BookingTypeCatalog.findAll({
    where: { isActive: true },
    attributes: ['code', 'label'],
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return rows.map((r) => ({ code: r.code, label: r.label }));
}

/** Match flessibile su code o label. Accetta anche il numero 1-based. */
function matchBookingTypeByQuery(types, q) {
  const term = String(q || '').trim();
  if (!term) return null;
  const asIndex = Number.parseInt(term, 10);
  if (!Number.isNaN(asIndex) && asIndex >= 1 && asIndex <= types.length) {
    return types[asIndex - 1];
  }
  const lower = term.toLowerCase();
  // Match esatto su code (es. "lezione")
  const byCode = types.find((t) => t.code === lower);
  if (byCode) return byCode;
  // Match esatto su label (case-insensitive)
  const byLabel = types.find((t) => t.label.toLowerCase() === lower);
  if (byLabel) return byLabel;
  // Match parziale su entrambi
  const partial = types.find(
    (t) => t.code.includes(lower) || t.label.toLowerCase().includes(lower),
  );
  return partial || null;
}

/** Render della lista tipi numerata. */
function renderBookingTypesList(types) {
  return types.map((t, i) => `${i + 1}. *${mdSafe(t.label)}*`).join('\n');
}

module.exports = {
  findRoomByQuery,
  splitRoomBuildingQuery,
  listActiveBuildings,
  matchBuildingByQuery,
  renderBuildingsList,
  listActiveBookingTypes,
  matchBookingTypeByQuery,
  renderBookingTypesList,
};
