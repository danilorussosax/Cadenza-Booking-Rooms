'use strict';

/**
 * Routes "user-facing" della Bacheca avvisi.
 *
 *   GET /api/announcements          → feed dell'utente loggato (audience match,
 *                                     escluse le pinned-only audience='building')
 *
 * Le rotte admin (CRUD) sono in /routes/announcementsAdmin.js.
 * La rotta pubblica per il kiosk è in /routes/public.js.
 */

const express = require('express');
const { Op } = require('sequelize');
const { Announcement } = require('../models');
const { authenticate, requireApproved } = require('../middleware/auth');
const { audienceMatchesUser } = require('../services/audienceMatcher');

const router = express.Router();

// =====================================================
// GET /api/announcements
// Filtri: ?limit=N (default 50, max 100), ?onlyActive=true (default)
// =====================================================
router.get('/', authenticate, requireApproved, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    const now = new Date();

    const all = await Announcement.findAll({
      where: {
        isActive: true,
        publishedAt: { [Op.lte]: now },
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }],
      },
      // Pinned in alto, poi pubblicati di recente
      order: [
        ['isPinned', 'DESC'],
        ['publishedAt', 'DESC'],
      ],
      limit: limit * 2, // overfetch: filtriamo poi per audience
    });

    const filtered = all
      .filter((a) => audienceMatchesUser(a.audience, req.user))
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        publishedAt: a.publishedAt,
        expiresAt: a.expiresAt,
        audience: a.audience,
        isPinned: a.isPinned,
      }));

    res.json({ announcements: filtered });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
