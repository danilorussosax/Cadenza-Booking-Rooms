'use strict';

const express = require('express');
const { Op } = require('sequelize');
const { AuditLog, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ACTIONS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// =====================================================
// GET /api/admin/audit-log
// Paginazione + filtri (admin only).
//
// Query params:
//   - page (default 1), pageSize (default 50, max 200)
//   - actorId       : filtra per utente che ha eseguito l'azione
//   - action        : POST | PUT | PATCH | DELETE
//   - targetType    : 'user' | 'room' | … (string)
//   - targetId      : id numerico dell'entità (richiede targetType)
//   - dateFrom/dateTo: ISO date (intervallo su createdAt)
//   - q             : ricerca testuale su path
// =====================================================
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize) || 50));
    const where = {};

    if (req.query.actorId) {
      const id = Number(req.query.actorId);
      if (Number.isInteger(id) && id > 0) where.actorId = id;
    }
    if (req.query.action && VALID_ACTIONS.includes(String(req.query.action).toUpperCase())) {
      where.action = String(req.query.action).toUpperCase();
    }
    if (req.query.targetType) where.targetType = String(req.query.targetType).slice(0, 48);
    if (req.query.targetId) {
      const id = Number(req.query.targetId);
      if (Number.isInteger(id) && id > 0) where.targetId = id;
    }
    if (req.query.dateFrom || req.query.dateTo) {
      where.createdAt = {};
      if (req.query.dateFrom) {
        const d = new Date(req.query.dateFrom);
        if (!Number.isNaN(d.getTime())) where.createdAt[Op.gte] = d;
      }
      if (req.query.dateTo) {
        const d = new Date(req.query.dateTo);
        if (!Number.isNaN(d.getTime())) where.createdAt[Op.lte] = d;
      }
    }
    if (req.query.q) {
      where.path = { [Op.iLike ? Op.iLike : Op.like]: `%${String(req.query.q).slice(0, 100)}%` };
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      include: [
        {
          model: User,
          as: 'actor',
          attributes: ['id', 'firstName', 'lastName', 'email', 'role'],
          required: false,
        },
      ],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    res.json({
      entries: rows,
      total: count,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// GET /api/admin/audit-log/target-types
// Lista distinta dei targetType presenti, per popolare il filtro UI.
// =====================================================
router.get('/target-types', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rows = await AuditLog.findAll({
      attributes: [
        [AuditLog.sequelize.fn('DISTINCT', AuditLog.sequelize.col('targetType')), 'targetType'],
      ],
      raw: true,
      order: [['targetType', 'ASC']],
    });
    res.json({ targetTypes: rows.map((r) => r.targetType).filter(Boolean) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
