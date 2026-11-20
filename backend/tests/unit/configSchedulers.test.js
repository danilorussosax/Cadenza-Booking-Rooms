'use strict';

/**
 * lib/config.js — chiavi di backup, verifica backup, auto-restart ed export Excel.
 *
 * Fotografia dei default effettivi e dei significati che avevano nei moduli
 * (backupScheduler, backupVerifyScheduler, excelExporter, excelExportScheduler)
 * prima del consolidamento. Politica unica: assente/vuoto → default; presente
 * e non valido → ConfigError.
 */

const { getConfig, reloadConfig, ConfigError } = require('../../lib/config');

const ORIG = { ...process.env };

// [chiave, default, min, max]
const INTS = [
  ['BACKUP_TICK_HOUR', 2, 0, 23],
  ['BACKUP_TICK_MINUTE', 30, 0, 59],
  ['BACKUP_VERIFY_DAY', 0, 0, 6],
  ['BACKUP_VERIFY_HOUR', 3, 0, 23],
  ['BACKUP_VERIFY_MINUTE', 0, 0, 59],
  ['BACKUP_VERIFY_MAX_AGE_HOURS', 36, 1, 720],
  ['BACKUP_VERIFY_MIN_SQL_BYTES', 1024, 1, 10 * 1024 * 1024],
  ['BACKUP_VERIFY_TABLE_TOLERANCE', 2, 0, 100],
  ['EXCEL_EXPORT_TICK_MIN', 10, 1, 60],
  ['EXCEL_EXPORT_LOOKAHEAD_DAYS', 30, 1, 365],
];

// [chiave, default]
const BOOLS = [
  ['BACKUP_AUTO_ENABLED', true],
  ['AUTO_RESTART_ENABLED', false],
  ['BACKUP_VERIFY_ENABLED', true],
  ['EXCEL_EXPORT_ENABLED', false],
];

const NAMES = [...INTS.map((r) => r[0]), ...BOOLS.map((r) => r[0])];

function cleanEnv(overrides = {}) {
  for (const k of [...NAMES, 'NODE_ENV', 'JWT_SECRET']) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: 'test' }, overrides);
}

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG);
  reloadConfig();
});

describe('config schedulers — default effettivi', () => {
  it.each(INTS)('%s: default %s (anche vuoto)', (key, def) => {
    cleanEnv();
    expect(reloadConfig()[key]).toBe(def);
    cleanEnv({ [key]: '' });
    expect(reloadConfig()[key]).toBe(def);
  });

  it.each(BOOLS)('%s: default %s (anche vuoto)', (key, def) => {
    cleanEnv();
    expect(reloadConfig()[key]).toBe(def);
    cleanEnv({ [key]: '' });
    expect(reloadConfig()[key]).toBe(def);
  });

  it('i default non dipendono da NODE_ENV=production', () => {
    cleanEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) });
    const cfg = reloadConfig();
    for (const [k, d] of [...INTS, ...BOOLS]) expect(cfg[k]).toBe(d);
  });
});

describe('config schedulers — valori validi e non validi', () => {
  describe.each(INTS)('%s', (key, _d, min, max) => {
    it('accetta i limiti min e max', () => {
      cleanEnv({ [key]: String(min) });
      expect(reloadConfig()[key]).toBe(min);
      cleanEnv({ [key]: String(max) });
      expect(reloadConfig()[key]).toBe(max);
    });
    it('non numerico → ConfigError', () => {
      cleanEnv({ [key]: 'abc' });
      expect(() => reloadConfig()).toThrow(ConfigError);
      expect(() => reloadConfig()).toThrow(key);
    });
    it('sotto il minimo / sopra il massimo → ConfigError', () => {
      cleanEnv({ [key]: String(min - 1) });
      expect(() => reloadConfig()).toThrow(ConfigError);
      cleanEnv({ [key]: String(max + 1) });
      expect(() => reloadConfig()).toThrow(ConfigError);
    });
    it('rilegge l’env a runtime (semantica lazy)', () => {
      cleanEnv({ [key]: String(min) });
      expect(reloadConfig()[key]).toBe(min);
      process.env[key] = String(max);
      expect(getConfig()[key]).toBe(max);
    });
  });

  describe.each(BOOLS)('%s', (key) => {
    it.each([
      ['true', true],
      ['1', true],
      ['TRUE', true],
      ['True', true],
      ['false', false],
      ['0', false],
      ['FALSE', false],
    ])('%s → %s', (raw, expected) => {
      cleanEnv({ [key]: raw });
      expect(reloadConfig()[key]).toBe(expected);
    });
    it.each(['yes', 'no', 'on', 'abc', '2'])('%s → ConfigError', (raw) => {
      cleanEnv({ [key]: raw });
      expect(() => reloadConfig()).toThrow(ConfigError);
      expect(() => reloadConfig()).toThrow(key);
    });
  });

  it('valori di produzione (VPS) validi con gli stessi comportamenti', () => {
    cleanEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      EXCEL_EXPORT_ENABLED: 'true',
      EXCEL_EXPORT_TICK_MIN: '10',
      EXCEL_EXPORT_LOOKAHEAD_DAYS: '30',
    });
    const cfg = reloadConfig();
    expect(cfg.EXCEL_EXPORT_ENABLED).toBe(true);
    expect(cfg.EXCEL_EXPORT_TICK_MIN).toBe(10);
    expect(cfg.EXCEL_EXPORT_LOOKAHEAD_DAYS).toBe(30);
    expect(cfg.BACKUP_AUTO_ENABLED).toBe(true);
    expect(cfg.BACKUP_VERIFY_ENABLED).toBe(true);
    expect(cfg.AUTO_RESTART_ENABLED).toBe(false);
  });
});

describe('moduli export Excel — significati', () => {
  const exporter = require('../../services/excelExporter');
  const scheduler = require('../../services/excelExportScheduler');

  it('default: disabilitato, lookahead 30, tick non esposto da disabilitato', () => {
    cleanEnv();
    expect(exporter.isEnabled()).toBe(false);
    expect(exporter.getStatus().lookaheadDays).toBe(30);
    expect(scheduler.getStatus().intervalMs).toBeNull();
  });

  it('abilitato: tick 10 min di default, valori espliciti rispettati', () => {
    cleanEnv({ EXCEL_EXPORT_ENABLED: 'true' });
    expect(exporter.isEnabled()).toBe(true);
    expect(scheduler.getStatus().intervalMs).toBe(10 * 60 * 1000);
    cleanEnv({
      EXCEL_EXPORT_ENABLED: 'TRUE',
      EXCEL_EXPORT_TICK_MIN: '5',
      EXCEL_EXPORT_LOOKAHEAD_DAYS: '90',
    });
    expect(exporter.isEnabled()).toBe(true);
    expect(exporter.getStatus().lookaheadDays).toBe(90);
    expect(scheduler.getStatus().intervalMs).toBe(5 * 60 * 1000);
  });

  it('EXCEL_EXPORT_ENABLED=1 ora abilita (prima disabilitava in silenzio)', () => {
    cleanEnv({ EXCEL_EXPORT_ENABLED: '1' });
    expect(exporter.isEnabled()).toBe(true);
  });
});
