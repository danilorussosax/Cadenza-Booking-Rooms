'use strict';

const { Sequelize } = require('sequelize');
const { up } = require('../../lib/bookingOriginMigration');

describe('bookingOriginMigration', () => {
  let sequelize;
  let qi;
  beforeEach(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    qi = sequelize.getQueryInterface();
    await sequelize.query('CREATE TABLE bookings (id INTEGER PRIMARY KEY, userId INTEGER)');
    await sequelize.query(
      'CREATE TABLE monte_ore_slots (id INTEGER PRIMARY KEY, bookingId INTEGER)',
    );
    await sequelize.query(
      'CREATE TABLE monte_ore_schedules (id INTEGER PRIMARY KEY, generatedBookingIds TEXT)',
    );
    for (let id = 1; id <= 5; id += 1) {
      await sequelize.query('INSERT INTO bookings (id, userId) VALUES (:id, 1)', {
        replacements: { id },
      });
    }
    await sequelize.query('INSERT INTO monte_ore_slots (bookingId) VALUES (2), (NULL)');
    await sequelize.query(
      "INSERT INTO monte_ore_schedules (generatedBookingIds) VALUES ('[3,4]'), (NULL), ('non-json')",
    );
  });
  afterEach(async () => {
    await sequelize.close();
  });

  const origins = async () => {
    const [rows] = await sequelize.query('SELECT id, origin FROM bookings ORDER BY id');
    return Object.fromEntries(rows.map((r) => [r.id, r.origin]));
  };

  it('aggiunge la colonna e marca come monte_ore le prenotazioni collegate', async () => {
    await up(qi);
    expect(await origins()).toEqual({
      1: 'manual',
      2: 'monte_ore',
      3: 'monte_ore',
      4: 'monte_ore',
      5: 'manual',
    });
  });

  it('è idempotente: una seconda esecuzione non tocca i dati', async () => {
    await up(qi);
    await sequelize.query("UPDATE bookings SET origin = 'manual' WHERE id = 2");
    await up(qi);
    expect((await origins())[2]).toBe('manual');
  });

  it('non fa nulla se la tabella bookings non esiste', async () => {
    await sequelize.query('DROP TABLE bookings');
    await expect(up(qi)).resolves.toBeUndefined();
  });
});
