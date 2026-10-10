'use strict';
const { DataTypes } = require('sequelize');
module.exports = (sequelize) =>
  sequelize.define(
    'RateLimitBucket',
    {
      key: { type: DataTypes.STRING(64), primaryKey: true },
      hits: { type: DataTypes.INTEGER, allowNull: false },
      resetAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'rate_limit_buckets', timestamps: false, indexes: [{ fields: ['resetAt'] }] },
  );
