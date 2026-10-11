'use strict';

const express = require('express');
const router = express.Router();

// Register in the original order: concrete paths precede parameter routes,
// and shared middleware keeps applying to all subsequent handlers.
require('./bookings/read')(router);
require('./bookings/create')(router);
require('./bookings/adminActions')(router);
require('./bookings/approvals')(router);
require('./bookings/updateAndCancel')(router);
require('./bookings/legacyRecurring')(router);
require('./bookings/availability')(router);
require('./bookings/checkIn')(router);
require('./bookings/concerts')(router);
require('./bookings/recurring')(router);

module.exports = router;
