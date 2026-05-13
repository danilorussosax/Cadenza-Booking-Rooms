'use strict';

/**
 * Export delle prenotazioni Cadenza su file .xlsx locale per business continuity.
 *
 * Strategia: il backend scrive periodicamente un file Excel in una cartella
 * locale (default `/var/cadenza/sync/`). Quella cartella è poi sincronizzata
 * dal SO (rclone + cron) verso un cloud personale (OneDrive/Dropbox/iCloud).
 * Se il server crasha, la portineria apre l'ultima copia del file dall'app
 * mobile del cloud.
 *
 * Direzione: SOLO Cadenza → file. Mai il contrario.
 *   - Modifiche manuali al file dell'admin durante un crash NON tornano nel DB.
 *   - Alla ripartenza, l'admin trascrive a mano le righe annotate nella tab
 *     "Prenotazioni manuali (offline)" dentro Cadenza.
 *
 * Fogli del workbook:
 *   1. "Prenotazioni"  — lista flat delle booking confermate dei prossimi N giorni
 *   2. "Griglia oggi"  — matrice aule × slot 30 min per il giorno corrente
 *   3. "Info sync"     — metadata (ultimo export OK, conteggio, versione)
 *
 * Configurazione via env:
 *   EXCEL_EXPORT_ENABLED=true
 *   EXCEL_EXPORT_PATH=/var/cadenza/sync/cadenza-prenotazioni.xlsx
 *   EXCEL_EXPORT_TICK_MIN=10
 *   EXCEL_EXPORT_LOOKAHEAD_DAYS=30
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const logger = require('../lib/logger').child({ scope: 'excelExport' });

// Lazy-load di exceljs: la libreria pesa ~20 MB unpacked. Se manca sul VPS
// (npm ci non eseguito), il backend deve partire lo stesso finché il modulo
// resta disabilitato. Quando enabled=true e exceljs manca, l'admin vede
// l'errore nel pannello invece di un crash al boot.
let _ExcelJS = null;
function loadExcelJs() {
  if (_ExcelJS) return _ExcelJS;
  try {
    _ExcelJS = require('exceljs');
    return _ExcelJS;
  } catch (err) {
    throw new Error(
      `Dipendenza "exceljs" mancante: esegui "npm install exceljs" nel backend. Detail: ${err.message}`,
    );
  }
}

// Stato in-memory per la UI admin
let lastExportAt = null;
let lastExportError = null;
let lastExportRowCount = 0;
let lastExportDurationMs = 0;
let lastExportSizeBytes = 0;

function isEnabled() {
  return String(process.env.EXCEL_EXPORT_ENABLED || '').toLowerCase() === 'true';
}

function getExportPath() {
  const p = process.env.EXCEL_EXPORT_PATH || '/var/cadenza/sync/cadenza-prenotazioni.xlsx';
  return path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p);
}

function getLookaheadDays() {
  const n = Number(process.env.EXCEL_EXPORT_LOOKAHEAD_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 30;
}

/**
 * Costruisce il foglio "Prenotazioni" con tutte le booking confermate nei
 * prossimi `lookaheadDays` giorni. Una riga per prenotazione.
 */
function buildBookingsSheet(workbook, bookings) {
  const sheet = workbook.addWorksheet('Prenotazioni');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Aula', key: 'room', width: 22 },
    { header: 'Edificio', key: 'building', width: 18 },
    { header: 'Utente', key: 'user', width: 28 },
    { header: 'Ruolo', key: 'role', width: 10 },
    { header: 'Inizio', key: 'start', width: 18 },
    { header: 'Fine', key: 'end', width: 18 },
    { header: 'Tipo', key: 'type', width: 14 },
    { header: 'Stato', key: 'status', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }]; // header sticky

  for (const b of bookings) {
    sheet.addRow({
      id: b.id,
      room: b.room?.name ?? '',
      building: b.room?.building?.name ?? '',
      user: b.user ? `${b.user.lastName} ${b.user.firstName}` : '',
      role: b.user?.role ?? '',
      start: dayjs(b.startTime).format('DD/MM/YYYY HH:mm'),
      end: dayjs(b.endTime).format('DD/MM/YYYY HH:mm'),
      type: b.type ?? '',
      status: b.status ?? '',
    });
  }
}

/**
 * Foglio "Griglia oggi" — matrice aule × slot di 30 minuti del giorno corrente.
 * Colpo d'occhio per la portineria: "chi c'è in aula 12 alle 15:00?".
 */
