'use strict';

// Additive, repeatable migration: Booking.origin ('manual' | 'monte_ore').
// Sulle installazioni esistenti marca come 'monte_ore' le prenotazioni già
// generate dal monte ore (collegate a uno slot o a una riga schedule).
const { DataTypes } = require('sequelize');

async function up(qi, transaction = null) {
  if (!transaction && qi.sequelize.getDialect() === 'postgres') {
    return qi.sequelize.transaction(async (t) => {
      await qi.sequelize.query('SELECT pg_advisory_xact_lock(170022)', { transaction: t });
      return up(qi, t);
    });
  }
  const tables = (await qi.showAllTables({ transaction })).map((t) =>
    typeof t === 'string' ? t : t.tableName,
  );
  if (!tables.includes('bookings')) return;
  const columns = await qi.describeTable('bookings', { transaction });
  if (columns.origin) return;

  await qi.addColumn(
    'bookings',
    'origin',
    { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'manual' },
    { transaction },
  );

  const ids = new Set();
  if (tables.includes('monte_ore_slots')) {
    const [rows] = await qi.sequelize.query(
      'SELECT "bookingId" FROM "monte_ore_slots" WHERE "bookingId" IS NOT NULL',
      { transaction },
    );
    for (const r of rows) ids.add(Number(r.bookingId));
  }
  if (tables.includes('monte_ore_schedules')) {
    const [rows] = await qi.sequelize.query(
      'SELECT "generatedBookingIds" FROM "monte_ore_schedules" WHERE "generatedBookingIds" IS NOT NULL',
      { transaction },
    );
    for (const r of rows) {
      let list = r.generatedBookingIds;
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch {
          list = [];
        }
      }
      if (Array.isArray(list)) for (const id of list) ids.add(Number(id));
    }
  }
  const all = [...ids].filter(Number.isInteger);
  for (let i = 0; i < all.length; i += 500) {
    await qi.sequelize.query(
      'UPDATE "bookings" SET "origin" = \'monte_ore\' WHERE "id" IN (:ids)',
      {
        replacements: { ids: all.slice(i, i + 500) },
        transaction,
      },
    );
  }
}

module.exports = { up };
