'use strict';

/**
 * Mirror delle prenotazioni Cadenza → Google Sheets.
 *
 * Obiettivo: business continuity. Se Cadenza è inaccessibile (server down,
 * DB rotto, deploy fallito), il portinaio del Conservatorio apre il foglio
 * Google dal telefono e vede chi ha l'aula 12 alle 14:00 di oggi.
 *
 * Direzione: SOLO Cadenza → Sheet. Mai il contrario.
 *   - Le modifiche al foglio dell'admin durante un crash NON tornano nel DB.
 *   - Alla ripartenza, l'admin trascrive a mano le righe annotate nella tab
 *     "Prenotazioni manuali (offline)" dentro Cadenza.
 *   - Niente conflict resolution automatica = niente bug oscuri.
 *
 * Tab del foglio:
 *   1. "Prenotazioni"  — lista flat delle booking confermate dei prossimi N giorni
 *   2. "Griglia oggi"  — matrice aule × slot 30 min per il giorno corrente
 *   3. "Info sync"     — metadata (ultimo sync OK, conteggio, versione)
 *
 * Configurazione via env (vedi config/database.js per il pattern):
 *   GOOGLE_SHEETS_MIRROR_ENABLED=true
 *   GOOGLE_SHEETS_SPREADSHEET_ID=18gekeQv...
 *   GOOGLE_SHEETS_SA_JSON_PATH=secrets/google-sheets-sa.json
 *   GOOGLE_SHEETS_LOOKAHEAD_DAYS=30   (default)
 *   GOOGLE_SHEETS_TICK_MIN=10         (default)
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const dayjs = require('dayjs');
const logger = require('../lib/logger').child({ scope: 'googleSheets' });

// In-memory state per stato/diagnostica (esposto in /admin/server-settings).
let lastSyncAt = null;
let lastSyncError = null;
let lastSyncRowCount = 0;
let lastSyncDurationMs = 0;

function isEnabled() {
  return String(process.env.GOOGLE_SHEETS_MIRROR_ENABLED || '').toLowerCase() === 'true';
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null;
}

function getLookaheadDays() {
  const n = Number(process.env.GOOGLE_SHEETS_LOOKAHEAD_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 30;
}

function getServiceAccountPath() {
  const rel = process.env.GOOGLE_SHEETS_SA_JSON_PATH || 'secrets/google-sheets-sa.json';
  return path.isAbsolute(rel) ? rel : path.resolve(__dirname, '..', rel);
}

/**
 * Carica le credenziali del Service Account e ritorna un oggetto sheets API
 * pronto all'uso. Throw se il file non esiste o non è un JSON valido.
 */
