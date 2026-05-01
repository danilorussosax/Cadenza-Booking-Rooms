'use strict';

/**
 * P1-6 — Booking afterUpdate/afterDestroy hook devono usare
 * `transaction.afterCommit()` per non emettere notifiche waitlist quando
 * la transazione fa rollback.
 *
 * Verifica:
 *   - cancel SENZA transazione → notifyNextOnSlot chiamato (sync)
 *   - cancel DENTRO tx con commit → notifyNextOnSlot chiamato (afterCommit)
 *   - cancel DENTRO tx con rollback → notifyNextOnSlot NON chiamato
 *
 * vi.spyOn intercetta il metodo esportato da waitlistService. Il dispatcher
 * nel hook fa lazy require, quindi sostituire .notifyNextOnSlot sull'oggetto
 * exports è sufficiente per essere visto dal hook.
 */

// vitest globals abilitati in vitest.config.js (vi è disponibile globalmente)
const { sequelize, Booking } = require('../../models');
const waitlistService = require('../../services/waitlistService');
const { createAuthedUser, createBooking, createRoom } = require('../factories');

describe('Booking hooks — afterCommit (P1-6)', () => {
  let spy;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    spy = vi.spyOn(waitlistService, 'notifyNextOnSlot').mockResolvedValue(undefined);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('cancel SENZA tx: notifyNextOnSlot chiamato', async () => {
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente' });
    const b = await createBooking({ user, room, status: 'confirmed' });

    await b.update({ status: 'cancelled' });
    // Lascia spazio al fire-and-forget
    await new Promise((r) => setTimeout(r, 30));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ roomId: room.id }));
  });

  it('cancel DENTRO tx con COMMIT: notifyNextOnSlot chiamato dopo commit', async () => {
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente' });
    const b = await createBooking({ user, room, status: 'confirmed' });

    await sequelize.transaction(async (t) => {
      await b.update({ status: 'cancelled' }, { transaction: t });
      // Dentro la tx, lo spy NON deve essere ancora stato chiamato
      expect(spy).toHaveBeenCalledTimes(0);
    });

    // Dopo il commit lo dispatch parte (afterCommit + microtask)
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancel DENTRO tx con ROLLBACK: notifyNextOnSlot NON chiamato', async () => {
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente' });
    const b = await createBooking({ user, room, status: 'confirmed' });

    let caught = false;
    try {
      await sequelize.transaction(async (t) => {
        await b.update({ status: 'cancelled' }, { transaction: t });
        // Forziamo rollback con un throw esplicito
        throw new Error('simulated business rule violation');
      });
    } catch (err) {
      caught = err.message.includes('simulated');
    }
    expect(caught).toBe(true);

    // Aspetta un po' per assicurarsi che NON parta una notifica deferita
    await new Promise((r) => setTimeout(r, 50));

    expect(spy).toHaveBeenCalledTimes(0);

    // Verifica che lo stato in DB sia rimasto 'confirmed' (rollback OK)
    const refreshed = await Booking.findByPk(b.id);
    expect(refreshed.status).toBe('confirmed');
  });

  it('update senza cambio status: hook NON triggera waitlist', async () => {
    const room = await createRoom();
    const { user } = await createAuthedUser({ role: 'docente' });
    const b = await createBooking({ user, room, status: 'confirmed' });

    await b.update({ purpose: 'cambio descrizione' });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
