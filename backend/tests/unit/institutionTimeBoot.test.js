'use strict';

const institutionTime = require('../../lib/institutionTime');
const { configureFromInstitute } = require('../../lib/institutionTimeBoot');

const fakeInstitute = (row) => ({ findOne: vi.fn().mockResolvedValue(row) });
const mkLogger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('configureFromInstitute', () => {
  const original = institutionTime.getTimezone();
  const originalEnv = process.env.INSTITUTION_TZ;

  afterEach(() => {
    institutionTime.configure({ timezone: original });
    if (originalEnv === undefined) delete process.env.INSTITUTION_TZ;
    else process.env.INSTITUTION_TZ = originalEnv;
  });

  it('fuso valido: viene applicato', async () => {
    const logger = mkLogger();
    const tz = await configureFromInstitute({
      Institute: fakeInstitute({ timezone: 'America/New_York' }),
      logger,
    });
    expect(tz).toBe('America/New_York');
    expect(institutionTime.getTimezone()).toBe('America/New_York');
    expect(logger.info).toHaveBeenCalled();
  });

  it('riga assente: fuso invariato', async () => {
    const tz = await configureFromInstitute({ Institute: fakeInstitute(null) });
    expect(tz).toBe(original);
  });

  it('valore vuoto: fuso invariato', async () => {
    const tz = await configureFromInstitute({ Institute: fakeInstitute({ timezone: '  ' }) });
    expect(tz).toBe(original);
    expect(await configureFromInstitute({ Institute: fakeInstitute({ timezone: null }) })).toBe(
      original,
    );
  });

  it('valore non valido: fuso invariato e warning', async () => {
    const logger = mkLogger();
    const tz = await configureFromInstitute({
      Institute: fakeInstitute({ timezone: 'Mars/Olympus' }),
      logger,
    });
    expect(tz).toBe(original);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('errore DB: non solleva, fuso invariato', async () => {
    const Institute = { findOne: vi.fn().mockRejectedValue(new Error('no table')) };
    const logger = mkLogger();
    expect(await configureFromInstitute({ Institute, logger })).toBe(original);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('il default del model non sovrascrive INSTITUTION_TZ esplicita', async () => {
    process.env.INSTITUTION_TZ = 'Europe/Berlin';
    institutionTime.configure({ timezone: 'Europe/Berlin' });
    const tz = await configureFromInstitute({
      Institute: fakeInstitute({ timezone: 'Europe/Rome' }),
    });
    expect(tz).toBe('Europe/Berlin');
  });

  it('dopo configure() le letture pigre dei moduli cambiano fuso', async () => {
    const retention = require('../../services/retentionScheduler');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-07-01T00:00:00Z'));
      const nextTick = () => {
        retention.start();
        const at = new Date(retention.getStatus().nextTickAt).toISOString();
        retention.stop();
        return at;
      };
      // 03:00 locali: Europe/Rome (CEST) = 01:00Z; UTC = 03:00Z.
      institutionTime.configure({ timezone: 'Europe/Rome' });
      expect(nextTick()).toBe('2025-07-01T01:00:00.000Z');
      await configureFromInstitute({ Institute: fakeInstitute({ timezone: 'UTC' }) });
      expect(nextTick()).toBe('2025-07-01T03:00:00.000Z');
    } finally {
      retention.stop();
      vi.useRealTimers();
    }
  });
});
