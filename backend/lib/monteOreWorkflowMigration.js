'use strict';

// Additive, repeatable migration for existing installations; sync creates fresh tables.
const { DataTypes } = require('sequelize');

async function up(qi, transaction = null) {
  if (!transaction && qi.sequelize.getDialect() === 'postgres') {
    return qi.sequelize.transaction(async (t) => {
      await qi.sequelize.query('SELECT pg_advisory_xact_lock(170017)', { transaction: t });
      await up(qi, t);
    });
  }
  const additions = {
    contract_types: {
      hoursMode: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'minimum' },
      requiresIndividualHours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    monte_ore_proposals: {
      contractSnapshot: { type: DataTypes.JSON, allowNull: true },
      revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      requestCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    monte_ore_amendments: {
      beforeSnapshot: { type: DataTypes.JSON, allowNull: true },
      afterSnapshot: { type: DataTypes.JSON, allowNull: true },
      operations: { type: DataTypes.JSON, allowNull: true },
      finalOperations: { type: DataTypes.JSON, allowNull: true },
      baseRevision: { type: DataTypes.INTEGER, allowNull: true },
      decisionNotes: { type: DataTypes.TEXT, allowNull: true },
      idempotencyKey: { type: DataTypes.STRING(100), allowNull: true },
    },
  };
  const tables = (await qi.showAllTables({ transaction })).map((t) =>
    typeof t === 'string' ? t : t.tableName,
  );
  for (const [table, fields] of Object.entries(additions)) {
    if (!tables.includes(table)) continue;
    const columns = await qi.describeTable(table, { transaction });
    for (const [name, definition] of Object.entries(fields)) {
      if (!columns[name]) await qi.addColumn(table, name, definition, { transaction });
    }
  }
  if (tables.includes('contract_types') && tables.includes('institutes')) {
    // Production can disable DB_SEED: install only these workflow catalogue entries.
    const [institutes] = await qi.sequelize.query(
      'SELECT "id" FROM "institutes" ORDER BY "id" ASC LIMIT 1',
      { transaction },
    );
    const [existingTypes] = await qi.sequelize.query('SELECT "code" FROM "contract_types"', {
      transaction,
    });
    const canonical = [
      {
        code: 'titolare',
        label: 'Titolare di cattedra',
        defaultHours: 324,
        hoursMode: 'exact',
        requiresIndividualHours: false,
        sortOrder: 1,
      },
      {
        code: 'tempo_definito',
        label: 'Tempo definito',
        defaultHours: 162,
        hoursMode: 'maximum',
        requiresIndividualHours: false,
        sortOrder: 2,
      },
      {
        code: 'collaborazione',
        label: 'Collaborazione',
        defaultHours: null,
        hoursMode: 'exact',
        requiresIndividualHours: true,
        sortOrder: 3,
      },
    ];
    for (const type of canonical) {
      if (existingTypes.some((row) => row.code === type.code)) {
        await qi.bulkUpdate(
          'contract_types',
          {
            defaultHours: type.defaultHours,
            hoursMode: type.hoursMode,
            requiresIndividualHours: type.requiresIndividualHours,
          },
          { code: type.code },
          { transaction },
        );
      } else if (institutes[0]) {
        await qi.bulkInsert(
          'contract_types',
          [
            {
              ...type,
              instituteId: institutes[0].id,
              bypassDayConstraintDefault: false,
              isSystem: true,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          { transaction },
        );
      }
    }
  }
  if (
    tables.includes('monte_ore_proposals') &&
    (await qi.describeTable('monte_ore_proposals', { transaction })).minRequiredHoursSnapshot
  ) {
    // Keep operational plans under their historical minimum until explicit revalidation.
    const [legacy] = await qi.sequelize.query(
      `SELECT "id", "minRequiredHoursSnapshot", "totalHoursPlanned" FROM "monte_ore_proposals" WHERE "contractSnapshot" IS NULL AND "status" IN ('submitted', 'approved', 'generated')`,
      { transaction },
    );
    for (const proposal of legacy) {
      await qi.sequelize.query(
        'UPDATE "monte_ore_proposals" SET "contractSnapshot" = :snapshot WHERE "id" = :id AND "contractSnapshot" IS NULL',
        {
          transaction,
          replacements: {
            id: proposal.id,
            snapshot: JSON.stringify({
              mode: 'minimum',
              minHours: proposal.minRequiredHoursSnapshot ?? proposal.totalHoursPlanned ?? 0,
              bypassDayConstraint: true,
              source: 'legacy_snapshot',
              contractType: null,
            }),
          },
        },
      );
    }
  }
  if (tables.includes('monte_ore_amendments')) {
    const indexes = await qi.showIndex('monte_ore_amendments', { transaction });
    if (!indexes.some((i) => i.name === 'monte_ore_amendments_request_key')) {
      await qi.addIndex('monte_ore_amendments', ['idempotencyKey'], {
        unique: true,
        name: 'monte_ore_amendments_request_key',
        transaction,
      });
    }
  }
}

module.exports = { up };
