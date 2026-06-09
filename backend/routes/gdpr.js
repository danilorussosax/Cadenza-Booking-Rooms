'use strict';

/**
 * Endpoint GDPR per l'utente autenticato.
 *
 *   GET    /export          → Portabilità (art. 20). Restituisce un JSON con
 *                              tutti i dati personali dell'utente: profilo,
 *                              prenotazioni, prestiti, consensi, audit log
 *                              delle proprie azioni.
 *   POST   /delete-request  → Diritto all'oblio (art. 17). Anonimizza l'utente
 *                              e applica il soft-delete (paranoid). I dati
 *                              storici (booking, audit log) restano presenti
 *                              ma in forma non riconducibile all'interessato.
 *   POST   /consent         → Registra/aggiorna un consenso (privacy_policy,
 *                              terms, marketing). Necessario come prova ex
 *                              art. 7 GDPR.
 *   GET    /consent         → Stato consensi attivi dell'utente.
 *
 * Tutti gli endpoint sono autenticati e protetti dal `gdprLimiter` (3/24h)
 * salvo `consent` che ha rate limit baseline.
 *
 * Le richieste vengono inoltre tracciate nell'AuditLog (azione GDPR_*).
 */

const express = require('express');
const crypto = require('crypto');
const {
  sequelize,
  User,
  Booking,
  InstrumentLoan,
  UserConsent,
  AuditLog,
  Room,
  Building,
  Instrument,
  MonteOreProposal,
} = require('../models');
const { authenticate, requireApproved } = require('../middleware/auth');
const { gdprLimiter } = require('../middleware/rateLimit');
const logger = require('../lib/logger');

const router = express.Router();

const VALID_CONSENT_TYPES = ['privacy_policy', 'terms', 'marketing'];

// Helper: scrive una riga di audit "manuale" per le azioni GDPR.
// Il middleware /middleware/audit.js non copre questo path perché
// l'audit GDPR ha targetId = userId (il proprio account) ed è
// un'operazione speciale che vogliamo tracciata anche su 4xx.
async function writeGdprAudit({ req, action, statusCode, payload, response }) {
  try {
    await AuditLog.create({
      actorId: req.user?.id ?? null,
      action,
      targetType: 'gdpr',
      targetId: req.user?.id ?? null,
      path: req.originalUrl,
      statusCode,
      payload: payload ?? null,
      response: response ?? null,
      ip: req.ip || null,
      userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
    });
  } catch (err) {
    // Non bloccare l'operazione per errori di audit
    logger.warn({ err: err.message }, 'gdpr audit log write failed');
  }
}

