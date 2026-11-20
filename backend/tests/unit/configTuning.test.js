'use strict';

/**
 * lib/config.js — chiavi di tuning.
 *
 * Politica unica: variabile assente o vuota → default; presente ma non valida
 * (non numerica, fuori da min/max, durata malformata) → ConfigError. Mai
 * ripiego silenzioso.
 *
 * La tabella NUMERIC contiene la fotografia dei valori effettivi di default
 * PRIMA del consolidamento (letti dai moduli che avevano la propria lettura di
 * process.env): deve restare identica, in produzione e in test.
 */

const { reloadConfig, getConfig, ConfigError } = require('../../lib/config');

const ORIG = { ...process.env };

// [chiave, default produzione, default test, min, max]
const NUMERIC = [
  ['TWO_FA_GRACE_DAYS', 7, 7, 0, 90],
  ['GDPR_AUDIT_LOG_RETENTION_DAYS', 730, 730, 30, 3650],
  ['MAIL_OUTBOX_RETENTION_DAYS', 30, 30, 1, 3650],
  ['PRE_RESTORE_RETENTION_DAYS', 7, 7, 1, 3650],
  ['CHECKIN_EARLY_MINUTES', 5, 5, 0, 60],
  ['GHOST_GRACE_MINUTES', 15, 15, 1, 120],
  ['RATE_LIMIT_API_PER_MIN', 300, 300, 10, 10000],
  ['BCRYPT_COST', 12, 4, 4, 15],
  ['LOCKOUT_MAX_FAILED', 10, 10, 1, 1000],
  ['LOCKOUT_DURATION_MIN', 30, 30, 1, 10080],
  ['WAITLIST_CLAIM_MINUTES', 30, 30, 5, 1440],
  ['TWO_FA_TTL_MIN', 10, 10, 1, 1440],
  ['TWO_FA_MAX_ATTEMPTS', 5, 5, 1, 100],
  ['MESSAGING_RATE_PER_MIN', 30, 30, 1, 10000],
  ['MESSAGING_RATE_PER_DAY', 200, 200, 1, 1000000],
  ['MESSAGING_COOLDOWN_MS', 3600000, 3600000, 1, 2147483647],
  ['MESSAGING_RATE_SWEEP_MS', 1800000, 1800000, 1, 2147483647],
  ['MESSAGING_RATE_ENTRY_TTL_MS', 86400000, 86400000, 1, 2147483647],
  ['MESSAGING_OTP_SCAN_CAP', 100, 100, 1, 10000],
  ['MESSAGING_SESSION_TTL_MIN', 15, 15, 1, 1440],
];

const TUNING_NAMES = [...NUMERIC.map((r) => r[0]), 'JWT_EXPIRES_IN', 'TWO_FA_ISSUER'];

function cleanEnv(overrides = {}) {
  for (const k of [...TUNING_NAMES, 'NODE_ENV', 'JWT_SECRET']) delete process.env[k];
  Object.assign(process.env, overrides);
}

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG);
  reloadConfig();
});

describe('config tuning — fotografia dei default effettivi', () => {
  it.each(NUMERIC)('%s: default produzione %s / test %s', (key, prod, test) => {
    cleanEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) });
    expect(reloadConfig()[key]).toBe(prod);
    cleanEnv({ NODE_ENV: 'test' });
    expect(reloadConfig()[key]).toBe(test);
  });

  it('JWT_EXPIRES_IN e TWO_FA_ISSUER: default', () => {
    cleanEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) });
    const cfg = reloadConfig();
    expect(cfg.JWT_EXPIRES_IN).toBe('2h');
    expect(cfg.TWO_FA_ISSUER).toBe('Cadenza');
  });

  it('JWT_EXPIRES_IN=2h (valore di produzione) è accettato così com’è', () => {
    cleanEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), JWT_EXPIRES_IN: '2h' });
    expect(reloadConfig().JWT_EXPIRES_IN).toBe('2h');
  });

  it('variabile vuota → default', () => {
    cleanEnv({ NODE_ENV: 'test', BCRYPT_COST: '', JWT_EXPIRES_IN: '' });
    const cfg = reloadConfig();
    expect(cfg.BCRYPT_COST).toBe(4);
    expect(cfg.JWT_EXPIRES_IN).toBe('2h');
  });
});

describe('config tuning — valori validi e non validi', () => {
  describe.each(NUMERIC)('%s', (key, _p, _t, min, max) => {
    it('accetta i limiti min e max', () => {
      cleanEnv({ NODE_ENV: 'test', [key]: String(min) });
      expect(reloadConfig()[key]).toBe(min);
      cleanEnv({ NODE_ENV: 'test', [key]: String(max) });
      expect(reloadConfig()[key]).toBe(max);
    });

    it('non numerico → ConfigError', () => {
      cleanEnv({ NODE_ENV: 'test', [key]: 'abc' });
      expect(() => reloadConfig()).toThrow(ConfigError);
      expect(() => reloadConfig()).toThrow(key);
    });

    it('sotto il minimo → ConfigError', () => {
      cleanEnv({ NODE_ENV: 'test', [key]: String(min - 1) });
      expect(() => reloadConfig()).toThrow(ConfigError);
    });

    it('sopra il massimo → ConfigError', () => {
      cleanEnv({ NODE_ENV: 'test', [key]: String(max + 1) });
      expect(() => reloadConfig()).toThrow(ConfigError);
    });
  });

  it.each(['30m', '1d', '2 hours', '3600', '12h', '1.5h'])('JWT_EXPIRES_IN=%s valido', (v) => {
    cleanEnv({ NODE_ENV: 'test', JWT_EXPIRES_IN: v });
    expect(reloadConfig().JWT_EXPIRES_IN).toBe(v);
  });

  it.each(['abc', '2 fortnights', '-1h', 'h2'])('JWT_EXPIRES_IN=%s → ConfigError', (v) => {
    cleanEnv({ NODE_ENV: 'test', JWT_EXPIRES_IN: v });
    expect(() => reloadConfig()).toThrow(ConfigError);
  });

  it('TWO_FA_ISSUER personalizzato', () => {
    cleanEnv({ NODE_ENV: 'test', TWO_FA_ISSUER: 'Conservatorio' });
    expect(reloadConfig().TWO_FA_ISSUER).toBe('Conservatorio');
  });

  it('getConfig() riflette le modifiche a runtime dell’env (semantica lazy)', () => {
    cleanEnv({ NODE_ENV: 'test' });
    reloadConfig();
    expect(getConfig().GDPR_AUDIT_LOG_RETENTION_DAYS).toBe(730);
    process.env.GDPR_AUDIT_LOG_RETENTION_DAYS = '30';
    expect(getConfig().GDPR_AUDIT_LOG_RETENTION_DAYS).toBe(30);
    process.env.GDPR_AUDIT_LOG_RETENTION_DAYS = '5';
    expect(() => getConfig()).toThrow(ConfigError);
  });
});