function getSheetsClient() {
  const keyPath = getServiceAccountPath();
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Service Account JSON non trovato: ${keyPath}. ` +
        `Imposta GOOGLE_SHEETS_SA_JSON_PATH o crea il file (vedi docs/SHEETS_MIRROR.md).`,
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly', // legge titolo/owner per validazione
    ],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Verifica connettività e permessi sul foglio (chiamata dal bottone admin
 * "Verifica connessione"). Ritorna { ok, title, ownerEmail, error }.
 */
async function probe() {
  if (!isEnabled()) {
    return { ok: false, error: 'Mirror disabilitato (GOOGLE_SHEETS_MIRROR_ENABLED=false)' };
  }
  const sheetId = getSpreadsheetId();
  if (!sheetId) {
    return { ok: false, error: 'GOOGLE_SHEETS_SPREADSHEET_ID non impostato' };
  }
  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'spreadsheetId,properties(title),sheets(properties(title))',
    });
    return {
      ok: true,
      title: meta.data.properties?.title,
      tabs: (meta.data.sheets || []).map((s) => s.properties?.title),
      spreadsheetId: meta.data.spreadsheetId,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Garantisce che le 3 tab esistano. Le crea se mancanti.
 */
async function ensureTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title))',
  });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const needed = ['Prenotazioni', 'Griglia oggi', 'Info sync'];
  const requests = [];
  for (const title of needed) {
    if (!existing.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }
}

/**
 * Scrive la tab "Prenotazioni" con tutte le booking confermate nei prossimi
 * `lookaheadDays` giorni. Sovrascrive: il foglio è una mirror, non un log.
 */
async function writeBookingsTab(sheets, spreadsheetId, bookings) {
  const header = [
    'Booking ID',
    'Aula',
    'Edificio',
    'Utente',
    'Ruolo',
    'Inizio',
    'Fine',
    'Tipo',
    'Stato',
  ];
  const rows = bookings.map((b) => [
    b.id,
    b.room?.name ?? '',
    b.room?.building?.name ?? '',
    b.user ? `${b.user.lastName} ${b.user.firstName}` : '',
    b.user?.role ?? '',
    dayjs(b.startTime).format('DD/MM/YYYY HH:mm'),
    dayjs(b.endTime).format('DD/MM/YYYY HH:mm'),
    b.type ?? '',
    b.status ?? '',
  ]);
  // values.update con range A1: cancella tutto il contenuto vecchio e scrive
  // il nuovo. Più semplice di clear+append, e atomico per il consumatore.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Prenotazioni!A1:Z',
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Prenotazioni!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...rows] },
  });
}

/**
 * Scrive la tab "Griglia oggi" con matrice aule × slot 30 min del giorno
 * corrente. Comoda per la portineria che vuole un colpo d'occhio.
 */
async function writeTodayGridTab(sheets, spreadsheetId, bookings, rooms) {
  const today = dayjs().startOf('day');
  // 7:00 → 23:00 con slot da 30 minuti = 32 colonne
  const slots = [];
  for (let h = 7; h < 23; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  const header = ['Aula', 'Edificio', ...slots];

  // Mappa "roomId|slotIndex" → user label
  const cellMap = new Map();
  for (const b of bookings) {
    const start = dayjs(b.startTime);
    const end = dayjs(b.endTime);
    if (!start.isSame(today, 'day')) continue;
    const startSlot = (start.hour() - 7) * 2 + (start.minute() >= 30 ? 1 : 0);
    const endSlot = (end.hour() - 7) * 2 + (end.minute() > 0 ? 1 : 0);
    for (let s = startSlot; s < endSlot; s++) {
      if (s < 0 || s >= slots.length) continue;
      const label = b.user ? `${b.user.lastName}` : 'X';
      cellMap.set(`${b.roomId}|${s}`, label);
    }
  }

  const rows = rooms.map((room) => {
    const cells = slots.map((_, idx) => cellMap.get(`${room.id}|${idx}`) || '');
    return [room.name, room.building?.name ?? '', ...cells];
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'Griglia oggi'!A1:ZZ",
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Griglia oggi'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...rows] },
  });
}

/**
 * Scrive la tab "Info sync": ultimo sync, prossimo, conteggio. Utile a chi
 * apre il foglio per capire "quanto è fresco?".
 */
async function writeInfoTab(sheets, spreadsheetId, info) {
  const rows = [
    ['Cadenza · Mirror prenotazioni — info'],
    [],
    [
      'Ultimo sync OK',
      info.lastSyncAt ? dayjs(info.lastSyncAt).format('DD/MM/YYYY HH:mm:ss') : '—',
    ],
    ['Prossimo sync', info.nextSyncAt ? dayjs(info.nextSyncAt).format('DD/MM/YYYY HH:mm:ss') : '—'],
    ['Durata ultimo sync', info.lastSyncDurationMs ? `${info.lastSyncDurationMs} ms` : '—'],
    ['Record sincronizzati', info.rowCount ?? 0],
    ['Finestra prenotazioni', `+${info.lookaheadDays} giorni`],
    ['Versione mirror', '1.0.0'],
    [],
    ['NOTA OPERATIVA'],
    ['Questo foglio è un MIRROR di sola lettura.'],
    ['Le modifiche fatte qui NON tornano in Cadenza.'],
    ['Se Cadenza è down e devi prenotare a mano, usa una tab separata'],
    ['"Prenotazioni manuali (offline)" e poi trascrivile in Cadenza al ripristino.'],
  ];
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'Info sync'!A1:Z",
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Info sync'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

/**
 * Esegue un sync completo. Throw su errori; chi chiama decide se ritentare.
 * Aggiorna lo stato in-memory per la UI admin.
 */
async function syncNow() {
  if (!isEnabled()) {
    const msg = 'Mirror disabilitato (env GOOGLE_SHEETS_MIRROR_ENABLED=false)';
    lastSyncError = msg;
    return { ok: false, reason: msg };
  }
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    const msg = 'GOOGLE_SHEETS_SPREADSHEET_ID non impostato';
    lastSyncError = msg;
    return { ok: false, reason: msg };
  }
  const t0 = Date.now();
  try {
    const { Booking, Room, Building, User } = require('../models');
    const { Op } = require('sequelize');
    const lookaheadDays = getLookaheadDays();
    const from = dayjs().startOf('day').toDate();
    const to = dayjs().add(lookaheadDays, 'day').endOf('day').toDate();

    // Carica in un unico shot le booking della finestra
    const bookings = await Booking.findAll({
      where: {
        status: 'confirmed',
        startTime: { [Op.between]: [from, to] },
      },
      include: [
        {
          model: Room,
          as: 'room',
          include: [{ model: Building, as: 'building' }],
        },
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'role'],
        },
      ],
      order: [['startTime', 'ASC']],
    });

    // Aule per la griglia oggi: tutte le aule prenotabili
    const rooms = await Room.findAll({
      where: { isBookable: true },
      include: [{ model: Building, as: 'building' }],
      order: [
        ['buildingId', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    const sheets = getSheetsClient();
    await ensureTabs(sheets, spreadsheetId);
    await writeBookingsTab(sheets, spreadsheetId, bookings);
    await writeTodayGridTab(sheets, spreadsheetId, bookings, rooms);

    const elapsed = Date.now() - t0;
    const tickMin = Number(process.env.GOOGLE_SHEETS_TICK_MIN || 10);
    await writeInfoTab(sheets, spreadsheetId, {
      lastSyncAt: new Date(),
      nextSyncAt: new Date(Date.now() + tickMin * 60 * 1000),
      lastSyncDurationMs: elapsed,
      rowCount: bookings.length,
      lookaheadDays,
    });

    lastSyncAt = new Date();
    lastSyncError = null;
    lastSyncRowCount = bookings.length;
    lastSyncDurationMs = elapsed;
    logger.info({ rowCount: bookings.length, elapsed }, 'mirror sync OK');
    return { ok: true, rowCount: bookings.length, durationMs: elapsed };
  } catch (err) {
    lastSyncError = err.message;
    logger.error({ err }, 'mirror sync failed');
    return { ok: false, reason: err.message };
  }
}

/** Stato corrente — usato dalla UI admin. */
function getStatus() {
  return {
    enabled: isEnabled(),
    spreadsheetId: getSpreadsheetId(),
    lookaheadDays: getLookaheadDays(),
    lastSyncAt,
    lastSyncError,
    lastSyncRowCount,
    lastSyncDurationMs,
  };
}

module.exports = { syncNow, probe, getStatus, isEnabled };
