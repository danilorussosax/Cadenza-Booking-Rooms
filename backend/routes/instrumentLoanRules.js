'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { InstrumentLoanRule, Course } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const FAMILIES = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];

// =========================================================
// GET /api/admin/instrument-loan-rules
// Restituisce sempre tutte e 9 le famiglie:
//   - se la riga non esiste → torna { family, allowedCourseIds: [], notes: null,
//     configured: false }  (= regola di default permissiva)
//   - se esiste → quella riga + configured: true
// =========================================================
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const rows = await InstrumentLoanRule.findAll();
  const byFamily = new Map(rows.map((r) => [r.family, r]));
  const rules = FAMILIES.map((family) => {
    const r = byFamily.get(family);
    return r
      ? {
          family,
          allowedCourseIds: r.allowedCourseIds || [],
          notes: r.notes || null,
          configured: true,
        }
      : { family, allowedCourseIds: [], notes: null, configured: false };
  });
  res.json({ rules });
});

// =========================================================
// PUT /api/admin/instrument-loan-rules/:family
// Upsert. Body: { allowedCourseIds: number[], notes?: string }
// =========================================================
router.put(
  '/:family',
  authenticate,
  requireRole('admin'),
  [body('allowedCourseIds').optional().isArray(), body('notes').optional({ nullable: true })],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res
        .status(400)
        .json({ error: 'Validazione fallita', details: errs.array(), code: 'VALIDATION_FAILED' });
    }
    const { family } = req.params;
    if (!FAMILIES.includes(family)) {
      return res.status(400).json({ error: 'Famiglia non valida', code: 'VALIDATION_FAILED' });
    }
    const ids = Array.isArray(req.body.allowedCourseIds)
      ? req.body.allowedCourseIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    // Verifica che gli id puntino a corsi esistenti (silently filter)
    let validIds = [];
    if (ids.length > 0) {
      const courses = await Course.findAll({ where: { id: ids }, attributes: ['id'] });
      validIds = courses.map((c) => c.id);
    }

    const [rule] = await InstrumentLoanRule.upsert(
      {
        family,
        allowedCourseIds: validIds,
        notes: typeof req.body.notes === 'string' ? req.body.notes.trim() || null : null,
      },
      { returning: true },
    );

    // Sequelize upsert su SQLite ritorna a volte il vecchio record: ricarica.
    const fresh = await InstrumentLoanRule.findByPk(family);
    res.json({ rule: fresh || rule });
  },
);

// =========================================================
// DELETE /api/admin/instrument-loan-rules/:family
// Rimuove la riga → la famiglia torna in stato "permissivo" di default.
// =========================================================
router.delete('/:family', authenticate, requireRole('admin'), async (req, res) => {
  const { family } = req.params;
  if (!FAMILIES.includes(family)) {
    return res.status(400).json({ error: 'Famiglia non valida', code: 'VALIDATION_FAILED' });
  }
  await InstrumentLoanRule.destroy({ where: { family } });
  res.json({ message: 'Regola eliminata (la famiglia torna in stato permissivo)' });
});

module.exports = router;

// =========================================================
// Helper riusato dalla route POST /api/loans per applicare la regola.
// Esportato come utility per chiarezza.
// =========================================================
async function isUserAllowedForFamily({ user, family }) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const rule = await InstrumentLoanRule.findByPk(family);
  if (!rule) return true; // nessuna regola → permissivo

  const allowed = Array.isArray(rule.allowedCourseIds) ? rule.allowedCourseIds : [];
  if (allowed.length === 0) return false; // configurata ma vuota → blocco

  return user.courseId != null && allowed.includes(user.courseId);
}

module.exports.isUserAllowedForFamily = isUserAllowedForFamily;
module.exports.FAMILIES = FAMILIES;
