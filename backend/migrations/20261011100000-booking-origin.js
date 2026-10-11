'use strict';
module.exports = {
  up: (qi) => require('../lib/bookingOriginMigration').up(qi),
  down: (qi) => qi.removeColumn('bookings', 'origin'),
};
