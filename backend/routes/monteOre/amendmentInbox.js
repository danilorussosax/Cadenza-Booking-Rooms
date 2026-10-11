'use strict';

const { MonteOreProposal, User, MonteOreSlot, MonteOreAmendment } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { serializeAmendments } = require('./shared');

module.exports = function registerAmendmentInbox(adminRouter) {
  // ---- Amendments — vista globale (deve stare prima di /:id) ----
  adminRouter.get('/amendments', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.proposalId) where.proposalId = Number(req.query.proposalId);
      const items = await MonteOreAmendment.findAll({
        where,
        include: [
          { model: User, as: 'requester', attributes: ['id', 'firstName', 'lastName', 'email'] },
          {
            model: MonteOreProposal,
            as: 'proposal',
            attributes: ['id', 'academicYear', 'userId', 'status'],
          },
          { model: MonteOreSlot, as: 'slot' },
        ],
        order: [['createdAt', 'DESC']],
      });
      res.json({ amendments: await serializeAmendments(items) });
    } catch (err) {
      next(err);
    }
  });

  // Conteggio (badge sidebar / dashboard tile): evita di trasferire l'intera
  // lista di amendment quando serve solo il numero.
  adminRouter.get(
    '/amendments/pending/count',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const count = await MonteOreAmendment.count({ where: { status: 'pending' } });
        res.json({ count });
      } catch (err) {
        next(err);
      }
    },
  );
};
