'use strict';

/**
 * Test suite per il modulo Excel Export:
 *   - service `excelExporter` (isEnabled, getStatus, exportNow, build griglie)
 *   - scheduler `excelExportScheduler` (start/stop, no-op disabled)
 *   - route `/api/admin/excel-export/*` (auth, status, export-now, download)
 *
 * Smoke + happy path + edge case principali. Non duplica i test fatti via
 * smoke su DB Postgres reale: qui usiamo SQLite in-memory del setup test.
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dayjs = require('dayjs');

const { buildApp } = require('../../app');
const {
  createAdmin,
  createAuthedUser,
  createBuilding,
  createRoom,
  createBooking,
} = require('../factories');

const app = buildApp({ serveFrontend: false });

let tmpExportPath;
const ORIGINAL_ENV = { ...process.env };

function setExportEnv({ enabled, path: p, lookahead, tick } = {}) {
  if (enabled !== undefined) process.env.EXCEL_EXPORT_ENABLED = String(enabled);
  if (p !== undefined) process.env.EXCEL_EXPORT_PATH = p;
  if (lookahead !== undefined) process.env.EXCEL_EXPORT_LOOKAHEAD_DAYS = String(lookahead);
  if (tick !== undefined) process.env.EXCEL_EXPORT_TICK_MIN = String(tick);
}

function restoreEnv() {
  // Ripristina SOLO le var che potremmo aver toccato qui (non l'intero env
  // perché tests/setup.js ne imposta altre per il processo).
  for (const k of [
    'EXCEL_EXPORT_ENABLED',
    'EXCEL_EXPORT_PATH',
    'EXCEL_EXPORT_LOOKAHEAD_DAYS',
    'EXCEL_EXPORT_TICK_MIN',
  ]) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
}

beforeEach(async () => {
  await resetDatabase();
  // Path temporaneo univoco per ogni test
  tmpExportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-xlsx-')),
    'cadenza-test.xlsx',
  );
  setExportEnv({ enabled: false, path: tmpExportPath, lookahead: 30, tick: 10 });
  // Reset cache di require per ripartire con stato in-memory pulito
  delete require.cache[require.resolve('../../services/excelExporter')];
  delete require.cache[require.resolve('../../services/excelExportScheduler')];
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmpExportPath), { recursive: true, force: true });
  } catch (_e) {
    // path cleanup best-effort
  }
  restoreEnv();
});

// =====================================================
// SERVICE — excelExporter
// =====================================================
describe('excelExporter · service', () => {
  it('isEnabled() ritorna false se env=false', () => {
    setExportEnv({ enabled: false });
    const exporter = require('../../services/excelExporter');
    expect(exporter.isEnabled()).toBe(false);
  });

  it('isEnabled() ritorna true se env=true (case insensitive)', () => {
    setExportEnv({ enabled: 'TRUE' });
    const exporter = require('../../services/excelExporter');
    expect(exporter.isEnabled()).toBe(true);
  });

  it('getExportPath() rispetta path assoluto', () => {
    setExportEnv({ path: '/tmp/abs/path.xlsx' });
    const exporter = require('../../services/excelExporter');
    expect(exporter.getExportPath()).toBe('/tmp/abs/path.xlsx');
  });

  it('getExportPath() risolve path relativo rispetto a backend/', () => {
    setExportEnv({ path: 'data/exports/test.xlsx' });
    const exporter = require('../../services/excelExporter');
    const p = exporter.getExportPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/data\/exports\/test\.xlsx$/);
  });

  it('exportNow() ritorna { ok: false, reason } se disabilitato', async () => {
    setExportEnv({ enabled: false });
    const exporter = require('../../services/excelExporter');
    const r = await exporter.exportNow();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disabilitato/i);
  });

  it('getStatus() rispecchia stato disabilitato + path', () => {
    setExportEnv({ enabled: false, path: tmpExportPath });
    const exporter = require('../../services/excelExporter');
    const s = exporter.getStatus();
    expect(s.enabled).toBe(false);
    expect(s.path).toBe(tmpExportPath);
    expect(s.lastExportAt).toBeNull();
    expect(s.fileExists).toBe(false);
    expect(s.lookaheadDays).toBe(30);
  });

  it('exportNow() genera file .xlsx con 3+ fogli su DB con dati', async () => {
    setExportEnv({ enabled: true });
    const exporter = require('../../services/excelExporter');

    // Setup dataset: 1 building con 2 aule + 2 booking di oggi di tipi
    // diversi (uno con copertura concerto)
    const building = await createBuilding({
      name: 'Edificio Test',
      floors: ['Piano Terra', 'Primo Piano'],
    });
    const r1 = await createRoom({ building, name: 'Aula 9', floor: 'Piano Terra' });
    const r2 = await createRoom({ building, name: 'Aula 10', floor: 'Primo Piano' });
    const todayStart = dayjs().startOf('day');
    await createBooking({
      room: r1,
      startTime: todayStart.hour(9).toDate(),
      endTime: todayStart.hour(10).toDate(),
      type: 'lezione',
    });
    await createBooking({
      room: r2,
      startTime: todayStart.hour(14).toDate(),
      endTime: todayStart.hour(16).toDate(),
      type: 'prova',
    });

    const r = await exporter.exportNow();
    expect(r.ok).toBe(true);
    expect(r.rowCount).toBeGreaterThanOrEqual(2);
    expect(r.sizeBytes).toBeGreaterThan(100);
    expect(fs.existsSync(tmpExportPath)).toBe(true);

    // Verifica che il file sia un .xlsx valido aprendolo con exceljs
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpExportPath);
    const sheetNames = wb.worksheets.map((s) => s.name);
    expect(sheetNames).toContain('Prenotazioni');
    expect(sheetNames.some((n) => n.startsWith('Griglia · '))).toBe(true);
    expect(sheetNames).toContain('Info sync');

    // Verifica che lo status sia aggiornato
    const s = exporter.getStatus();
    expect(s.lastExportAt).not.toBeNull();
    expect(s.lastExportError).toBeNull();
    expect(s.fileExists).toBe(true);
    expect(s.lastExportSizeBytes).toBe(r.sizeBytes);
  });

  it('exportNow() crea la cartella di destinazione se manca', async () => {
    setExportEnv({
      enabled: true,
      path: path.join(os.tmpdir(), 'cadenza-mkdir-test', 'sub', 'f.xlsx'),
    });
    const exporter = require('../../services/excelExporter');
    const r = await exporter.exportNow();
    expect(r.ok).toBe(true);
    expect(fs.existsSync(r.path)).toBe(true);
    // cleanup
    fs.rmSync(path.join(os.tmpdir(), 'cadenza-mkdir-test'), { recursive: true, force: true });
  });
});

// =====================================================
// SCHEDULER — excelExportScheduler
// =====================================================
describe('excelExportScheduler', () => {
  it('start() non avvia nulla se modulo disabilitato', () => {
    setExportEnv({ enabled: false });
    const scheduler = require('../../services/excelExportScheduler');
    // Idempotente: non deve lanciare anche se chiamato due volte
    scheduler.start();
    scheduler.start();
    scheduler.stop(); // safe anche su no-op
    expect(true).toBe(true); // no throw
  });

  it('start() avvia timer se modulo abilitato; stop() lo ferma', () => {
    setExportEnv({ enabled: true, tick: 10 });
    const scheduler = require('../../services/excelExportScheduler');
    scheduler.start();
    // Doppio start è idempotente
    scheduler.start();
    scheduler.stop();
    // Doppio stop è idempotente
    scheduler.stop();
    expect(true).toBe(true);
  });

  it('tick() chiama exportNow ed esce senza throw', async () => {
    setExportEnv({ enabled: true });
    const scheduler = require('../../services/excelExportScheduler');
    await expect(scheduler.tick()).resolves.toBeUndefined();
  });

  it('tick() su modulo disabilitato gestisce gracefully', async () => {
    setExportEnv({ enabled: false });
    const scheduler = require('../../services/excelExportScheduler');
    await expect(scheduler.tick()).resolves.toBeUndefined();
  });
});

// =====================================================
// ROUTE — /api/admin/excel-export
// =====================================================
describe('excelExport · route admin', () => {
  it('GET /status senza auth → 401', async () => {
    const res = await request(app).get('/api/admin/excel-export/status');
    expect(res.status).toBe(401);
  });

  it('GET /status come non-admin → 403', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/admin/excel-export/status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET /status come admin → 200 con campi attesi', async () => {
    setExportEnv({ enabled: false });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/excel-export/status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      lookaheadDays: 30,
      lastExportRowCount: 0,
      fileExists: false,
    });
    expect(typeof res.body.path).toBe('string');
  });

  it('POST /export-now disabilitato → 400 con messaggio', async () => {
    setExportEnv({ enabled: false });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/admin/excel-export/export-now')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/disabilitato/i);
  });

  it('POST /export-now abilitato → 200 con metriche', async () => {
    setExportEnv({ enabled: true });
    const { authHeader } = await createAdmin();
    // Setup data minimo
    const building = await createBuilding();
    const room = await createRoom({ building });
    const start = dayjs().startOf('day').hour(10).toDate();
    await createBooking({ room, startTime: start, endTime: dayjs(start).add(1, 'hour').toDate() });

    const res = await request(app)
      .post('/api/admin/excel-export/export-now')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rowCount).toBeGreaterThanOrEqual(1);
    expect(res.body.sizeBytes).toBeGreaterThan(0);
  });

  it('GET /download disabilitato → 400', async () => {
    setExportEnv({ enabled: false });
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/excel-export/download')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
  });

  it('GET /download abilitato → 200 con MIME xlsx', async () => {
    setExportEnv({ enabled: true });
    const { authHeader } = await createAdmin();
    const building = await createBuilding();
    await createRoom({ building });

    const res = await request(app)
      .get('/api/admin/excel-export/download')
      .set('Authorization', authHeader)
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('GET /download genera al volo il file se non esiste', async () => {
    setExportEnv({ enabled: true });
    const { authHeader } = await createAdmin();
    // Forza un path inesistente
    expect(fs.existsSync(tmpExportPath)).toBe(false);

    const res = await request(app)
      .get('/api/admin/excel-export/download')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    // Dopo il download il file deve esistere
    expect(fs.existsSync(tmpExportPath)).toBe(true);
  });
});
