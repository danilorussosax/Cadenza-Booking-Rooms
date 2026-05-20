'use strict';

/**
 * Dashboard ops admin: snapshot aggregato dello stato sistema +
 * accesso al ring buffer slow query (v1.12).
 *
 * Endpoint:
 *   GET /api/admin/ops/snapshot                      — snapshot completo (cache 5s)
 *   GET /api/admin/ops/snapshot?force                — bypassa la cache (uso debug)
 *   GET /api/admin/ops/slow-queries                  — ultime query lente (default 50)
 *   GET /api/admin/ops/slow-queries/aggregate?by=... — aggregato per route|model|pattern
 *
 * Tutti admin-only.
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getSnapshot } = require('../services/opsSnapshot');
const slowQueryRecorder = require('../lib/slowQueryRecorder');
const logger = require('../lib/logger').child({ scope: 'ops.route' });

const router = express.Router();

router.get('/snapshot', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const snap = await getSnapshot({ force });
    res.json(snap);
  } catch (err) {
    logger.error({ err: err.message }, 'ops snapshot failed');
    res.status(500).json({ error: 'Snapshot non disponibile', detail: err.message });
  }
});

// =====================================================
// Slow queries (v1.12)
// =====================================================
//
// Espone il ring buffer in-memory di slowQueryRecorder. Read-only: nessun
// dato dei job/code esposto, solo SQL già normalizzato (params → ?).
router.get('/slow-queries', authenticate, requireRole('admin'), (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const route = typeof req.query.route === 'string' ? req.query.route : null;
  const items = slowQueryRecorder.getRecent({ limit, since, route });
  res.json({ items, stats: slowQueryRecorder.getStats() });
});

router.get('/slow-queries/aggregate', authenticate, requireRole('admin'), (req, res) => {
  const by = ['route', 'model', 'pattern'].includes(req.query.by) ? req.query.by : 'route';
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const aggregate = slowQueryRecorder.getAggregate({ by, since, limit });
  res.json({ aggregate, by, stats: slowQueryRecorder.getStats() });
});

module.exports = router;
