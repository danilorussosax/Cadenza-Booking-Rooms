'use strict';

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });
const { Op } = require('sequelize');
const { sequelize, User } = require(path.join(BACKEND, 'models'));

(async () => {
  await sequelize.authenticate();
  const docs = await User.findAll({
    where: {
      role: 'docente',
      monteOreAnnualHoursOverride: { [Op.ne]: null },
    },
    attributes: ['id', 'email', 'firstName', 'lastName', 'monteOreAnnualHoursOverride'],
  });
  process.stdout.write(JSON.stringify(docs.map((d) => d.toJSON())));
  await sequelize.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
