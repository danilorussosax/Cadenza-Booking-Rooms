'use strict';

const { User, MonteOreSlot, MonteOreAmendment } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const { serializeAmendments } = require('./shared');

module.exports = function registerAmendmentDecisions(adminRouter) {
  // ============================================================
  // ADMIN — amendments per proposta + decisione admin
  // ============================================================

  adminRouter.get('/:id/amendments', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const items = await MonteOreAmendment.findAll({
        where: { proposalId: Number(req.params.id) },
        include: [
          { model: User, as: 'requester', attributes: ['id', 'firstName', 'lastName'] },
          { model: MonteOreSlot, as: 'slot' },
        ],
        order: [['createdAt', 'DESC']],
      });
      res.json({ amendments: await serializeAmendments(items) });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post(
    '/:id/revalidate',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const amendment = await workflow.decideAmendment(Number(req.params.id), null, req.user, {
          administrative: true,
          operations: req.body.operations,
          reason: req.body.reason,
        });
        res.json({ amendment });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post(
    '/:id/amendments/:aid/approve',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        let operations = req.body.operations;
        if (!operations && req.body.roomId) {
          const a = await MonteOreAmendment.findOne({
            where: { id: req.params.aid, proposalId: req.params.id },
          });
          if (a)
            operations = (
              a.operations || [{ kind: a.kind, slotId: a.slotId, payload: a.payload }]
            ).map((op) => ({ ...op, payload: { ...op.payload, roomId: Number(req.body.roomId) } }));
        }
        const amendment = await workflow.decideAmendment(
          Number(req.params.id),
          Number(req.params.aid),
          req.user,
          {
            operations,
            reason:
              req.body.reason || (req.body.roomId ? 'Aula assegnata dal revisore' : undefined),
          },
        );
        res.json({ amendment });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post(
    '/:id/amendments/:aid/reject',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const amendment = await workflow.decideAmendment(
          Number(req.params.id),
          Number(req.params.aid),
          req.user,
          { reject: true, reason: req.body.reason },
        );
        res.json({ amendment });
      } catch (err) {
        next(err);
      }
    },
  );
};
