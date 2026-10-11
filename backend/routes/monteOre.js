'use strict';

const express = require('express');
const router = express.Router();
const adminRouter = express.Router();

// Register in the original order: concrete paths precede parameter routes,
// and shared middleware keeps applying to all subsequent handlers.
require('./monteOre/teacherProposals')(router);
require('./monteOre/teacherCalendar')(router);
require('./monteOre/teacherAmendments')(router);
require('./monteOre/academicYears')(router);
require('./monteOre/adminAcademicYears')(adminRouter);
require('./monteOre/examSessions')(adminRouter);
require('./monteOre/imports')(adminRouter);
require('./monteOre/settings')(adminRouter);
require('./monteOre/suspensions')(adminRouter);
require('./monteOre/amendmentInbox')(adminRouter);
require('./monteOre/adminProposals')(adminRouter);
require('./monteOre/amendmentDecisions')(adminRouter);

module.exports = { router, adminRouter };
