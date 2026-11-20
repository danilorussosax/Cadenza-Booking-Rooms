'use strict';

const express = require('express');
// Impostazioni sicurezza check-in (toggle + allowlist CIDR).

const { Institute } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');

const { domainError, httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// Check-in security policy: GET/PUT toggle + CIDR allowlist.
// Singleton: opera sul primo Institute (l'app è single-institute in prod).
// CIDR validati con ipaddr.js (IPv4/IPv6) — riga rifiutata se invalida.
// =========================================================
const { validateCidr, extractClientIp, normalizeIp } = require('../../lib/network');
router.get('/checkin-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({
    attributes: ['id', 'checkInRequireInstituteNetwork', 'instituteNetworkCidrs'],
    order: [['id', 'ASC']],
  });
  if (!inst) throw httpError(404, 'Istituto non configurato');
  res.json({
    checkInRequireInstituteNetwork: !!inst.checkInRequireInstituteNetwork,
    instituteNetworkCidrs: Array.isArray(inst.instituteNetworkCidrs)
      ? inst.instituteNetworkCidrs
      : [],
    // Espone l'IP attuale dell'admin chiamante per UX: l'admin può copiarlo
    // in whitelist con un click ("Aggiungi mio IP corrente"). Normalizzato
    // per rimuovere il prefisso IPv4-mapped IPv6 (`::ffff:1.2.3.4` → `1.2.3.4`).
    callerIp: normalizeIp(extractClientIp(req)),
  });
});

router.put('/checkin-settings', authenticate, requireRole('admin'), async (req, res) => {
  const inst = await Institute.findOne({ order: [['id', 'ASC']] });
  if (!inst) throw httpError(404, 'Istituto non configurato');

  const { checkInRequireInstituteNetwork, instituteNetworkCidrs } = req.body || {};

  if (typeof checkInRequireInstituteNetwork !== 'boolean') {
    throw domainError('VALIDATION', 'checkInRequireInstituteNetwork deve essere booleano');
  }
  if (!Array.isArray(instituteNetworkCidrs)) {
    throw domainError('VALIDATION', 'instituteNetworkCidrs deve essere un array');
  }

  // Valida ogni CIDR; aggrega errori per UX migliore.
  const errors = [];
  const normalized = [];
  for (let i = 0; i < instituteNetworkCidrs.length; i++) {
    const raw = instituteNetworkCidrs[i];
    const v = validateCidr(raw);
    if (!v.ok) {
      errors.push({ index: i, value: raw, error: v.error });
    } else {
      normalized.push(v.normalized);
    }
  }
  if (errors.length > 0) {
    throw domainError('INVALID_CIDR', 'CIDR non validi', { extra: { errors } });
  }

  // Safety: se il toggle viene attivato con allowlist vuota, è una
  // misconfiguration (nessuno potrà fare check-in). Permettiamo ma
  // segnaliamo nel response come warning per UX.
  inst.checkInRequireInstituteNetwork = checkInRequireInstituteNetwork;
  inst.instituteNetworkCidrs = normalized;
  await inst.save();

  const warnings = [];
  if (checkInRequireInstituteNetwork && normalized.length === 0) {
    warnings.push(
      'Lista CIDR vuota: nessun client potrà effettuare check-in finché non aggiungi almeno un CIDR.',
    );
  }

  res.json({
    checkInRequireInstituteNetwork: inst.checkInRequireInstituteNetwork,
    instituteNetworkCidrs: inst.instituteNetworkCidrs,
    warnings,
  });
});

module.exports = router;
