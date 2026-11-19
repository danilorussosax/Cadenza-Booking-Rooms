'use strict';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const { createJob } = require('../../lib/jobRunner');

const H = 3600_000;

describe('createJob: gate, errori, ritardo iniziale, schedule dinamico', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('guard asincrono per esecuzione: false salta il run, true lo esegue', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    let leader = false;
    const job = createJob({
      name: 'lease',
      run,
      schedule: { type: 'interval', everyMs: 1000 },
      gate: () => true,
      guard: async () => leader,
    });
    expect(job.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
    leader = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    job.stop();
  });

  it('un run che lancia non ferma il job (intervallo)', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const job = createJob({
      name: 'boom',
      run,
      schedule: { type: 'interval', everyMs: 1000 },
      gate: () => true,
    });
    job.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(job.isActive()).toBe(true);
    job.stop();
  });

  it('un run giornaliero che lancia si riarma comunque', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs.tz('2026-06-10 02:59', 'Europe/Rome').toDate());
    const run = vi.fn(() => {
      throw new Error('boom');
    });
    const job = createJob({
      name: 'boom-daily',
      run,
      schedule: { type: 'daily', hour: 3, tz: 'Europe/Rome' },
      gate: () => true,
    });
    job.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(job.isActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(24 * H);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('initialDelayMs: primo run ritardato; stop lo annulla; start/stop doppi idempotenti', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const onStop = vi.fn();
    const job = createJob({
      name: 'init',
      run,
      schedule: { type: 'interval', everyMs: 10_000, initialDelayMs: 1000 },
      gate: () => true,
      onStop,
    });
    expect(job.start()).toBe(true);
    expect(job.start()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    job.stop();
    job.stop();
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    job.start();
    job.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('schedule come funzione: valutato a ogni armamento; enabled=false non arma', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs.tz('2026-06-10 01:00', 'Europe/Rome').toDate());
    let hour = 3;
    let on = false;
    const job = createJob({
      name: 'dyn',
      run: vi.fn(),
      schedule: () => ({ type: 'daily', hour, tz: 'Europe/Rome' }),
      gate: () => true,
      enabled: () => on,
    });
    expect(job.start()).toBe(false);
    on = true;
    hour = 4;
    expect(job.start()).toBe(true);
    expect(job.msToNext()).toBe(3 * H);
    hour = 5;
    job.reschedule();
    expect(job.msToNext()).toBe(4 * H);
    job.stop();
  });

  it('gate di default: usa clusterRole.isSchedulerMaster', () => {
    vi.useFakeTimers();
    const clusterRole = require('../../lib/clusterRole');
    const spy = vi.spyOn(clusterRole, 'isSchedulerMaster').mockReturnValue(false);
    const job = createJob({
      name: 'm',
      run: vi.fn(),
      schedule: { type: 'interval', everyMs: 1000 },
    });
    expect(job.isGateOpen()).toBe(false);
    expect(job.start()).toBe(false);
    spy.mockReturnValue(true);
    expect(job.start()).toBe(true);
    job.stop();
    spy.mockRestore();
  });
});
