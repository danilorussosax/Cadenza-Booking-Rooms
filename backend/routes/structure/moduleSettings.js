'use strict';

const express = require('express');
// Module flags (toggle della sidebar).

const { Institute } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');

const { domainError, httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// Module flags — toggle "presentational" della sidebar.
// Il backend resta sempre attivo: questi toggle servono soltanto a
// mostrare o nascondere i link "Monte ore" e "Strumenti" in UI.
// Singleton sull'unico Institute.
// =========================================================
// Espone il REGISTRY (lista dei moduli toggle-abili). La UI lo consuma per
// iterare invece di hardcodare gli N moduli. Lascia anche scoprire i
// `defaultEnabled` quando l'Institute è appena seedato.
const { listModules, publicRegistry } = require('../../services/moduleFlags');
const { invalidateModuleCache } = require('../../middleware/moduleGuard');

router.get('/module-settings/registry', authenticate, requireRole('admin'), (req, res) => {
  res.json({ modules: publicRegistry() });
});

router.get('/module-settings', authenticate, requireRole('admin'), async (req, res) => {
  const cols = listModules().map((m) => m.column);
  const inst = await Institute.findOne({
    attributes: ['id', ...cols],
    order: [['id', 'ASC']],
  });
  if (!inst) throw httpError(404, 'Istituto non configurato');
  const out = {};
  for (const m of listModules()) {
    out[m.column] = !!inst[m.column];
  }
  res.json(out);
});

router.put('/module-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) throw httpError(404, 'Istituto non configurato');

  // Itera sul registry: per ogni modulo accettiamo il booleano sotto la
  // sua colonna esatta. Body sconosciuti (campi non in registry) sono
  // ignorati — anti mass-assignment by default.
  const update = {};
  for (const m of listModules()) {
    const v = req.body?.[m.column];
    if (typeof v === 'boolean') update[m.column] = v;
  }
  if (Object.keys(update).length === 0) {
    throw domainError('VALIDATION', 'Nessun flag valido nel body');
  }
  await inst.update(update);
  // Propaga immediatamente la modifica al middleware moduleGuard, senza
  // attendere il TTL della cache (utile per i test e per evitare la finestra
  // di 30 s in cui un modulo appena spento sarebbe ancora "raggiungibile").
  invalidateModuleCache();

  const out = {};
  for (const m of listModules()) {
    out[m.column] = !!inst[m.column];
  }
  res.json(out);
});

module.exports = router;
