'use strict';

/**
 * Integrazione: rete di sicurezza DB-level su `bookings`.
 *
 * Verifica che `bookings_no_overlap` (EXCLUDE GiST + tsrange) impedisca
 * a due booking confermate sulla stessa room di sovrapporsi nel tempo,
 * anche bypassando il validator applicativo (`Booking.create()` diretto).
 *
 * Postgres-only — la suite di default gira su SQLite in-memory che non
 * supporta EXCLUDE. Per eseguire questo test, configura una DB Postgres
 * di test (es. via docker) e imposta le env prima di lanciare vitest:
 *
 *   DB_DIALECT=postgres \
 *   DB_HOST=localhost DB_PORT=5432 \
 *   DB_NAME=aulabook_test DB_USER=aulabook DB_PASSWORD=... \
 *   DB_SSL=false \
 *   npx vitest run tests/integration/excludeConstraint.test.js
 *
 * Quando DB_DIALECT non è 'postgres', l'intera describe è skippata.
 */

const dayjs = require('dayjs');
const { sequelize, Booking } = require('../../models');
const { ensureBookingsNoOverlapConstraint } = require('../../lib/preSyncMigrations');
const { mapSequelizeError } = require('../../lib/dbErrors');
const { createUser, createRoom } = require('../factories');

const isPostgres = sequelize.getDialect() === 'postgres';

(isPostgres ? describe : describe.skip)(
  'EXCLUDE constraint bookings_no_overlap (Postgres only)',
  () => {
    beforeAll(async () => {
      // Ricrea schema + constraint sull'istanza di test.
      // resetDatabase() del setup ricrea le tabelle ad ogni beforeEach,
      // quindi qui basta reinstallare la constraint dopo il sync.
      await sequelize.sync({ force: true });
      await ensureBookingsNoOverlapConstraint();
    });

    beforeEach(async () => {
      await globalThis.resetDatabase();
      await ensureBookingsNoOverlapConstraint();
    });

    it("rifiuta una booking confermata che si sovrappone a un'altra (stessa room)", async () => {
      const room = await createRoom();
      const userA = await createUser();
      const userB = await createUser();

      const start = dayjs().add(1, 'day').startOf('hour').toDate();
      const end = dayjs(start).add(1, 'hour').toDate();

      // Prima booking: OK
      await Booking.create({
        userId: userA.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });

      // Seconda booking sovrapposta: deve fallire al DB-level.
      let caught;
      try {
        await Booking.create({
          userId: userB.id,
          roomId: room.id,
          startTime: dayjs(start).add(15, 'minute').toDate(),
          endTime: dayjs(end).add(15, 'minute').toDate(),
          type: 'studio_individuale',
          status: 'confirmed',
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      const mapped = mapSequelizeError(caught);
      expect(mapped).toBeTruthy();
      expect(mapped.status).toBe(409);
      expect(mapped.code).toBe('EXCLUSION_VIOLATION');
      expect(mapped.constraint).toBe('bookings_no_overlap');
    });

    it('permette overlapping su room DIFFERENTI', async () => {
      const r1 = await createRoom();
      const r2 = await createRoom();
      const u = await createUser();
      const start = dayjs().add(1, 'day').startOf('hour').toDate();
      const end = dayjs(start).add(1, 'hour').toDate();

      await Booking.create({
        userId: u.id,
        roomId: r1.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });
      // Stesso slot ma altra room → ammesso
      await Booking.create({
        userId: u.id,
        roomId: r2.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });
    });

    it('permette overlapping se una delle due NON è confirmed', async () => {
      const room = await createRoom();
      const u = await createUser();
      const start = dayjs().add(1, 'day').startOf('hour').toDate();
      const end = dayjs(start).add(1, 'hour').toDate();

      await Booking.create({
        userId: u.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'cancelled',
      });
      // Stessa room + stesso slot, ma la prima è cancelled → la WHERE
      // della constraint la esclude → la nuova confirmed passa.
      await Booking.create({
        userId: u.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });
    });

    it('permette riprenotare slot dopo soft-delete della precedente', async () => {
      const room = await createRoom();
      const u = await createUser();
      const start = dayjs().add(1, 'day').startOf('hour').toDate();
      const end = dayjs(start).add(1, 'hour').toDate();

      const b = await Booking.create({
        userId: u.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });
      // Soft-delete (paranoid) — deletedAt valorizzato → fuori dalla WHERE.
      await b.destroy();

      // Nuova booking sullo stesso slot: deve passare.
      await Booking.create({
        userId: u.id,
        roomId: room.id,
        startTime: start,
        endTime: end,
        type: 'studio_individuale',
        status: 'confirmed',
      });
    });
  },
);
