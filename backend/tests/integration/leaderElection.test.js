'use strict';

/**
 * Integration test su LeaderLease (lib/leaderElection.js).
 *
 * Verifica:
 *   1. Prima istanza vince il lease via INSERT
 *   2. Seconda istanza con lo stesso `name` NON vince finché il primo
 *      non rilascia
 *   3. Dopo release(), un'altra istanza prende il lease
 *   4. Se il lease scade (leaseUntil < now), un'altra istanza fa takeover
 *   5. renew() riporta true finché siamo holder, false se perdiamo il lease
 */

const { describe, it, expect, beforeEach } = globalThis;
const { LeaderLease } = require('../../lib/leaderElection');
const { SchedulerLease } = require('../../models');

describe('LeaderLease', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('prima istanza vince il lease (path INSERT)', async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 5_000 });
    a.holderId = 'instance-A';

    const ok = await a.acquire();
    expect(ok).toBe(true);
    expect(a.isLeader()).toBe(true);

    const row = await SchedulerLease.findByPk('demo');
    expect(row).not.toBeNull();
    expect(row.holderId).toBe('instance-A');
  });

  it('seconda istanza NON vince mentre la prima è viva', async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    a.holderId = 'instance-A';
    await a.acquire();

    const b = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    b.holderId = 'instance-B';
    const ok = await b.acquire();
    expect(ok).toBe(false);
    expect(b.isLeader()).toBe(false);
  });

  it("dopo release(), un'altra istanza prende il lease", async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    a.holderId = 'instance-A';
    await a.acquire();
    await a.release('test');
    expect(a.isLeader()).toBe(false);

    const b = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    b.holderId = 'instance-B';
    const ok = await b.acquire();
    expect(ok).toBe(true);
    expect(b.isLeader()).toBe(true);

    const row = await SchedulerLease.findByPk('demo');
    expect(row.holderId).toBe('instance-B');
  });

  it('lease scaduto: altro istanza fa takeover via UPDATE atomico', async () => {
    // Simuliamo un lease scaduto scrivendo direttamente in DB con
    // leaseUntil nel passato.
    await SchedulerLease.create({
      name: 'demo',
      holderId: 'dead-instance',
      acquiredAt: new Date(Date.now() - 60_000),
      renewedAt: new Date(Date.now() - 60_000),
      leaseUntil: new Date(Date.now() - 1_000), // già scaduto
    });

    const b = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    b.holderId = 'instance-B';
    const ok = await b.acquire();
    expect(ok).toBe(true);

    const row = await SchedulerLease.findByPk('demo');
    expect(row.holderId).toBe('instance-B');
    expect(row.leaseUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('renew() ritorna true finché siamo holder', async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    a.holderId = 'instance-A';
    await a.acquire();
    expect(await a.renew()).toBe(true);
    expect(a.isLeader()).toBe(true);
  });

  it('renew() ritorna false se perdiamo il lease (altro holder)', async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    a.holderId = 'instance-A';
    await a.acquire();

    // Simuliamo che un'altra istanza ci abbia rubato il lease (es. dopo
    // restart con clock skew). Cambiamo holderId in DB.
    await SchedulerLease.update({ holderId: 'instance-B' }, { where: { name: 'demo' } });

    const ok = await a.renew();
    expect(ok).toBe(false);
    expect(a.isLeader()).toBe(false);
  });

  it('acquire() di nuovo dopo renew=false: re-prende il lease se lo trova libero', async () => {
    const a = new LeaderLease({ name: 'demo', ttlMs: 60_000 });
    a.holderId = 'instance-A';
    await a.acquire();

    // B ruba il lease
    await SchedulerLease.update({ holderId: 'instance-B' }, { where: { name: 'demo' } });
    expect(await a.renew()).toBe(false);

    // Ora B rilascia (simuliamo scadenza)
    await SchedulerLease.update(
      { holderId: '', leaseUntil: new Date(0) },
      { where: { name: 'demo' } },
    );

    const ok = await a.acquire();
    expect(ok).toBe(true);
    expect(a.isLeader()).toBe(true);
  });
});
