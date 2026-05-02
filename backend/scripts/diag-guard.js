'use strict';
// Verifica che la guardia distruttiva blocchi sync({force:true}) sul DB attuale.
// NON esegue mai il sync — intercetta prima.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
delete process.env.NODE_ENV;
delete process.env.DB_ALLOW_DESTRUCTIVE;

const { sequelize } = require('../models');
(async () => {
  console.log(`Dialect: ${sequelize.getDialect()}, DB: ${sequelize.config.database}`);
  try {
    await sequelize.sync({ force: true });
    console.log('❌ ERRORE: la guardia NON ha bloccato il sync force!');
    process.exit(2);
  } catch (e) {
    if (e.code === 'DESTRUCTIVE_SYNC_BLOCKED') {
      console.log(`✓ Guardia attiva: ${e.message}`);
      process.exit(0);
    }
    console.log(`? Errore inatteso: ${e.message}`);
    process.exit(3);
  }
})();
