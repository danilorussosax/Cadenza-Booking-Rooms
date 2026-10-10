'use strict';

module.exports = {
  up: (queryInterface) => require('../lib/monteOreWorkflowMigration').up(queryInterface),
  // Preserve decisions, snapshots and request counters on application rollback.
  down: async () => {},
};
