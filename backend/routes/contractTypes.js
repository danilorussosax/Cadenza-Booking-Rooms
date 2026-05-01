'use strict';

/**
 * Gestione tipologie contrattuali docenti (Monte Ore).
 *
 * Modelli coinvolti:
 *   - ContractType: anagrafica tipologie (titolare, supplente, custom...)
 *   - User.contractType: STRING senza FK — il valore = ContractType.code
 *   - MonteOreProposal.minRequiredHoursSnapshot: snapshot fissato al submit,
 *     non viene toccato da modifiche successive di defaultHours.
 *
 * Endpoint:
 *   GET    /                  — list (auth: tutti gli utenti, serve a UserFormDialog)
 *   GET    /:id/impact        — utenti+proposte impattate (admin)
 *   POST   /                  — crea custom (admin)
 *   PUT    /:id               — modifica label/defaultHours/bypass/sortOrder/isActive (admin)
 *   DELETE /:id               — soft-delete (admin) — bloccato se isSystem o IN_USE
 *
 * Regole:
 *   - `code` immutabile (per non orfanare User.contractType)
 *   - `isSystem=true` non cancellabile (può essere disattivato)
 *   - DELETE bloccato se almeno 1 utente attivo usa quel code → 409 IN_USE
 *     con conteggio per permettere all'admin di scegliere la riassegnazione
 */

const express = require('express');
const { Op } = require('sequelize');
const { ContractType, User, Institute, MonteOreProposal } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { logger } = require('../lib/logger');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function getDefaultInstituteId() {
  const inst = await Institute.findOne({ order: [['id', 'ASC']], attributes: ['id'] });
  return inst?.id ?? null;
}

function pickFields(body) {
  const out = {};
  if ('label' in body) out.label = String(body.label).trim().slice(0, 80);
  if ('defaultHours' in body)
    out.defaultHours =
      body.defaultHours === null || body.defaultHours === '' ? null : Number(body.defaultHours);
  if ('bypassDayConstraintDefault' in body)
    out.bypassDayConstraintDefault = !!body.bypassDayConstraintDefault;
  if ('sortOrder' in body) out.sortOrder = Number(body.sortOrder) || 0;
  if ('isActive' in body) out.isActive = !!body.isActive;
  if ('notes' in body) out.notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;
  return out;
}

// Slugifica un label in un code conforme `[a-z0-9_]{1,40}`.
function slugifyCode(label) {
  return (
    String(label)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'tipo'
  );
}

