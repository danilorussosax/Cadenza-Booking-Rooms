'use strict';

/**
 * Dashboard ops admin: snapshot aggregato dello stato sistema.
 *
 * Endpoint:
 *   GET /api/admin/ops/snapshot       — snapshot completo (cache 5s)
 *   GET /api/admin/ops/snapshot?force — bypassa la cache (uso debug)
 *
 * Tutti admin-only. La logica reale sta in services/opsSnapshot.js.
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getSnapshot } = require('../services/opsSnapshot');
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

module.exports = router;