function buildTodayGridSheet(workbook, bookings, rooms) {
  const sheet = workbook.addWorksheet('Griglia oggi');
  const today = dayjs().startOf('day');

  // Slot 7:00 → 23:00 con granularità 30 min = 32 colonne
  const slots = [];
  for (let h = 7; h < 23; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  const columns = [
    { header: 'Aula', key: 'room', width: 22 },
    { header: 'Edificio', key: 'building', width: 18 },
    ...slots.map((s, i) => ({ header: s, key: `s${i}`, width: 8 })),
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  // Mappa "roomId|slotIndex" → label utente
  const cellMap = new Map();
  for (const b of bookings) {
    const start = dayjs(b.startTime);
    const end = dayjs(b.endTime);
    if (!start.isSame(today, 'day')) continue;
    const startSlot = (start.hour() - 7) * 2 + (start.minute() >= 30 ? 1 : 0);
    const endSlot = (end.hour() - 7) * 2 + (end.minute() > 0 ? 1 : 0);
    for (let s = startSlot; s < endSlot; s++) {
      if (s < 0 || s >= slots.length) continue;
      const label = b.user ? b.user.lastName : 'X';
      cellMap.set(`${b.roomId}|${s}`, label);
    }
  }

  for (const room of rooms) {
    const row = { room: room.name, building: room.building?.name ?? '' };
    for (let i = 0; i < slots.length; i++) {
      row[`s${i}`] = cellMap.get(`${room.id}|${i}`) || '';
    }
    sheet.addRow(row);
  }
}

/**
 * Foglio "Info sync" — quando è stato fatto l'ultimo export e come funziona.
 */
function buildInfoSheet(workbook, info) {
  const sheet = workbook.addWorksheet('Info sync');
  sheet.columns = [
    { header: 'Campo', key: 'k', width: 32 },
    { header: 'Valore', key: 'v', width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };

  const rows = [
    { k: 'Cadenza · Export prenotazioni', v: '' },
    { k: '', v: '' },
    { k: 'Ultimo export OK', v: dayjs(info.exportAt).format('DD/MM/YYYY HH:mm:ss') },
    {
      k: 'Prossimo export',
      v: info.nextExportAt ? dayjs(info.nextExportAt).format('DD/MM/YYYY HH:mm:ss') : '—',
    },
    { k: 'Durata ultimo export', v: `${info.durationMs} ms` },
    { k: 'Record sincronizzati', v: String(info.rowCount) },
    { k: 'Finestra prenotazioni', v: `+${info.lookaheadDays} giorni` },
    { k: 'Versione export', v: '1.0.0' },
    { k: '', v: '' },
    { k: 'NOTA OPERATIVA', v: '' },
    { k: 'Direzione', v: 'Cadenza → file (mai il contrario)' },
    { k: 'Modifiche al file', v: 'NON tornano in Cadenza' },
    {
      k: 'Procedura crash',
      v: 'usa un file separato "Prenotazioni manuali (offline)" e trascrivi al ripristino',
    },
  ];
  for (const r of rows) sheet.addRow(r);
}

/**
 * Genera un workbook completo con tutti e 3 i fogli.
 * Restituisce l'istanza ExcelJS.Workbook (per stream/buffer/scrittura).
 */
async function buildWorkbook() {
  const ExcelJS = loadExcelJs();
  const { Booking, Room, Building, User } = require('../models');
  const { Op } = require('sequelize');
  const lookaheadDays = getLookaheadDays();
  const from = dayjs().startOf('day').toDate();
  const to = dayjs().add(lookaheadDays, 'day').endOf('day').toDate();

  const bookings = await Booking.findAll({
    where: {
      status: 'confirmed',
      startTime: { [Op.between]: [from, to] },
    },
    include: [
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'role'] },
    ],
    order: [['startTime', 'ASC']],
  });

  const rooms = await Room.findAll({
    where: { isBookable: true },
    include: [{ model: Building, as: 'building' }],
    order: [
      ['buildingId', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cadenza';
  workbook.created = new Date();

  buildBookingsSheet(workbook, bookings);
  buildTodayGridSheet(workbook, bookings, rooms);
  buildInfoSheet(workbook, {
    exportAt: new Date(),
    nextExportAt: null, // riempito da exportNow se ha senso
    durationMs: 0,
    rowCount: bookings.length,
    lookaheadDays,
  });

  return { workbook, rowCount: bookings.length, lookaheadDays };
}

/**
 * Esegue un export completo su disco. Aggiorna lo stato in-memory.
 * Non lancia: in caso di errore, salva il messaggio in `lastExportError`
 * e ritorna `{ ok: false, reason }` — chi chiama decide se ritentare.
 */
async function exportNow() {
  if (!isEnabled()) {
    const msg = 'Export Excel disabilitato (EXCEL_EXPORT_ENABLED=false)';
    lastExportError = msg;
    return { ok: false, reason: msg };
  }
  const t0 = Date.now();
  try {
    const filePath = getExportPath();
    const dir = path.dirname(filePath);

    // Assicura che la cartella esista (idempotente)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const { workbook, rowCount, lookaheadDays } = await buildWorkbook();

    // Scrivi su file temporaneo e poi rinomina: scrittura atomica per il
    // consumatore (rclone non vedrà mai un file mezzo scritto).
    const tmp = `${filePath}.tmp`;
    await workbook.xlsx.writeFile(tmp);
    fs.renameSync(tmp, filePath);

    const stats = fs.statSync(filePath);
    const elapsed = Date.now() - t0;

    lastExportAt = new Date();
    lastExportError = null;
    lastExportRowCount = rowCount;
    lastExportDurationMs = elapsed;
    lastExportSizeBytes = stats.size;

    logger.info({ rowCount, elapsed, sizeBytes: stats.size, path: filePath }, 'export Excel OK');
    return {
      ok: true,
      rowCount,
      lookaheadDays,
      durationMs: elapsed,
      sizeBytes: stats.size,
      path: filePath,
    };
  } catch (err) {
    lastExportError = err.message;
    logger.error({ err: err.message }, 'export Excel fallito');
    return { ok: false, reason: err.message };
  }
}

/** Stato corrente — esposto dalla UI admin. */
function getStatus() {
  const filePath = getExportPath();
  let fileExists = false;
  let fileMtime = null;
  try {
    if (fs.existsSync(filePath)) {
      fileExists = true;
      fileMtime = fs.statSync(filePath).mtime;
    }
  } catch (_e) {
    // ignora: path non leggibile (permessi) — non bloccante per la UI
  }
  return {
    enabled: isEnabled(),
    path: filePath,
    lookaheadDays: getLookaheadDays(),
    lastExportAt,
    lastExportError,
    lastExportRowCount,
    lastExportDurationMs,
    lastExportSizeBytes,
    fileExists,
    fileMtime,
  };
}

module.exports = { exportNow, getStatus, isEnabled, getExportPath };
