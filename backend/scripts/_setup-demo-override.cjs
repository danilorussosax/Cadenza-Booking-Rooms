'use strict';

/**
 * Setup demo: imposta una deroga Monte Ore su un docente esistente,
 * così lo script screenshot.mjs può catturare il banner /monte-ore.
 *
 * Cerca il primo docente disponibile e imposta:
 *   contractType=contratto_orario, monteOreAnnualHoursOverride=60,
 *   monteOreBypassDayConstraint=true, monteOreOverrideReason=demo.
 *
 * NOTA: questo è uno script DI SVILUPPO solo. Non eseguire in produzione.
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });
const { sequelize, User } = require(path.join(BACKEND, 'models'));

(async () => {
  await sequelize.authenticate();
  const doc = await User.findOne({
    where: { role: 'docente' },
    order: [['id', 'ASC']],
  });
  if (!doc) {
    console.error('Nessun docente in DB. Creane uno prima.');
    process.exit(3);
  }
  await doc.update({
    contractType: 'contratto_orario',
    monteOreAnnualHoursOverride: 60,
    monteOreBypassDayConstraint: true,
    monteOreOverrideReason:
      'DEMO – Contratto orario 60h, prot. 2026/123 del 15/09/2026 (setup automatico per screenshot manuale)',
    monteOreOverrideSetAt: new Date(),
  });
  process.stdout.write(
    JSON.stringify({
      id: doc.id,
      email: doc.email,
      firstName: doc.firstName,
      lastName: doc.lastName,
      override: doc.monteOreAnnualHoursOverride,
    }),
  );
  await sequelize.close();
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
