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
 *   1. "Prenotazioni"        — lista flat delle booking confermate (N giorni)
 *   2. "Griglia · <sede>"    — UNA TAB PER OGNI EDIFICIO con matrice aule
 *                              × slot 30 min (08:00–21:00) del giorno corrente,
 *                              replica fedele del Display kiosk
 *   3. "Info sync"           — metadata (ultimo export OK, conteggio, versione)
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

// Slot della giornata replicati dal Display kiosk: 08:00 → 21:00 con
// granularità 30 minuti. Totale 27 etichette (l'ultima è "21:00" inclusa
// solo come bordo, le celle utili vanno fino a 20:30).
const DAY_HOUR_START = 8;
const DAY_HOUR_END = 21;

function buildDaySlots() {
  const slots = [];
  for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

// Palette per tipo prenotazione — derivata da frontend/src/lib/bookings.ts
// (BOOKING_TYPE_STYLES.soft) per fedeltà visiva col Display kiosk.
// ARGB: prefisso FF = alpha 100%. Colori Tailwind v3:
//   *-100 → fill della cella
//   *-200 → bordo
//   *-900 → testo
const TYPE_FILL_ARGB = {
  studio_individuale: { bg: 'FFD1FAE5', border: 'FFA7F3D0', text: 'FF064E3B' }, // emerald
  lezione: { bg: 'FFE0F2FE', border: 'FFBAE6FD', text: 'FF0C4A6E' }, // sky
  prova: { bg: 'FFFEF3C7', border: 'FFFDE68A', text: 'FF78350F' }, // amber
  concerto: { bg: 'FFFFE4E6', border: 'FFFECDD3', text: 'FF881337' }, // rose
  altro: { bg: 'FFEDE9FE', border: 'FFDDD6FE', text: 'FF4C1D95' }, // violet
};
function paletteFor(type) {
  return TYPE_FILL_ARGB[type] || TYPE_FILL_ARGB.altro;
}

// Colori "neutri" per le righe base + header
const HEADER_BG_ARGB = 'FFF1F5F9'; // slate-100
const HEADER_TEXT_ARGB = 'FF0F172A'; // slate-900
const FLOOR_BAND_ARGB = 'FFF8FAFC'; // slate-50 (zebra leggero per cambio piano)
const ROOM_LABEL_TEXT_ARGB = 'FF334155'; // slate-700
const CELL_BORDER_ARGB = 'FFE2E8F0'; // slate-200 — griglia neutra di sfondo

// Collator numeric-aware: "Aula 9" prima di "Aula 10". Stesso identico
// comportamento di frontend/src/lib/sortRooms.ts per fedeltà con il Display.
const roomCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortRoomsForBuilding(rooms, building) {
  const floors = building?.floors ?? [];
  return [...rooms].sort((a, b) => {
    const ai = floors.indexOf(a.floor);
    const bi = floors.indexOf(b.floor);
    const aIdx = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bIdx = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    if (aIdx === Number.MAX_SAFE_INTEGER) {
      const f = roomCollator.compare(a.floor || '', b.floor || '');
      if (f !== 0) return f;
    }
    return roomCollator.compare(a.name, b.name);
  });
}

/**
 * Sanifica il nome di un foglio Excel: max 31 char, niente \ / ? * [ ] :
 * Se ci sono collisioni dopo il truncate, append " (N)".
 */
function safeSheetName(name, used) {
  let s = String(name || 'Sede')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28); // lasciamo margine per " (N)"
  if (!s) s = 'Sede';
  let candidate = s;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${s} (${i++})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Etichetta di una cella nella griglia, replica del Display kiosk:
 *   - type=concerto → titolo del concerto (o "Concerto")
 *   - altri tipi    → cognome del prenotante (se docente) o ruolo
 */
function cellLabel(b) {
  if (b.type === 'concerto') {
    return b.concertInfo?.title ? `🎵 ${b.concertInfo.title}` : '🎵 Concerto';
  }
  if (b.user) {
    if (b.user.role === 'docente') return `Prof. ${b.user.lastName}`;
    return b.user.lastName;
  }
  return b.type || 'Prenotato';
}

// Helper: bordo uniforme (replica della "card" del Display)
function softBorder(argb) {
  return {
    top: { style: 'thin', color: { argb } },
    bottom: { style: 'thin', color: { argb } },
    left: { style: 'thin', color: { argb } },
    right: { style: 'thin', color: { argb } },
  };
}

/**
 * Crea UN foglio per ogni Building: matrice aule × slot 30 min del giorno
 * corrente, con:
 *   - celle colorate per tipo prenotazione (palette di BOOKING_TYPE_STYLES)
 *   - merge orizzontale dei blocchi contigui (replica dei rettangoli del Display)
 *   - bordi soft per griglia neutra
 *   - banda alternata al cambio piano
 *   - header sticky (freeze pane su riga 1 + colonne A-B)
 */
function buildPerBuildingGrids(workbook, buildings) {
  const today = dayjs().startOf('day');
  const slots = buildDaySlots();
  const FIRST_SLOT_COL = 3; // A=Piano, B=Aula, C=primo slot
  const usedNames = new Set();

  for (const building of buildings) {
    const sortedRooms = sortRoomsForBuilding(building.rooms || [], building);
    if (sortedRooms.length === 0) continue;

    const sheetName = safeSheetName(`Griglia · ${building.name}`, usedNames);
    const sheet = workbook.addWorksheet(sheetName);

    // ─── Header ─────────────────────────────────────────────────────────
    sheet.columns = [
      { header: 'Piano', key: 'floor', width: 14 },
      { header: 'Aula', key: 'room', width: 22 },
      ...slots.map((s, i) => ({ header: s, key: `s${i}`, width: 6 })),
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: HEADER_TEXT_ARGB } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 22;
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_ARGB } };
      cell.border = softBorder(CELL_BORDER_ARGB);
    });
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    // ─── Righe base (aule) ──────────────────────────────────────────────
    // Prima aggiungo tutte le righe vuote; dopo dipingo i blocchi prenotazione.
    let prevFloor = null;
    let zebra = false;
    const roomToRowIndex = new Map(); // roomId → numero riga Excel (1-based)
    for (const room of sortedRooms) {
      if (room.floor !== prevFloor) {
        zebra = !zebra;
        prevFloor = room.floor;
      }
      const row = { floor: room.floor || '—', room: room.name };
      for (let i = 0; i < slots.length; i++) row[`s${i}`] = '';
      const added = sheet.addRow(row);
      added.height = 22;
      roomToRowIndex.set(room.id, added.number);

      // Stile righe base: bordo soft, font slate-700 per piano/aula,
      // banda zebra leggera al cambio piano
      added.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = softBorder(CELL_BORDER_ARGB);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (colNumber <= 2) {
          cell.font = { bold: colNumber === 2, color: { argb: ROOM_LABEL_TEXT_ARGB } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        }
        if (zebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FLOOR_BAND_ARGB } };
        }
      });
    }

    // ─── Blocchi prenotazione: colorati + merge orizzontale ─────────────
    for (const room of sortedRooms) {
      const rowIdx = roomToRowIndex.get(room.id);
      if (!rowIdx) continue;
      const bookings = (room.bookings || [])
        .filter((b) => dayjs(b.startTime).isSame(today, 'day'))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      for (const b of bookings) {
        const start = dayjs(b.startTime);
        const end = dayjs(b.endTime);
        let startSlot = (start.hour() - DAY_HOUR_START) * 2 + (start.minute() >= 30 ? 1 : 0);
        let endSlot = (end.hour() - DAY_HOUR_START) * 2 + (end.minute() > 0 ? 1 : 0);
        // Clamp dentro la finestra visibile
        startSlot = Math.max(0, startSlot);
        endSlot = Math.min(slots.length, endSlot);
        if (endSlot <= startSlot) continue;

        const palette = paletteFor(b.type);
        const label = cellLabel(b);
        const startCol = FIRST_SLOT_COL + startSlot;
        const endCol = FIRST_SLOT_COL + endSlot - 1;

        // Merge se il blocco copre più di uno slot (replica del rettangolo
        // del Display). Single-slot resta singola cella.
        if (endCol > startCol) {
          sheet.mergeCells(rowIdx, startCol, rowIdx, endCol);
        }
        const cell = sheet.getCell(rowIdx, startCol);
        cell.value = label;
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
          shrinkToFit: true,
        };
        cell.font = {
          bold: true,
          size: 10,
          color: { argb: palette.text },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: palette.bg },
        };
        cell.border = softBorder(palette.border);
      }
    }

    // Auto-filter sulle prime due colonne (Piano / Aula)
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
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
  const models = require('../models');
  const { Booking, Room, Building, User, ConcertInfo } = models;
  const { Op } = require('sequelize');
  const lookaheadDays = getLookaheadDays();
  const todayStart = dayjs().startOf('day').toDate();
  const todayEnd = dayjs().endOf('day').toDate();
  const fromAll = todayStart;
  const toAll = dayjs().add(lookaheadDays, 'day').endOf('day').toDate();

  // Foglio "Prenotazioni": lista flat finestra lookahead
  const bookings = await Booking.findAll({
    where: {
      status: 'confirmed',
      startTime: { [Op.between]: [fromAll, toAll] },
    },
    include: [
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'role'] },
    ],
    order: [['startTime', 'ASC']],
  });

  // Per i fogli "Griglia · <sede>": ricarico la struttura Building → Rooms →
  // Bookings del SOLO giorno corrente. Stesso pattern di /api/public/agenda
  // così la griglia Excel è la replica esatta di ciò che vede il Display.
  const includeConcert = ConcertInfo
    ? [{ model: ConcertInfo, as: 'concertInfo', attributes: ['title'], required: false }]
    : [];
  const buildings = await Building.findAll({
    include: [
      {
        model: Room,
        as: 'rooms',
        where: { isBookable: true },
        required: false,
        include: [
          {
            model: Booking,
            as: 'bookings',
            required: false,
            where: {
              status: 'confirmed',
              startTime: { [Op.lt]: todayEnd },
              endTime: { [Op.gt]: todayStart },
            },
            attributes: ['id', 'startTime', 'endTime', 'type', 'purpose'],
            include: [
              {
                model: User,
                as: 'user',
                attributes: ['firstName', 'lastName', 'role'],
              },
              ...includeConcert,
            ],
          },
        ],
      },
    ],
    order: [
      ['name', 'ASC'],
      [{ model: Room, as: 'rooms' }, 'name', 'ASC'],
    ],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cadenza';
  workbook.created = new Date();

  buildBookingsSheet(workbook, bookings);
  buildPerBuildingGrids(workbook, buildings);
  buildInfoSheet(workbook, {
    exportAt: new Date(),
    nextExportAt: null,
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
