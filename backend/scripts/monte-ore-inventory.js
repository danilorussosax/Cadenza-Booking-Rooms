#!/usr/bin/env node
'use strict';

// Read-only inventory; emits IDs/counts, never names or email addresses.
const path = require('node:path');
const backendDir = path.resolve(process.cwd(), 'backend');
require(path.join(backendDir, 'node_modules/dotenv')).config({
  path: path.join(backendDir, '.env'),
  quiet: true,
});
const { sequelize } = require(path.join(backendDir, 'models'));
(async () => {
  const [teachers] = await sequelize.query(
    `SELECT "id", "contractType", "monteOreAnnualHoursOverride" FROM "users" WHERE "role" = 'docente' AND "deletedAt" IS NULL`,
  );
  const [proposals] = await sequelize.query(
    'SELECT "id", "academicYear", "status", "generationSummary", "requiresRevalidation" FROM "monte_ore_proposals"',
  );
  const [amendments] = await sequelize.query(
    'SELECT "status", COUNT(*) AS "count" FROM "monte_ore_amendments" GROUP BY "status"',
  );
  console.log(
    JSON.stringify(
      {
        teachers: teachers.length,
        missingContracts: teachers.filter((u) => !u.contractType).map((u) => u.id),
        collaborationsWithoutHours: teachers
          .filter(
            (u) => u.contractType === 'collaborazione' && !(u.monteOreAnnualHoursOverride > 0),
          )
          .map((u) => u.id),
        legacyContracts: teachers
          .filter((u) => ['supplente', 'contratto_orario', 'altro'].includes(u.contractType))
          .map((u) => ({ id: u.id, contractType: u.contractType })),
        proposals,
        amendmentCounts: amendments,
      },
      null,
      2,
    ),
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
