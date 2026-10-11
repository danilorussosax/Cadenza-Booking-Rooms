'use strict';
module.exports = {
  up: (qi) => require('../lib/academicYearMigration').up(qi),
  down: (qi) => qi.removeColumn('monte_ore_settings', 'status'),
};