// =====================================================
// GET /api/users/me/gdpr/export
// =====================================================
router.get('/export', authenticate, requireApproved, gdprLimiter, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [user, bookings, loans, consents, auditEntries] = await Promise.all([
      User.findByPk(userId),
      Booking.findAll({
        where: { userId },
        include: [
          {
            model: Room,
            as: 'room',
            attributes: ['id', 'name', 'floor'],
            include: [{ model: Building, as: 'building', attributes: ['id', 'name'] }],
          },
        ],
        order: [['startTime', 'DESC']],
      }),
      InstrumentLoan.findAll({
        where: { userId },
        include: [{ model: Instrument, as: 'instrument', attributes: ['id', 'name', 'family'] }],
        order: [['createdAt', 'DESC']],
      }),
      UserConsent.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
      }),
      AuditLog.findAll({
        where: { actorId: userId },
        order: [['createdAt', 'DESC']],
        limit: 500,
      }),
    ]);

    const safeUser = user ? user.toSafeJSON() : null;

    const exportPayload = {
      generatedAt: new Date().toISOString(),
      gdprArticle: 'Art. 20 GDPR — Portabilità dei dati',
      profile: safeUser,
      bookings: bookings.map((b) => ({
        id: b.id,
        startTime: b.startTime,
        endTime: b.endTime,
        type: b.type,
        purpose: b.purpose,
        status: b.status,
        room: b.room
          ? {
              id: b.room.id,
              name: b.room.name,
              floor: b.room.floor,
              building: b.room.building
                ? { id: b.room.building.id, name: b.room.building.name }
                : null,
            }
          : null,
        createdAt: b.createdAt,
      })),
      instrumentLoans: loans.map((l) => ({
        id: l.id,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        instrument: l.instrument
          ? {
              id: l.instrument.id,
              name: l.instrument.name,
              family: l.instrument.family,
            }
          : null,
        createdAt: l.createdAt,
      })),
      consents: consents.map((c) => ({
        consentType: c.consentType,
        granted: c.granted,
        policyVersion: c.policyVersion,
        decidedAt: c.createdAt,
      })),
      auditTrail: auditEntries.map((a) => ({
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        statusCode: a.statusCode,
        timestamp: a.createdAt,
      })),
    };

    await writeGdprAudit({
      req,
      action: 'GDPR_EXPORT',
      statusCode: 200,
      response: { bookings: bookings.length, loans: loans.length, consents: consents.length },
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dati-personali-${userId}-${Date.now()}.json"`,
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/users/me/gdpr/delete-request
// Soft-delete + anonimizzazione. Non rimuove le booking (utili per
// analisi aggregate, ferma restando l'indistinguibilità ex art. 4.5):
// userId resta valorizzato ma puntando a un utente con campi anonimizzati
// e deletedAt valorizzato (paranoid).
// =====================================================
router.post('/delete-request', authenticate, gdprLimiter, async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (req.user.role === 'admin') {
      // Un admin non può cancellarsi via self-service: deve essere fatto da
      // un altro admin per evitare lock-out e per garantire una catena
      // di responsabilità.
      await writeGdprAudit({ req, action: 'GDPR_DELETE_DENIED', statusCode: 403 });
      return res.status(403).json({
        error:
          'Gli account amministratore non possono auto-cancellarsi. Contatta un altro amministratore.',
        code: 'ADMIN_SELF_DELETE_FORBIDDEN',
      });
    }

    const result = await sequelize.transaction(async (t) => {
      const user = await User.findByPk(userId, { transaction: t });
      if (!user) {
        const err = new Error('Utente non trovato');
        err.status = 404;
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      // Genera un identificatore anonimo stabile e univoco (rispetta UNIQUE su email).
      // Il dominio .invalid è riservato (RFC 2606) e non risolverà mai → safety.
      const anonSuffix = crypto.randomBytes(6).toString('hex');
      const anonEmail = `deleted_${userId}_${anonSuffix}@anonymized.invalid`;

      await user.update(
        {
          email: anonEmail,
          firstName: 'Utente',
          lastName: 'anonimizzato',
          passwordHash: null,
          matricola: null,
          googleId: null,
          microsoftId: null,
          profilePhotoUrl: null,
          icalTokenHash: null,
          isActive: false,
          emailNotifications: false,
          notifyOnConfirmation: false,
          notifyOnReminder: false,
          notifyOnCancellation: false,
        },
        { transaction: t },
      );

      // Cancella le prenotazioni FUTURE (nessuno deve presentarsi): le passate
      // restano per integrità storica e fini probatori (regolamento prestiti,
      // contestazioni). Sono già "anonime" perché user.firstName/lastName lo sono.
      const now = new Date();
      const cancelledFuture = await Booking.update(
        { status: 'cancelled' },
        {
          where: {
            userId,
            startTime: { [require('sequelize').Op.gt]: now },
            status: ['confirmed', 'pending'],
          },
          transaction: t,
        },
      );

      // User è paranoid: la CASCADE FK non scatta. Eliminiamo a mano le
      // proposte Monte Ore (con schedules/slots/amendments via CASCADE).
      // Coerente con il diritto all'oblio: i piani didattici dell'utente
      // anonimizzato non devono restare nella pagina "Gestione Monte ore".
      const removedMonteOreProposals = await MonteOreProposal.destroy({
        where: { userId },
        transaction: t,
      });

      // Soft-delete dell'utente (paranoid → deletedAt valorizzato).
      await user.destroy({ transaction: t });

      return {
        cancelledFutureBookings: cancelledFuture[0] || 0,
        removedMonteOreProposals,
      };
    });

    await writeGdprAudit({
      req,
      action: 'GDPR_DELETE_OK',
      statusCode: 200,
      response: result,
    });

    logger.info({ userId }, 'gdpr account deletion completed');
    res.json({
      message: 'Account anonimizzato ed eliminato. La sessione è stata invalidata.',
      ...result,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

// =====================================================
// GET /api/users/me/gdpr/consent
// Stato consensi attivi: per ciascun consentType prendiamo l'ultimo record.
// =====================================================
router.get('/consent', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const all = await UserConsent.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });

    const latest = {};
    for (const c of all) {
      if (!latest[c.consentType]) {
        latest[c.consentType] = {
          consentType: c.consentType,
          granted: c.granted,
          policyVersion: c.policyVersion,
          decidedAt: c.createdAt,
        };
      }
    }

    res.json({ consents: latest });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/users/me/gdpr/consent
// Body: { consentType, granted, policyVersion }
// Crea un nuovo record di consenso (mai update — la storia è append-only).
// =====================================================
router.post('/consent', authenticate, async (req, res, next) => {
  try {
    const { consentType, granted, policyVersion } = req.body || {};

    if (!VALID_CONSENT_TYPES.includes(consentType)) {
      return res.status(400).json({
        error: 'consentType non valido',
        code: 'INVALID_CONSENT_TYPE',
      });
    }
    if (typeof granted !== 'boolean') {
      return res.status(400).json({
        error: 'granted deve essere booleano',
        code: 'INVALID_GRANTED',
      });
    }
    const version = (policyVersion || '').toString().trim();
    if (!version || version.length > 40) {
      return res.status(400).json({
        error: 'policyVersion mancante o troppo lunga',
        code: 'INVALID_POLICY_VERSION',
      });
    }

    const consent = await UserConsent.create({
      userId: req.user.id,
      consentType,
      granted,
      policyVersion: version,
      ip: req.ip || null,
      userAgent: (req.get('user-agent') || '').slice(0, 500) || null,
    });

    res.status(201).json({
      consent: {
        consentType: consent.consentType,
        granted: consent.granted,
        policyVersion: consent.policyVersion,
        decidedAt: consent.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
