'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('rate_limit_buckets', {
      key: { type: Sequelize.STRING(64), primaryKey: true },
      hits: { type: Sequelize.INTEGER, allowNull: false },
      resetAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('rate_limit_buckets', ['resetAt'], {
      name: 'rate_limit_buckets_reset_at',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('rate_limit_buckets');
  },
};
