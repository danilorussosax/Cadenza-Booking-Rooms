'use strict';

const express = require('express');
const { User, OAuthSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { loadCadenzaRules, resolveCadenzaRole } = require('../lib/group-role-map');

const router = express.Router();

// GET /api/admin/users-overview — utenti con snapshot gruppi M365, ruolo in DB,
// ruolo RISOLTO dal mapping corrente e flag di allineamento. Deriva tutto dallo
// snapshot `m365Groups` (nessuna chiamata Graph per riga).
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const settings = await OAuthSettings.findOne({ where: { id: 1 } });
  const rules = await loadCadenzaRules(settings);

  const users = await User.findAll({
    attributes: [
      'id',
      'email',
      'firstName',
      'lastName',
      'role',
      'status',
      'm365Groups',
      'isActive',
    ],
    order: [
      ['lastName', 'ASC'],
      ['firstName', 'ASC'],
    ],
  });

  const rows = users.map((u) => {
    const groups = Array.isArray(u.m365Groups) ? u.m365Groups : [];
    const set = new Set(groups.map((g) => String(g).trim().toLowerCase()));
    const matched = rules.some(
      (r) => r.groupDisplayName && set.has(String(r.groupDisplayName).trim().toLowerCase()),
    );
    const resolved = resolveCadenzaRole(groups, rules);

    let stato;
    if (!matched) stato = 'non_mappato';
    else if (resolved && resolved !== u.role) stato = 'disallineato';
    else stato = 'allineato';

    return {
      email: u.email,
      nome: `${u.firstName} ${u.lastName}`.trim(),
      isActive: u.isActive,
      status: u.status,
      m365Groups: groups,
      role: u.role,
      roleRisolto: resolved,
      stato,
    };
  });

  res.json({ users: rows });
});

// POST /api/admin/users-overview/realign  { email } — forza il riallineamento al
// ruolo risolto dal mapping (senza attendere il login).
router.post('/realign', authenticate, requireRole('admin'), async (req, res) => {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email mancante' });

  const target = await User.findOne({ where: { email } });
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });

  const settings = await OAuthSettings.findOne({ where: { id: 1 } });
  const rules = await loadCadenzaRules(settings);
  const resolved = resolveCadenzaRole(
    Array.isArray(target.m365Groups) ? target.m365Groups : [],
    rules,
  );

  if (!resolved) {
    return res
      .status(400)
      .json({ error: 'Nessun ruolo risolto dai gruppi: niente da riallineare' });
  }

  target.role = resolved;
  if (target.status === 'pending') target.status = 'approved';
  await target.save();

  res.json({ email, role: resolved, status: target.status });
});

module.exports = router;
