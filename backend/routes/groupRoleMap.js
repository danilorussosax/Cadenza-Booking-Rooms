'use strict';

const express = require('express');
const { sequelize, GroupRoleMap, OAuthSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');
const { defaultRulesFromSettings } = require('../lib/group-role-map');
const { getAppOnlyToken, listTenantGroups } = require('../lib/ms-graph');
const { httpError } = require('../lib/domainError');

const router = express.Router();

const VALID_ROLES = ['admin', 'docente', 'studente'];

function safeDecrypt(v) {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

// GET /api/admin/group-role-map — regole correnti + gruppi tenant per la dropdown.
// Se la tabella è vuota ritorna le regole di default dai nomi gruppo (seed implicito).
// `tenantGroups` null se manca il consenso/credenziali Graph → UI a testo libero.
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const settings = await OAuthSettings.findOne({ where: { id: 1 } });

  const rows = await GroupRoleMap.findAll({ order: [['priority', 'ASC']] });
  const rules =
    rows.length > 0
      ? rows.map((r) => ({
          groupId: r.groupId,
          groupDisplayName: r.groupDisplayName,
          role: r.role,
          priority: r.priority,
        }))
      : defaultRulesFromSettings(settings).map((r) => ({ groupId: null, ...r }));

  const token = await getAppOnlyToken(
    settings?.microsoftTenant || null,
    settings?.microsoftClientId || null,
    safeDecrypt(settings?.microsoftClientSecretEncrypted),
  );
  const tenantGroups = token ? await listTenantGroups(token) : null;

  res.json({ rules, tenantGroups, ruoli: VALID_ROLES });
});

// PUT /api/admin/group-role-map — sostituisce l'intero set di regole (replace-all).
router.put('/', authenticate, requireRole('admin'), async (req, res) => {
  const input = Array.isArray(req.body?.rules) ? req.body.rules : null;
  if (!input) throw httpError(400, 'Campo "rules" mancante o non valido');
  if (input.length > 100) throw httpError(400, 'Troppe regole (max 100)');

  const seen = new Set();
  const cleaned = [];
  for (const r of input) {
    const name = String(r?.groupDisplayName || '').trim();
    if (!name) throw httpError(400, 'Ogni regola richiede un gruppo');
    if (!VALID_ROLES.includes(r?.role)) {
      throw httpError(400, `Ruolo non valido: ${r?.role}`);
    }
    const priority = Number.parseInt(r?.priority, 10);
    if (!Number.isInteger(priority) || priority < 1) {
      throw httpError(400, 'Priority deve essere un intero ≥ 1');
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw httpError(400, `Gruppo duplicato: "${name}"`);
    seen.add(key);
    cleaned.push({
      groupId: r.groupId ? String(r.groupId) : null,
      groupDisplayName: name,
      role: r.role,
      priority,
    });
  }

  try {
    await sequelize.transaction(async (t) => {
      await GroupRoleMap.destroy({ where: {}, transaction: t });
      if (cleaned.length) await GroupRoleMap.bulkCreate(cleaned, { transaction: t });
    });
    const rows = await GroupRoleMap.findAll({ order: [['priority', 'ASC']] });
    res.json({ rules: rows });
  } catch (err) {
    res.status(500).json({ error: 'Errore nel salvataggio del mapping', detail: err.message });
  }
});

module.exports = router;
