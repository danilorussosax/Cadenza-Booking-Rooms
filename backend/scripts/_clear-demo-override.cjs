'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });
const { sequelize, User } = require(path.join(BACKEND, 'models'));

(async () => {
  await sequelize.authenticate();
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('Uso: node _clear-demo-override.cjs <userId>');
    process.exit(2);
  }
  const doc = await User.findByPk(id);
  if (!doc) process.exit(3);
  await doc.update({
    contractType: null,
    monteOreAnnualHoursOverride: null,
    monteOreBypassDayConstraint: false,
    monteOreOverrideReason: null,
    monteOreOverrideSetAt: null,
    monteOreOverrideSetBy: null,
  });
  process.stdout.write(`Override rimosso per ${doc.email}\n`);
  await sequelize.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