// ────────────────────────────────────────────────────────────────────────
// GET / — list (auth, qualsiasi utente)
// Query: ?includeInactive=true (admin only) per mostrare i disattivati
// ────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'admin';
    const where = includeInactive ? {} : { isActive: true };
    const types = await ContractType.findAll({
      where,
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.json({ contractTypes: types });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /:id/impact — preview utenti + proposte impattati (admin)
// Per il dialog di conferma cambio defaultHours: mostra quanti utenti
// userebbero la nuova soglia e quante proposte (in stato draft) potrebbero
// essere ricalcolate. Le proposte submitted/approved hanno snapshot
// stabile, le elenchiamo separate per trasparenza.
// ────────────────────────────────────────────────────────────────────────
router.get('/:id/impact', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ct = await ContractType.findByPk(req.params.id);
    if (!ct) return res.status(404).json({ error: 'Tipologia non trovata', code: 'NOT_FOUND' });

    // Utenti che usano questo code (e non hanno override individuale → quindi
    // verrebbero impattati dal cambio defaultHours).
    const usersAffected = await User.findAll({
      where: {
        contractType: ct.code,
        role: 'docente',
        monteOreAnnualHoursOverride: null,
      },
      attributes: ['id', 'firstName', 'lastName', 'email'],
      order: [
        ['lastName', 'ASC'],
        ['firstName', 'ASC'],
      ],
      paranoid: true,
    });

    // Utenti con override individuale: il cambio defaultHours NON li tocca,
    // ma li mostriamo nel report per completezza.
    const usersWithOverride = await User.count({
      where: {
        contractType: ct.code,
        role: 'docente',
        monteOreAnnualHoursOverride: { [Op.ne]: null },
      },
    });

    // Proposte 'draft' di quei docenti (saranno ricalcolate al prossimo
    // resolveAnnualThreshold). submitted/approved hanno snapshot stabile.
    const userIds = usersAffected.map((u) => u.id);
    const draftProposalsCount = userIds.length
      ? await MonteOreProposal.count({
          where: { userId: { [Op.in]: userIds }, status: 'draft' },
        })
      : 0;

    res.json({
      contractType: { id: ct.id, code: ct.code, label: ct.label, defaultHours: ct.defaultHours },
      usersAffectedCount: usersAffected.length,
      usersAffected: usersAffected.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      })),
      usersWithOverrideCount: usersWithOverride,
      draftProposalsCount,
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST / — crea (admin)
// ────────────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const instituteId = await getDefaultInstituteId();
    if (!instituteId) {
      return res.status(500).json({ error: 'Nessun istituto configurato', code: 'NO_INSTITUTE' });
    }

    const labelRaw = String(req.body?.label || '').trim();
    if (!labelRaw) {
      return res.status(400).json({ error: 'Etichetta obbligatoria', code: 'LABEL_REQUIRED' });
    }
    if (labelRaw.length > 80) {
      return res.status(400).json({ error: 'Etichetta troppo lunga', code: 'LABEL_TOO_LONG' });
    }

    // Code: o fornito dal client (validato), o auto-slugificato dal label.
    let code = req.body?.code ? String(req.body.code).trim().toLowerCase() : slugifyCode(labelRaw);
    if (!/^[a-z0-9_]{1,40}$/.test(code)) {
      return res
        .status(400)
        .json({ error: 'Codice non valido (solo a-z, 0-9, _; max 40 char)', code: 'CODE_INVALID' });
    }

    // Code unico per istituto (compresi i soft-deleted? No: paranoid).
    const existing = await ContractType.findOne({ where: { instituteId, code } });
    if (existing) {
      return res.status(409).json({
        error: 'Codice già esistente per questo istituto',
        code: 'CODE_DUPLICATE',
      });
    }

    const fields = pickFields(req.body);
    const created = await ContractType.create({
      instituteId,
      code,
      label: fields.label || labelRaw,
      defaultHours: fields.defaultHours ?? null,
      bypassDayConstraintDefault: fields.bypassDayConstraintDefault ?? false,
      sortOrder: fields.sortOrder ?? 0,
      isActive: fields.isActive ?? true,
      isSystem: false,
      notes: fields.notes ?? null,
    });

    logger?.info?.(
      { actorId: req.user.id, contractTypeId: created.id, code },
      '[contract-types] created',
    );
    res.status(201).json({ contractType: created });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────
// PUT /:id — modifica (admin)
// `code` immutabile. Per i tipi `isSystem=true` si possono cambiare label,
// defaultHours, bypass, sortOrder, isActive — ma NON disattivare se ci
// sono utenti senza override che dipendono dal default.
// ────────────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ct = await ContractType.findByPk(req.params.id);
    if (!ct) return res.status(404).json({ error: 'Tipologia non trovata', code: 'NOT_FOUND' });

    const fields = pickFields(req.body);

    // Se l'admin sta passando un `code`, lo ignoriamo silenziosamente —
    // policy: code immutabile.
    delete fields.code;

    // confirmedDefaultHoursChange: l'UI invia true dopo che l'admin ha
    // visto e accettato il dialog di impatto. Senza conferma esplicita,
    // se defaultHours cambia (verso qualcosa di diverso), rifiutiamo con
    // 409 IMPACT_CONFIRM_REQUIRED — il client deve passare prima da
    // GET /:id/impact e mostrare il dialog.
    const oldDefault = ct.defaultHours;
    const newDefault = 'defaultHours' in fields ? fields.defaultHours : undefined;
    const isDefaultChanging =
      newDefault !== undefined && Number(newDefault ?? -1) !== Number(oldDefault ?? -1);
    if (isDefaultChanging && !req.body?.confirmedImpact) {
      // Mostriamo il payload `impact` inline così il client può aprire il
      // dialog senza fare una seconda call.
      const usersAffected = await User.count({
        where: {
          contractType: ct.code,
          role: 'docente',
          monteOreAnnualHoursOverride: null,
        },
      });
      if (usersAffected > 0) {
        return res.status(409).json({
          error: 'Conferma impatto richiesta',
          code: 'IMPACT_CONFIRM_REQUIRED',
          usersAffectedCount: usersAffected,
        });
      }
    }

    await ct.update(fields);

    logger?.info?.(
      {
        actorId: req.user.id,
        contractTypeId: ct.id,
        code: ct.code,
        defaultHoursChange: isDefaultChanging ? { from: oldDefault, to: newDefault } : null,
      },
      '[contract-types] updated',
    );
    res.json({ contractType: ct });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────
// DELETE /:id — soft-delete (admin)
// Bloccato se isSystem=true o se ci sono utenti che usano il code.
// ────────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ct = await ContractType.findByPk(req.params.id);
    if (!ct) return res.status(404).json({ error: 'Tipologia non trovata', code: 'NOT_FOUND' });

    if (ct.isSystem) {
      return res.status(400).json({
        error: 'Tipo di sistema: può essere solo disattivato, non cancellato',
        code: 'IS_SYSTEM',
      });
    }

    const usersUsingIt = await User.count({
      where: { contractType: ct.code },
      paranoid: true,
    });
    if (usersUsingIt > 0) {
      return res.status(409).json({
        error: `Tipologia in uso da ${usersUsingIt} docente/i — riassegnali prima di cancellare`,
        code: 'IN_USE',
        usersAffectedCount: usersUsingIt,
      });
    }

    await ct.destroy();
    logger?.info?.(
      { actorId: req.user.id, contractTypeId: ct.id, code: ct.code },
      '[contract-types] deleted',
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
