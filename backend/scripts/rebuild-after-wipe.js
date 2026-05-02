'use strict';
/**
 * Rebuild post-wipe (28 apr 2026):
 *   1. Cancella i 4 record fixture residui (user4@test.invalid, "Conservatorio 1", ecc.)
 *      lasciati nel DB Postgres dallo script di debug che ha causato il wipe.
 *   2. Esegue il seeder dell'app (`seeders/initial.js`) che crea admin di
 *      default + livelli + regole di booking.
 *
 * Idempotente: se non c'è nulla da cancellare, salta la fase 1.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const m = require('../models');
  const { sequelize } = m;

  console.log(`# DB target: ${sequelize.config.database} (${sequelize.getDialect()})`);

  // ======== Sanity check: NON eseguire sul DB sbagliato ========
  if (sequelize.config.database !== 'aulabook') {
    console.error(`✗ DB inatteso "${sequelize.config.database}", abort`);
    process.exit(2);
  }

  // ======== 1. Cancella i fixture residui ========
  console.log('\n--- Cleanup fixture residui ---');

  // Cerco user con email pattern test.invalid (factory pattern)
  const testUsers = await m.User.findAll({
    where: { email: { [require('sequelize').Op.like]: '%test.invalid' } },
    paranoid: false,
  });
  if (testUsers.length) {
    for (const u of testUsers) {
      console.log(`  DELETE user ${u.id} ${u.email}`);
      await u.destroy({ force: true });
    }
  } else {
    console.log('  (nessun user fixture)');
  }

  // Monte Ore proposals senza user valido
  const orphanProps = await m.MonteOreProposal.findAll();
  for (const p of orphanProps) {
    const u = await m.User.findByPk(p.userId);
    if (!u) {
      console.log(`  DELETE MonteOreProposal ${p.id} (user orfano)`);
      await p.destroy({ force: true });
    }
  }

  // Institute con nome di test (factory pattern: "Conservatorio N")
  const testInst = await m.Institute.findAll({
    where: { name: { [require('sequelize').Op.like]: 'Conservatorio %' } },
  });
  // Cancello solo se name finisce con un numero (factory pattern)
  for (const i of testInst) {
    if (/^Conservatorio \d+$/.test(i.name)) {
      console.log(`  DELETE Institute ${i.id} "${i.name}" (CASCADE su building/room)`);
      await i.destroy({ force: true });
    }
  }

  // ======== 2. Riepilogo stato post-cleanup ========
  console.log('\n--- Stato post-cleanup ---');
  const tables = [
    'User',
    'Institute',
    'Building',
    'Room',
    'Course',
    'CourseLevel',
    'BookingRule',
    'MonteOreProposal',
  ];
  for (const t of tables) {
    const c = await m[t].count();
    console.log(`  ${t.padEnd(20)} ${c}`);
  }

  // ======== 3. Esegui seeder ========
  console.log('\n--- Esecuzione seeder iniziale ---');
  // Il seeder leggerà DEFAULT_ADMIN_* da env; se non settati usa default.
  await require('../seeders/initial')();

  // ======== 4. Riepilogo finale ========
  console.log('\n--- Stato finale ---');
  for (const t of tables) {
    const c = await m[t].count();
    console.log(`  ${t.padEnd(20)} ${c}`);
  }

  const admin = await m.User.findOne({ where: { role: 'admin' } });
  if (admin) {
    console.log(`\n✓ Admin: ${admin.email}`);
    console.log(`  Password default (se non hai impostato DEFAULT_ADMIN_PASSWORD): Admin123!`);
    console.log(`  IMPORTANTE: cambia password subito dopo il primo login.`);
  }

  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
