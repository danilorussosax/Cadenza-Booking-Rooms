'use strict';

/**
 * P2-4 — lib/config.js: validazione + coercizione tipi.
 */

const { reloadConfig, ConfigError } = require('../../lib/config');

const ORIG = { ...process.env };

function setEnv(overrides) {
  // Reset clean per test deterministico
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith('JWT_') ||
      k.startsWith('SESSION_') ||
      k.startsWith('DB_') ||
      k.startsWith('TWO_FA_') ||
      k.startsWith('GDPR_') ||
      k.startsWith('CHECKIN_') ||
      k.startsWith('GHOST_') ||
      k.startsWith('RATE_LIMIT_') ||
      k === 'BCRYPT_COST' ||
      k === 'PORT' ||
      k === 'APP_URL' ||
      k === 'FRONTEND_URL' ||
      k === 'NODE_ENV'
    ) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, overrides);
}

afterEach(() => {
  // Ripristina env originali per non sporcare gli altri test
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG);
});

describe('lib/config', () => {
  it('default development carica i valori standard', () => {
    setEnv({ NODE_ENV: 'development' });
    const cfg = reloadConfig();
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.isProd).toBe(false);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.DB_DIALECT).toBe('sqlite');
    expect(cfg.DB_SYNC_MODE).toBe('safe');
    expect(cfg.JWT_EXPIRES_IN).toBe('2h');
    expect(cfg.GHOST_GRACE_MINUTES).toBe(15);
    expect(cfg.GDPR_AUDIT_LOG_RETENTION_DAYS).toBe(730);
    expect(cfg.JWT_SECRET).toMatch(/dev-jwt-secret/);
  });

  it('production: JWT_SECRET mancante → ConfigError', () => {
    setEnv({ NODE_ENV: 'production' });
    expect(() => reloadConfig()).toThrow(ConfigError);
  });

  it('production: con tutti i secrets → OK', () => {
    setEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-secret-very-long-and-random-12345',
    });
    const cfg = reloadConfig();
    expect(cfg.isProd).toBe(true);
    expect(cfg.JWT_SECRET.length).toBeGreaterThan(20);
  });

  it('PORT non intero → ConfigError', () => {
    setEnv({ NODE_ENV: 'development', PORT: 'abc' });
    expect(() => reloadConfig()).toThrow(/PORT/);
  });

  it('PORT fuori range → ConfigError', () => {
    setEnv({ NODE_ENV: 'development', PORT: '99999' });
    expect(() => reloadConfig()).toThrow(/massimo|65535/);
  });

  it('DB_DIALECT non riconosciuto → ConfigError', () => {
    setEnv({ NODE_ENV: 'development', DB_DIALECT: 'oracle' });
    expect(() => reloadConfig()).toThrow(/DB_DIALECT/);
  });

  it('GDPR_AUDIT_LOG_RETENTION_DAYS sotto minimo → ConfigError', () => {
    setEnv({ NODE_ENV: 'development', GDPR_AUDIT_LOG_RETENTION_DAYS: '5' });
    expect(() => reloadConfig()).toThrow(/minimo 30/);
  });

  it('boolean DB_SEED accetta "true"/"false"', () => {
    setEnv({ NODE_ENV: 'development', DB_SEED: 'true' });
    expect(reloadConfig().DB_SEED).toBe(true);

    setEnv({ NODE_ENV: 'development', DB_SEED: 'false' });
    expect(reloadConfig().DB_SEED).toBe(false);

    setEnv({ NODE_ENV: 'development', DB_SEED: 'pippo' });
    expect(() => reloadConfig()).toThrow(/DB_SEED/);
  });

  it('config è freezato (immutabile)', () => {
    setEnv({ NODE_ENV: 'development' });
    const cfg = reloadConfig();
    expect(() => {
      cfg.PORT = 9999;
    }).toThrow();
  });
});
