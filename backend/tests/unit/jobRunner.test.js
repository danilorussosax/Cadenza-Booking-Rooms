'use strict';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const { createJob, msUntilNextRun } = require('../../lib/jobRunner');

const H = 3600_000;

describe('msUntilNextRun', () => {
  it('oggi se l orario non e passato', () => {
    const now = dayjs.tz('2026-06-10 01:00', 'Europe/Rome');
    expect(msUntilNextRun({ hour: 3 }, now)).toBe(2 * H);
  });

  it('domani se l orario e passato o uguale', () => {
    const now = dayjs.tz('2026-06-10 03:00', 'Europe/Rome');
    expect(msUntilNextRun({ hour: 3 }, now)).toBe(24 * H);
  });

  it('giorno di cambio ora legale (primavera): 03:00 locali, giornata di 23h', () => {
    // 2026-03-29: 02:00 -> 03:00. Da 00:30 locali a 03:00 locali passano 1.5h reali.
    const now = dayjs.tz('2026-03-29 00:30', 'Europe/Rome');
    expect(msUntilNextRun({ hour: 3 }, now)).toBe(1.5 * H);
    // Da 03:00 del 28 a 03:00 del 29: 23h
    const prev = dayjs.tz('2026-03-28 03:00', 'Europe/Rome');
    expect(msUntilNextRun({ hour: 3 }, prev)).toBe(23 * H);
  });

  it('giorno di cambio ora legale (autunno): giornata di 25h', () => {
    // 2026-10-25: 03:00 -> 02:00.
    const prev = dayjs.tz('2026-10-24 03:00', 'Europe/Rome');
    expect(msUntilNextRun({ hour: 3 }, prev)).toBe(25 * H);
  });

  it('settimanale: prossimo giorno della settimana alle HH:MM', () => {
    // 2026-06-10 e un mercoledi (3). Target domenica (0) 04:30.
    const now = dayjs.tz('2026-06-10 12:00', 'Europe/Rome');
    const ms = msUntilNextRun({ dayOfWeek: 0, hour: 4, minute: 30 }, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(7 * 24 * H);
    expect(dayjs(now).add(ms, 'ms').tz('Europe/Rome').format('ddd HH:mm')).toBe('Sun 04:30');
  });
});

describe('createJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gate inattivo: non parte', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const job = createJob({
      name: 't',
      run,
      schedule: { type: 'interval', everyMs: 1000 },
      gate: () => false,
    });
    expect(job.start()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    expect(job.isActive()).toBe(false);
  });

  it('intervallo: esegue a ogni periodo, stop idempotente, doppio start idempotente', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const job = createJob({
      name: 't',
      run,
      schedule: { type: 'interval', everyMs: 1000 },
      gate: () => true,
    });
    expect(job.start()).toBe(true);
    expect(job.start()).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);
    job.stop();
    job.stop();
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(job.isActive()).toBe(false);
  });

  it('giornaliero: scatta alle HH:MM e si riarma', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs.tz('2026-06-10 01:00', 'Europe/Rome').toDate());
    const run = vi.fn();
    const job = createJob({
      name: 't',
      run,
      schedule: { type: 'daily', hour: 3, tz: 'Europe/Rome' },
      gate: () => true,
    });
    job.start();
    await vi.advanceTimersByTimeAsync(2 * H - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * H);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
    await vi.advanceTimersByTimeAsync(48 * H);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('giornaliero attraverso il cambio ora legale: resta alle 03:00 locali', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs.tz('2026-03-28 03:00:01', 'Europe/Rome').toDate());
    const times = [];
    const job = createJob({
      name: 't',
      run: () => {
        times.push(dayjs().tz('Europe/Rome').format('MM-DD HH:mm'));
      },
      schedule: { type: 'daily', hour: 3, tz: 'Europe/Rome' },
      gate: () => true,
    });
    job.start();
    await vi.advanceTimersByTimeAsync(3 * 24 * H);
    job.stop();
    expect(times.slice(0, 3)).toEqual(['03-29 03:00', '03-30 03:00', '03-31 03:00']);
  });

  it('reschedule chiamato dal corpo non duplica il timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs.tz('2026-06-10 02:59', 'Europe/Rome').toDate());
    const run = vi.fn(() => job.reschedule());
    const job = createJob({
      name: 't',
      run,
      schedule: { type: 'daily', hour: 3, tz: 'Europe/Rome' },
      gate: () => true,
    });
    job.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    job.stop();
  });
});
