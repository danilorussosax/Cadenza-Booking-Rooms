'use strict';
const { createHash } = require('crypto');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

// One atomic UPSERT per request; database time is shared by all PM2 workers.
class PgRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  key(value) {
    return createHash('sha256').update(`${this.prefix}:${value}`).digest('hex');
  }
  async increment(value) {
    const rows = await sequelize.query(
      `
      INSERT INTO rate_limit_buckets (key, hits, "resetAt")
      VALUES (:key, 1, clock_timestamp() + :windowMs * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_buckets."resetAt" <= clock_timestamp() THEN 1 ELSE rate_limit_buckets.hits + 1 END,
        "resetAt" = CASE WHEN rate_limit_buckets."resetAt" <= clock_timestamp()
          THEN clock_timestamp() + :windowMs * interval '1 millisecond' ELSE rate_limit_buckets."resetAt" END
      RETURNING hits, "resetAt"`,
      {
        replacements: { key: this.key(value), windowMs: this.windowMs },
        type: QueryTypes.SELECT,
      },
    );
    return { totalHits: rows[0].hits, resetTime: new Date(rows[0].resetAt) };
  }
  async decrement(value) {
    await sequelize.query(
      'UPDATE rate_limit_buckets SET hits = GREATEST(hits - 1, 0) WHERE key = :key',
      { replacements: { key: this.key(value) } },
    );
  }
  async resetKey(value) {
    await sequelize.query('DELETE FROM rate_limit_buckets WHERE key = :key', {
      replacements: { key: this.key(value) },
    });
  }
}
module.exports = PgRateLimitStore;
