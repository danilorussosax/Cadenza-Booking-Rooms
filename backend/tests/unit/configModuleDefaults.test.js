'use strict';

/**
 * Fotografia dei default effettivi esposti dai moduli consumatori (valori
 * letti all'import). Deve restare identica prima e dopo il consolidamento
 * in lib/config.js.
 */

const ORIG_ENV = { ...process.env };
for (const k of [
  'LOCKOUT_MAX_FAILED',
  'LOCKOUT_DURATION_MIN',
  'WAITLIST_CLAIM_MINUTES',
  'TWO_FA_TTL_MIN',
  'TWO_FA_MAX_ATTEMPTS',
  'MESSAGING_RATE_PER_MIN',
  'MESSAGING_RATE_PER_DAY',
  'MESSAGING_COOLDOWN_MS',
  'MESSAGING_RATE_ENTRY_TTL_MS',
  'MESSAGING_SESSION_TTL_MIN',
]) {
  delete process.env[k];
}

afterAll(() => {
  Object.assign(process.env, ORIG_ENV);
});

describe('default effettivi dei moduli', () => {
  it('authSession', () => {
    const m = require('../../services/authSession');
    expect(m.LOCKOUT_MAX_FAILED).toBe(10);
    expect(m.LOCKOUT_DURATION_MIN).toBe(30);
  });
  it('twoFa', () => {
    const m = require('../../services/twoFa');
    expect(m.TWO_FA_TTL_MIN).toBe(10);
    expect(m.TWO_FA_MAX_ATTEMPTS).toBe(5);
  });
  it('waitlistService', () => {
    expect(require('../../services/waitlistService').CLAIM_WINDOW_MINUTES).toBe(30);
  });
  it('messaging/rateLimit e state', () => {
    const r = require('../../services/messaging/rateLimit');
    expect(r.PER_MIN).toBe(30);
    expect(r.PER_DAY).toBe(200);
    expect(r.COOLDOWN_MS).toBe(3600000);
    expect(r.ENTRY_TTL_MS).toBe(86400000);
    expect(require('../../services/messaging/state').SESSION_TTL_MIN).toBe(15);
  });
});
