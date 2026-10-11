'use strict';
const { DataTypes } = require('sequelize');

async function up(qi, transaction = null) {
  if (!transaction && qi.sequelize.getDialect() === 'postgres') {
    return qi.sequelize.transaction(async (t) => {
      await qi.sequelize.query('SELECT pg_advisory_xact_lock(170021)', { transaction: t });
      return up(qi, t);
    });
  }
  const tables = await qi.showAllTables({ transaction });
  if (!tables.some((t) => (typeof t === 'string' ? t : t.tableName) === 'monte_ore_settings'))
    return;
  const columns = await qi.describeTable('monte_ore_settings', { transaction });
  if (!columns.status)
    await qi.addColumn(
      'monte_ore_settings',
      'status',
      {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'published',
      },
      { transaction },
    );
}
module.exports = { up };
