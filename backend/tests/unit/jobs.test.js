'use strict';

const { createRegistry, DEFAULT_ENTRIES } = require('../../services/jobs');

describe('registro scheduler (services/jobs)', () => {
  it('startAll/stopAll chiamano ogni voce nell ordine; errori di start non propagano', async () => {
    const calls = [];
    const mk = (name, startImpl) => ({
      name,
      load: () => ({
        start: () => {
          calls.push(`start:${name}`);
          return startImpl?.();
        },
        stop: () => calls.push(`stop:${name}`),
      }),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reg = createRegistry([
      mk('a'),
      mk('b', () => Promise.reject(new Error('x'))),
      mk('c', () => {
        throw new Error('sync');
      }),
      mk('d'),
    ]);
    reg.startAll();
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual(['start:a', 'start:b', 'start:c', 'start:d']);
    expect(errSpy).toHaveBeenCalledTimes(2);

    reg.stopAll();
    reg.stopAll(); // idempotente
    expect(calls.filter((c) => c.startsWith('stop:'))).toEqual([
      'stop:a',
      'stop:b',
      'stop:c',
      'stop:d',
      'stop:a',
      'stop:b',
      'stop:c',
      'stop:d',
    ]);
    errSpy.mockRestore();
  });

  it('stopAll ferma tutti anche se uno lancia, poi rilancia il primo errore', () => {
    const stopped = [];
    const reg = createRegistry([
      { name: 'a', load: () => ({ start() {}, stop: () => stopped.push('a') }) },
      {
        name: 'b',
        load: () => ({
          start() {},
          stop: () => {
            throw new Error('stop b');
          },
        }),
      },
      { name: 'c', load: () => ({ start() {}, stop: () => stopped.push('c') }) },
    ]);
    expect(() => reg.stopAll()).toThrow('stop b');
    expect(stopped).toEqual(['a', 'c']);
  });

  it('elenco di default: i sei scheduler, tutti con start/stop/getStatus', () => {
    expect(DEFAULT_ENTRIES.map((e) => e.name)).toEqual([
      'reminder',
      'retention',
      'mailOutbox',
      'backup',
      'excelExport',
      'backupVerify',
    ]);
    for (const e of DEFAULT_ENTRIES) {
      const m = e.load();
      expect(typeof m.start).toBe('function');
      expect(typeof m.stop).toBe('function');
      expect(typeof m.getStatus).toBe('function');
    }
  });
});
