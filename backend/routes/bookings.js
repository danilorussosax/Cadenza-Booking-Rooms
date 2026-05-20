'use strict';

const express = require('express');
const { Op, Transaction } = require('sequelize');
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

// I conteggi /usage/me e la disponibilità /availability ragionano su
// "giorno solare" e "settimana ISO" istituzionali (Europe/Rome). Su un
// VPS UTC vicino a mezzanotte italiana il dayStart può cadere il giorno
// prima/dopo, falsando i totali ora.
const DEFAULT_TZ = 'Europe/Rome';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getJwtSecret } = require('../lib/secrets');
const { icalLimiter, recurringBookingLimiter } = require('../middleware/rateLimit');
const { parsePagination, setPaginationHeaders } = require('../lib/pagination');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const {
  sequelize,
  Booking,
  Room,
  User,
  Building,
  Institute,
  Equipment,
  ConcertInfo,
  BookingRecurrence,
} = require('../models');
const recurrenceExpander = require('../services/recurrenceExpander');
const {
  authenticate,
  requireRole,
  requireCompleteProfile,
  requireApproved,
} = require('../middleware/auth');
const {
  validateBooking,
  canCancel,
  createValidationCache,
} = require('../services/bookingValidator');
const { findAlternativesWithTimeout } = require('../services/bookingSuggestions');
const { sendBookingEmail } = require('../services/emailService');
const { buildIcs } = require('../services/icalService');
const { extractClientIp, isIpInCidrList, normalizeIp } = require('../lib/network');
const { isCheckInRequired } = require('../lib/checkInPolicy');

const router = express.Router();

/**
 * Notifica gli admin attivi di una richiesta in attesa di approvazione.
 * Fire-and-forget: errori SMTP non bloccano la creazione della booking.
 */
async function notifyAdminsOfPendingBooking(booking) {
  const admins = await User.findAll({
    where: { role: 'admin', isActive: true },
    attributes: [
      'id',
      'firstName',
      'lastName',
      'email',
      'emailNotifications',
      'notifyOnConfirmation',
    ],
  });
  await Promise.all(
    admins
      .filter((a) => a.email && a.emailNotifications !== false)
      .map((admin) =>
        sendBookingEmail({
          user: admin,
          booking,
          kind: 'booking_pending_admin',
          // requester info embedded nel context: il template legge user.* in
          // intestazione, quindi sostituiamo lo "user" con il richiedente
          // mantenendo l'email di destinazione = admin.email.
          extra: {
            requesterName:
              `${booking.user?.firstName ?? ''} ${booking.user?.lastName ?? ''}`.trim(),
            requesterEmail: booking.user?.email ?? '',
          },
        }).catch(() => {}),
      ),
  );
}

// =====================================================
// GET /api/bookings/ical?token=<icalToken>
// Esporta in iCalendar le prenotazioni confermate dell'utente nei prossimi 90 giorni.
// Auth: query string ?token=<icalToken> (sola lettura) OPPURE Bearer JWT classico.
// Registrato PRIMA di /:id per evitare match come id="ical".
// =====================================================
router.get('/ical', icalLimiter, async (req, res, next) => {
  try {
    let user = null;
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    // Lunghezza token validata prima del lookup: scarta input arbitrari (e
    // limita timing differences nel matching). Il token reale è 48-char hex.
    if (queryToken && queryToken.length >= 32 && queryToken.length <= 128) {
      // Lookup PRIMARIO via hash SHA-256 (campo unique → index hit costante,
      // niente full scan, niente leak del plain in caso di DB dump).
      const hash = crypto.createHash('sha256').update(queryToken).digest('hex');
      user = await User.findOne({ where: { icalTokenHash: hash } });
      // Fallback per token preesistenti il cui backfill non è ancora avvenuto
      // (es. boot in corso). Verrà rimosso in una release successiva.
      if (!user) {
        user = await User.findOne({ where: { icalToken: queryToken } });
      }
    } else if (!queryToken) {
      const auth = req.headers.authorization || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) {
        try {
          const payload = jwt.verify(m[1], getJwtSecret());
          user = await User.findByPk(payload.id);
        } catch {
          user = null;
        }
      }
    }
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Token non valido', code: 'INVALID_TOKEN' });
    }

    const from = dayjs().startOf('day').toDate();
    const to = dayjs().add(90, 'day').endOf('day').toDate();

    const bookings = await Booking.findAll({
      where: {
        userId: user.id,
        status: 'confirmed',
        startTime: { [Op.gte]: from, [Op.lte]: to },
      },
      include: [
        {
          model: Room,
          as: 'room',
          include: [{ model: Building, as: 'building' }],
        },
      ],
      order: [['startTime', 'ASC']],
    });

    const calendar = buildIcs(bookings, { calName: 'Cadenza' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="cadenza.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(calendar);
  } catch (err) {
    next(err);
  }
});

// Isolation level per le scritture su prenotazioni:
// SERIALIZABLE evita race condition sulla rilevazione conflitti
// (validate + insert eseguiti come una sola unità logica).
// SQLite ignora il livello (è già single-writer); Postgres/MySQL lo applicano.
// Postgres può emettere 40001 (serialization_failure) sui commit in conflitto:
// `withSerializableRetry` ritenta con backoff esponenziale fino a 5 volte.
const WRITE_ISOLATION = Transaction.ISOLATION_LEVELS.SERIALIZABLE;
const { withSerializableRetry } = require('../lib/serializableTx');

// =====================================================
// GET /api/bookings
// Filtri: from, to, roomId, userId (admin), mine=true
// =====================================================
router.get('/', authenticate, async (req, res) => {
  const where = {};

  // Date di range: scartiamo silenziosamente input non parsabili per evitare
  // 500 da Sequelize (`Invalid Date` ⇒ "invalid input syntax for type
  // timestamp"). Il filtro semplicemente non si applica se la data è invalida.
  if (req.query.from) {
    const d = new Date(req.query.from);
    if (!Number.isNaN(d.getTime())) where.startTime = { [Op.gte]: d };
  }
  if (req.query.to) {
    const d = new Date(req.query.to);
    if (!Number.isNaN(d.getTime())) where.endTime = { [Op.lte]: d };
  }
  // ID numerici: cast esplicito; se non è un intero, ignoriamo il filtro.
  if (req.query.roomId) {
    const n = Number.parseInt(req.query.roomId, 10);
    if (Number.isInteger(n)) where.roomId = n;
  }
  if (req.query.status) where.status = String(req.query.status);

  if (req.query.mine === 'true') {
    where.userId = req.user.id;
  } else if (req.query.userId && req.user.role === 'admin') {
    const n = Number.parseInt(req.query.userId, 10);
    if (Number.isInteger(n)) where.userId = n;
  }

  // Pagination: default 100, max 500. Su un anno accademico un Conservatorio
  // medio genera 5-15k booking; senza limit la rotta caricava tutto in
  // memoria e serializzava a JSON. Con limit=100 la richiesta è O(constante).
  const { limit, offset } = parsePagination(req.query);
  const { rows, count } = await Booking.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola'],
      },
      {
        model: Room,
        as: 'room',
        include: [
          { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
        ],
      },
      // Includiamo SOLO il titolo: usato dalla weekly view per renderizzare
      // i blocchi concerto. required:false per non escludere le altre booking.
      { model: ConcertInfo, as: 'concertInfo', attributes: ['title'], required: false },
    ],
    order: [['startTime', 'ASC']],
    limit,
    offset,
    distinct: true,
  });
  setPaginationHeaders(res, count, limit, offset);
  res.json({ bookings: rows });
});

// =====================================================
// Check-in (anti ghost-booking) — costanti e config
// =====================================================
//
// Configurabile via env:
//   CHECKIN_EARLY_MINUTES     (default 5)  → quanto prima si può fare check-in
//   GHOST_GRACE_MINUTES       (default 15) → quanto dopo l'inizio scatta l'auto-cancel
const CHECKIN_EARLY_MINUTES = Math.max(0, Number(process.env.CHECKIN_EARLY_MINUTES) || 5);
const GHOST_GRACE_MINUTES = Math.max(1, Number(process.env.GHOST_GRACE_MINUTES) || 15);

// GET /api/bookings/checkin-candidates?roomId=...
//   Le prenotazioni dell'utente loggato in una specifica stanza per le quali
//   è/sarà a breve possibile il check-in. Usato dalla pagina /check-in/room/:id.
//   Registrata PRIMA di /:id per evitare il match dinamico.
router.get('/checkin-candidates', authenticate, async (req, res) => {
  const roomId = Number(req.query.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'roomId mancante', code: 'VALIDATION_FAILED' });
  }

  // Se l'admin ha disattivato il check-in per questa aula (esplicitamente o
  // ereditando da Building.checkInDefault=false) non restituiamo candidati:
  // la pagina /check-in/room/:id mostra il banner "non richiesto" e l'utente
  // non viene indotto a tentare un check-in che il POST /:id/checkin
  // rifiuterebbe comunque.
  const room = await Room.findByPk(roomId, {
    attributes: ['id', 'requireCheckIn'],
    include: [{ model: Building, as: 'building', attributes: ['id', 'checkInDefault'] }],
  });
  if (room && !isCheckInRequired(room)) {
    return res.json({
      bookings: [],
      roomCheckInDisabled: true,
      config: { earlyMinutes: CHECKIN_EARLY_MINUTES, graceMinutes: GHOST_GRACE_MINUTES },
    });
  }

  const now = dayjs();
  const windowStart = now.subtract(GHOST_GRACE_MINUTES, 'minute').toDate();
  const windowEnd = now.add(24, 'hour').toDate();

  const bookings = await Booking.findAll({
    where: {
      roomId,
      userId: req.user.id,
      status: 'confirmed',
      startTime: { [Op.between]: [windowStart, windowEnd] },
    },
    include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    order: [['startTime', 'ASC']],
  });

  res.json({
    bookings,
    config: { earlyMinutes: CHECKIN_EARLY_MINUTES, graceMinutes: GHOST_GRACE_MINUTES },
  });
});

// GET /api/bookings/pending — lista in attesa (admin)
// Registrata PRIMA di /:id per evitare il match dinamico (id="pending"
// causerebbe Booking.findByPk('pending') → Postgres rifiuta integer e
// l'async handler senza next() lascia la richiesta appesa).
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  const bookings = await Booking.findAll({
    where: { status: 'pending_approval' },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'matricola'],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
    order: [['createdAt', 'ASC']],
  });
  res.json({ bookings });
});

// =====================================================
// GET /api/bookings/:id
// =====================================================
router.get('/:id', authenticate, async (req, res, next) => {
  // Guard: id deve essere intero. Senza questo, qualunque slug non numerico
  // (es. una nuova rotta specifica registrata DOPO questa) farebbe esplodere
  // findByPk con "invalid input syntax for integer" e — essendo l'handler
  // async senza try/catch in Express 4 — la richiesta resterebbe appesa.
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
  }
  try {
    const booking = await Booking.findByPk(id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email', 'role'] },
        {
          model: Room,
          as: 'room',
          include: [
            { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
            { model: Equipment, as: 'equipment' },
          ],
        },
      ],
    });
    if (!booking)
      return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
    if (booking.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
    }
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/bookings  - Crea prenotazione
// =====================================================
router.post(
  '/',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  [
    body('roomId').isInt(),
    body('startTime').isISO8601(),
    body('endTime').isISO8601(),
    body('purpose').optional().trim(),
    body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
    body('onBehalfOfUserId').optional({ nullable: true }).isInt(),
  ],
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });

    const { roomId, startTime, endTime, purpose, type, notes, onBehalfOfUserId } = req.body;
    // `owner` dichiarato fuori dal try così resta disponibile nel catch
    // (serve a buildConflictExtras per valutare le suggestion contro il
    // ruolo/permessi dell'utente target nelle prenotazioni on-behalf-of).
    let owner = req.user;

    try {
      // Risolve il proprietario della prenotazione: se admin specifica
      // `onBehalfOfUserId` differente dal proprio id, prenota PER quell'utente.
      // Per gli utenti non-admin il campo viene ignorato silenziosamente.
      const targetId = Number(onBehalfOfUserId);
      const isOnBehalf =
        req.user.role === 'admin' && Number.isInteger(targetId) && targetId !== req.user.id;
      if (isOnBehalf) {
        owner = await User.findByPk(targetId);
        if (!owner) {
          return res
            .status(400)
            .json({ error: 'Utente target non trovato', code: 'USER_NOT_FOUND' });
        }
        if (owner.status !== 'approved' || owner.isActive === false) {
          return res.status(400).json({
            error: 'Utente target non approvato o non attivo',
            code: 'USER_NOT_AVAILABLE',
          });
        }
      }

      // Aula "high-impact" (sala concerti, auditorium): per i non-admin la
      // prenotazione nasce in 'pending_approval' e richiede l'ok di un admin.
      // Gli admin bypassano (creano direttamente 'confirmed') anche quando
      // prenotano per conto di un altro utente.
      const room = await Room.findByPk(roomId);
      const needsApproval = room && room.requiresApproval === true && req.user.role !== 'admin';
      const initialStatus = needsApproval ? 'pending_approval' : 'confirmed';

      const booking = await withSerializableRetry(
        sequelize,
        { isolationLevel: WRITE_ISOLATION },
        async (t) => {
          // Validazione contro l'owner (così rispetta i ruoli/aule consentiti
          // dell'utente target). Quando admin prenota per altri, bypassiamo le
          // quote del target: l'admin si assume la responsabilità della scelta.
          const validation = await validateBooking({
            user: owner,
            roomId,
            startTime,
            endTime,
            type,
            bypassQuotas: isOnBehalf,
            transaction: t,
          });
          if (!validation.valid) {
            const e = new Error(validation.errors[0] || 'Prenotazione non valida');
            e.status = 400;
            e.issues = validation.errors;
            // Propaga il primo `code` strutturato (es. QUOTA_EXCEEDED_*) al
            // middleware errori; fallback BOOKING_INVALID.
            e.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
            throw e;
          }
          return Booking.create(
            {
              userId: owner.id,
              roomId,
              startTime,
              endTime,
              purpose: purpose || null,
              type: type || 'studio_individuale',
              notes: notes || null,
              status: initialStatus,
            },
            { transaction: t },
          );
        },
      );

      const full = await Booking.findByPk(booking.id, {
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'role', 'email', 'emailNotifications'],
          },
          { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        ],
      });
      // fire-and-forget email:
      //   - in attesa di approvazione: mail all'admin (non all'utente)
      //   - confermata: mail all'utente
      if (needsApproval) {
        notifyAdminsOfPendingBooking(full).catch(() => {});
      } else {
        sendBookingEmail({ user: full.user, booking: full, kind: 'confirmation' }).catch(() => {});
      }
      res.status(201).json({ booking: full });
    } catch (err) {
      if (err.status === 400) {
        const isConflict = err.code === 'BOOKING_CONFLICT';
        const extras = isConflict
          ? await buildConflictExtras({ req, owner, roomId, startTime, endTime, type })
          : {};
        return res.status(400).json({
          error: err.message,
          issues: err.issues,
          code: err.code || 'BOOKING_INVALID',
          ...extras,
        });
      }
      if (err.name === 'SequelizeUniqueConstraintError') {
        const extras = await buildConflictExtras({
          req,
          owner,
          roomId,
          startTime,
          endTime,
          type,
        });
        return res.status(409).json({
          error: 'Conflitto: prenotazione già esistente',
          code: 'BOOKING_CONFLICT',
          ...extras,
        });
      }
      if (err.name === 'SequelizeExclusionConstraintError') {
        const extras = await buildConflictExtras({
          req,
          owner,
          roomId,
          startTime,
          endTime,
          type,
        });
        return res.status(409).json({
          error: 'Aula già occupata in questa fascia oraria',
          code: 'BOOKING_CONFLICT',
          ...extras,
        });
      }
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(400).json({
          error: 'Riferimento non valido (aula o utente inesistenti)',
          code: 'FK_CONSTRAINT',
        });
      }
      next(err);
    }
  },
);

// =====================================================
// Helper: arricchisce la response di conflitto con `suggestions` e
// `conflictsWith`. Read-only, hard timeout (vedi findAlternativesWithTimeout),
// fail-soft: in caso di errore restituisce `{ suggestions: [] }`.
//
// Privacy:
//   - studente NON vede mai il nome del proprietario (`ownerLabel: null`)
//   - docente/admin vedono `ownerLabel` per coordinarsi
// =====================================================
async function buildConflictExtras({ req, owner, roomId, startTime, endTime, type }) {
  try {
    const candidateUser = owner || req.user;
    const suggestions = await findAlternativesWithTimeout({
      roomId: Number(roomId),
      startTime,
      endTime,
      type: type || null,
      user: candidateUser,
    });

    let conflictsWith = null;
    try {
      const existing = await Booking.findOne({
        where: {
          roomId: Number(roomId),
          status: 'confirmed',
          [Op.and]: [
            { startTime: { [Op.lt]: new Date(endTime) } },
            { endTime: { [Op.gt]: new Date(startTime) } },
          ],
        },
        attributes: ['id', 'userId'],
      });
      if (existing) {
        const callerRole = req.user?.role;
        const showOwner = callerRole === 'admin' || callerRole === 'docente';
        let ownerLabel = null;
        if (showOwner && existing.userId) {
          const ownerUser = await User.findByPk(existing.userId, {
            attributes: ['firstName', 'lastName'],
          });
          if (ownerUser) {
            ownerLabel = `${ownerUser.firstName ?? ''} ${ownerUser.lastName ?? ''}`.trim() || null;
          }
        }
        conflictsWith = { bookingId: existing.id, ownerLabel };
      }
    } catch {
      conflictsWith = null;
    }

    return { suggestions, conflictsWith };
  } catch {
    return { suggestions: [] };
  }
}

// =====================================================
// POST /api/bookings/bulk-cancel — admin. Broadcast cancel multi-selezione.
// Body: { ids[], reason: string }. Aggiorna status='cancelled' + cancelReason
// e invia email kind='cancellation' a tutti i proprietari coinvolti.
// =====================================================
router.post('/bulk-cancel', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun id fornito' });
    const reason =
      req.body?.reason && typeof req.body.reason === 'string'
        ? req.body.reason.trim().slice(0, 255)
        : "Cancellata dall'amministratore";

    const targets = await Booking.findAll({
      where: { id: { [Op.in]: ids }, status: 'confirmed' },
      attributes: ['id'],
    });
    const targetIds = targets.map((b) => b.id);
    if (targetIds.length === 0) {
      return res.json({ cancelled: 0, skipped: ids.length });
    }

    const now = new Date();
    await Booking.update(
      { status: 'cancelled', cancelledAt: now, cancelReason: reason },
      { where: { id: { [Op.in]: targetIds } } },
    );

    // Email fire-and-forget a ogni utente coinvolto
    const full = await Booking.findAll({
      where: { id: { [Op.in]: targetIds } },
      include: [
        {
          model: User,
          as: 'user',
          attributes: [
            'id',
            'firstName',
            'lastName',
            'role',
            'email',
            'emailNotifications',
            'notifyOnCancellation',
          ],
        },
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      ],
    });
    for (const b of full) {
      sendBookingEmail({ user: b.user, booking: b, kind: 'cancellation' }).catch(() => {});
    }

    res.json({ cancelled: targetIds.length, skipped: ids.length - targetIds.length });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// POST /api/bookings/swap (admin)
// Scambia atomicamente roomId/startTime/endTime tra due prenotazioni
// confermate, future, non checked-in. Copre i 3 casi EasyRoom:
//   - solo aule (stesso giorno+orario, aule diverse)
//   - aula+orario (stessa giornata, durate uguali, orari diversi)
//   - aula+giorno+orario (giorni diversi)
// Body: { aId: number, bId: number }.
// La constraint EXCLUDE su `bookings_no_overlap` garantisce che lo swap
// non crei conflitti reali (rollback automatico). Per by-passare il
// vincolo durante la fase intermedia (entrambe le prenotazioni con i
// dati nuovi prima del commit) flippiamo temporaneamente status='cancelled'
// sulla prima — la constraint è WHERE status='confirmed' AND deletedAt IS NULL
// quindi cancelled non è considerata.
// =====================================================
router.post('/swap', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const aId = Number(req.body?.aId);
    const bId = Number(req.body?.bId);
    if (!aId || !bId || aId === bId) {
      return res.status(400).json({
        error: 'Servono due id distinti (aId e bId)',
        code: 'VALIDATION_FAILED',
      });
    }

    const result = await sequelize.transaction(async (t) => {
      const [a, b] = await Promise.all([
        Booking.findByPk(aId, { transaction: t, lock: t.LOCK.UPDATE }),
        Booking.findByPk(bId, { transaction: t, lock: t.LOCK.UPDATE }),
      ]);
      if (!a || !b) {
        const e = new Error('Prenotazione/i non trovate');
        e.status = 404;
        e.code = 'NOT_FOUND';
        throw e;
      }
      if (a.status !== 'confirmed' || b.status !== 'confirmed') {
        const e = new Error('Entrambe le prenotazioni devono essere confermate');
        e.status = 400;
        e.code = 'INVALID_STATE';
        throw e;
      }
      const now = new Date();
      if (new Date(a.startTime) <= now || new Date(b.startTime) <= now) {
        const e = new Error('Non puoi scambiare prenotazioni iniziate o passate');
        e.status = 400;
        e.code = 'PAST_BOOKING';
        throw e;
      }
      if (a.checkedInAt || b.checkedInAt) {
        const e = new Error('Non puoi scambiare prenotazioni con check-in');
        e.status = 400;
        e.code = 'CHECKED_IN';
        throw e;
      }

      const aOrig = { roomId: a.roomId, startTime: a.startTime, endTime: a.endTime };
      const bOrig = { roomId: b.roomId, startTime: b.startTime, endTime: b.endTime };

      // Step 1: parcheggia A in 'cancelled' temporaneamente (uscendo dalla
      // EXCLUDE constraint che filtra su status='confirmed').
      // Step 2: porta B sui dati di A (slot ora libero).
      // Step 3: riporta A su confirmed con i dati di B.
      // Se uno qualsiasi dei tre step viola constraint o validatori, la
      // tx fa rollback e nessuna delle due viene modificata.
      await a.update({ status: 'cancelled' }, { transaction: t });
      await b.update(aOrig, { transaction: t });
      await a.update({ ...bOrig, status: 'confirmed' }, { transaction: t });
      return { a, b };
    });

    // Reload con join per la response (utile lato UI)
    const [aFull, bFull] = await Promise.all([
      fetchBookingFull(result.a.id),
      fetchBookingFull(result.b.id),
    ]);
    res.json({ a: aFull, b: bFull });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err.name === 'SequelizeExclusionConstraintError') {
      return res.status(409).json({
        error: "Lo scambio creerebbe un conflitto con un'altra prenotazione",
        code: 'BOOKING_CONFLICT',
      });
    }
    next(err);
  }
});

// =====================================================
// Workflow approvazione prenotazioni high-impact (sale concerti, ecc).
// Solo admin. Le pending_approval non bloccano altri slot finché restano in
// attesa (vedi services/bookingValidator.js): l'admin sceglie quale richiesta
// confermare, ed eventuali concorrenti restano in attesa o vengono rifiutate.
// (Nota: GET /pending è registrata sopra, prima di /:id, per ordering Express).
// =====================================================

// GET /api/bookings/pending/count — solo conteggio per badge sidebar.
// Esposto a admin (l'utente normale non lo vede).
router.get('/pending/count', authenticate, requireRole('admin'), async (req, res) => {
  const count = await Booking.count({ where: { status: 'pending_approval' } });
  res.json({ count });
});

// GET /api/bookings/mine/pending — prenotazioni in attesa dell'utente loggato
router.get('/mine/pending', authenticate, async (req, res) => {
  const bookings = await Booking.findAll({
    where: { userId: req.user.id, status: 'pending_approval' },
    include: [{ model: Room, as: 'room', include: [{ model: Building, as: 'building' }] }],
    order: [['startTime', 'ASC']],
  });
  res.json({ bookings });
});

async function fetchBookingFull(id) {
  return Booking.findByPk(id, {
    include: [
      {
        model: User,
        as: 'user',
        attributes: [
          'id',
          'firstName',
          'lastName',
          'role',
          'email',
          'emailNotifications',
          'notifyOnConfirmation',
          'notifyOnCancellation',
        ],
      },
      { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
    ],
  });
}

// POST /api/bookings/:id/approve — admin approva richiesta pending.
// Verifica conflitti al momento dell'approvazione: se nel frattempo è nato
// un confirmed sovrapposto, l'approvazione fallisce con 409.
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await withSerializableRetry(
      sequelize,
      { isolationLevel: WRITE_ISOLATION },
      async (t) => {
        const booking = await Booking.findByPk(req.params.id, { transaction: t });
        if (!booking) {
          const e = new Error('Prenotazione non trovata');
          e.status = 404;
          e.code = 'NOT_FOUND';
          throw e;
        }
        if (booking.status !== 'pending_approval') {
          const e = new Error('La prenotazione non è in attesa di approvazione');
          e.status = 400;
          e.code = 'BOOKING_INVALID_STATE';
          throw e;
        }
        // Conflict check: nessuna confirmed che si sovrapponga sullo stesso roomId.
        const conflict = await Booking.findOne({
          where: {
            roomId: booking.roomId,
            status: 'confirmed',
            id: { [Op.ne]: booking.id },
            [Op.and]: [
              { startTime: { [Op.lt]: booking.endTime } },
              { endTime: { [Op.gt]: booking.startTime } },
            ],
          },
          transaction: t,
        });
        if (conflict) {
          const e = new Error(
            "Slot non più disponibile: nel frattempo è stata confermata un'altra prenotazione",
          );
          e.status = 409;
          e.code = 'BOOKING_CONFLICT';
          throw e;
        }
        await booking.update({ status: 'confirmed' }, { transaction: t });
        return booking;
      },
    );
    const full = await fetchBookingFull(result.id);
    sendBookingEmail({ user: full.user, booking: full, kind: 'booking_approved' }).catch(() => {});
    res.json({ booking: full });
  } catch (err) {
    next(err);
  }
});

// POST /api/bookings/:id/reject — admin rifiuta richiesta pending.
// Body opzionale: { reason: string } salvato in cancelReason per la mail.
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const reason =
      req.body && typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 255) : null;
    const booking = await Booking.findByPk(req.params.id);
    if (!booking)
      return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
    if (booking.status !== 'pending_approval') {
      return res.status(400).json({
        error: 'La prenotazione non è in attesa di approvazione',
        code: 'BOOKING_INVALID_STATE',
      });
    }
    await booking.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || 'Richiesta non approvata',
    });
    const full = await fetchBookingFull(booking.id);
    sendBookingEmail({ user: full.user, booking: full, kind: 'booking_rejected' }).catch(() => {});
    res.json({ booking: full });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// PUT /api/bookings/:id  - Modifica prenotazione
// =====================================================
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const updated = await withSerializableRetry(
      sequelize,
      { isolationLevel: WRITE_ISOLATION },
      async (t) => {
        const booking = await Booking.findByPk(req.params.id, { transaction: t });
        if (!booking) {
          const e = new Error('Prenotazione non trovata');
          e.status = 404;
          throw e;
        }
        const isAdmin = req.user.role === 'admin';
        if (booking.userId !== req.user.id && !isAdmin) {
          const e = new Error('Non autorizzato');
          e.status = 403;
          throw e;
        }
        if (booking.status !== 'confirmed') {
          const e = new Error('Prenotazione non modificabile (già cancellata o conclusa)');
          e.status = 400;
          throw e;
        }

        const newStart = req.body.startTime || booking.startTime;
        const newEnd = req.body.endTime || booking.endTime;
        const newRoomId = req.body.roomId || booking.roomId;

        // Riassegnazione owner: solo admin può cambiare `userId`. Se omesso o
        // uguale, owner resta l'attuale. Validazione usa l'owner risultante per
        // verificare permessi sull'aula (allowedRoles, allowedCourseIds).
        let newOwner = await User.findByPk(booking.userId, { transaction: t });
        const targetUserId = req.body.userId !== undefined ? Number(req.body.userId) : null;
        const isReassign =
          isAdmin && Number.isInteger(targetUserId) && targetUserId !== booking.userId;
        if (isReassign) {
          const candidate = await User.findByPk(targetUserId, { transaction: t });
          if (!candidate) {
            const e = new Error('Utente target non trovato');
            e.status = 400;
            e.code = 'USER_NOT_FOUND';
            throw e;
          }
          if (candidate.status !== 'approved' || candidate.isActive === false) {
            const e = new Error('Utente target non approvato o non attivo');
            e.status = 400;
            e.code = 'USER_NOT_AVAILABLE';
            throw e;
          }
          newOwner = candidate;
        }
        // Admin che agisce su prenotazione altrui (modifica o riassegnazione):
        // bypassa le quote del proprietario per permettere correzioni manuali.
        const adminActingOnOther = isAdmin && newOwner.id !== req.user.id;

        const validation = await validateBooking({
          user: newOwner,
          roomId: newRoomId,
          startTime: newStart,
          endTime: newEnd,
          type: req.body.type ?? booking.type,
          ignoreBookingId: booking.id,
          bypassQuotas: adminActingOnOther,
          transaction: t,
        });
        if (!validation.valid) {
          const e = new Error(validation.errors[0] || 'Modifica non valida');
          e.status = 400;
          e.issues = validation.errors;
          e.code = validation.codes?.find((c) => !!c) || 'BOOKING_INVALID';
          throw e;
        }

        await booking.update(
          {
            startTime: newStart,
            endTime: newEnd,
            roomId: newRoomId,
            userId: isReassign ? newOwner.id : booking.userId,
            purpose: req.body.purpose ?? booking.purpose,
            type: req.body.type ?? booking.type,
            notes: req.body.notes ?? booking.notes,
          },
          { transaction: t },
        );

        return booking;
      },
    );

    res.json({ booking: updated });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.code && { code: err.code }),
        ...(err.issues && { issues: err.issues }),
      });
    }
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Conflitto: prenotazione già esistente' });
    }
    next(err);
  }
});

// =====================================================
// DELETE /api/bookings/:id  - Cancella prenotazione
// =====================================================
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await sequelize.transaction(async (t) => {
      const b = await Booking.findByPk(req.params.id, { transaction: t });
      if (!b) {
        const e = new Error('Prenotazione non trovata');
        e.status = 404;
        throw e;
      }

      const check = await canCancel(req.user, b);
      if (!check.ok) {
        const e = new Error(check.reason);
        e.status = 403;
        throw e;
      }

      await b.update(
        {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: req.body.reason || null,
        },
        { transaction: t },
      );
      return b;
    });
    // Recupero esteso per inviare email
    const full = await Booking.findByPk(booking.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'email', 'emailNotifications'],
        },
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
      ],
    });
    if (full?.user) {
      sendBookingEmail({ user: full.user, booking: full, kind: 'cancellation' }).catch(() => {});
    }
    res.json({ message: 'Prenotazione cancellata', booking });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// =====================================================
// GET /api/bookings/availability/:roomId?date=YYYY-MM-DD
// Restituisce gli slot occupati di un'aula in un giorno
// =====================================================
// (legacy POST /recurring handler rimosso — il nuovo handler unificato è
// definito più sotto in questo stesso file e accetta sia il formato legacy
// `recurrence.weeks` sia il nuovo formato MRBS-style con frequency/byWeekday/
// excludeDates. Vedi la sezione "Prenotazioni ricorrenti — MRBS-style".)
const { BookingRule } = require('../models');
router.post(
  '/recurring_LEGACY_DELETED',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  recurringBookingLimiter,
  // Validazione schema input via express-validator (uniforme col resto del file).
  [
    body('roomId').isInt({ min: 1 }).withMessage('roomId deve essere un intero positivo'),
    body('startTime').isISO8601().withMessage('startTime deve essere ISO 8601'),
    body('endTime').isISO8601().withMessage('endTime deve essere ISO 8601'),
    body('type').optional().isString().isLength({ max: 40 }),
    body('purpose').optional({ nullable: true }).isString().isLength({ max: 255 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('recurrence.weeks')
      .isInt({ min: 2, max: 52 })
      .withMessage('recurrence.weeks deve essere un intero tra 2 e 52'),
  ],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        return res
          .status(400)
          .json({ error: 'Validazione fallita', code: 'VALIDATION_FAILED', details: errs.array() });
      }
      const { roomId, startTime, endTime, type, purpose, notes, recurrence } = req.body;
      const weeks = Number(recurrence.weeks);
      const baseStart = new Date(startTime);
      const baseEnd = new Date(endTime);
      if (baseStart >= baseEnd) {
        return res.status(400).json({
          error: 'startTime deve essere prima di endTime',
          code: 'VALIDATION_FAILED',
        });
      }

      // Verifica policy ruolo: ricorrenze abilitate. Una sola query.
      const rule = await BookingRule.findOne({ where: { role: req.user.role } });
      if (rule && rule.allowRecurring === false) {
        return res.status(403).json({
          code: 'RECURRING_NOT_ALLOWED',
          error: 'Il tuo ruolo non può creare prenotazioni ricorrenti.',
        });
      }

      const bookingType = type || 'studio_individuale';

      // FASE 1 — Validazione: SENZA transazione, in parallelo (5 alla volta
      // per evitare di saturare il pool DB con 52 chiamate in flight).
      // validateBooking è read-only, quindi è safe parallelizzare. Le booking
      // generate dentro questo batch NON si vedranno tra loro al validator,
      // ma weekly+7gg garantisce che non possano sovrapporsi tra di loro.
      const occurrences = [];
      for (let i = 0; i < weeks; i++) {
        const offset = i * 7 * 24 * 60 * 60 * 1000;
        occurrences.push({
          index: i,
          start: new Date(baseStart.getTime() + offset),
          end: new Date(baseEnd.getTime() + offset),
        });
      }

      // Cache request-scoped condivisa tra tutte le validate del batch:
      // BookingRule, BookingQuota[], BookingRuleException[], Room (e
      // Equipment per scopeKind=equipmentType) sono invarianti per la
      // singola request → recuperate UNA volta sola dopo la prima validate.
      // Senza cache: ~10 query × 52 = 520 query. Con cache: ~10 + 52 × 4 ≈ 220.
      const cache = createValidationCache();

      const CONCURRENCY = 5;
      const validationResults = new Array(occurrences.length);
      for (let i = 0; i < occurrences.length; i += CONCURRENCY) {
        const batch = occurrences.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (occ) => {
            try {
              const v = await validateBooking({
                user: req.user,
                roomId,
                startTime: occ.start,
                endTime: occ.end,
                type: bookingType,
                cache,
              });
              validationResults[occ.index] = { occ, validation: v };
            } catch (err) {
              validationResults[occ.index] = {
                occ,
                validation: {
                  valid: false,
                  errors: [err.message || 'Errore di validazione'],
                  codes: ['VALIDATION_ERROR'],
                },
              };
            }
          }),
        );
      }

      const validPayloads = [];
      const skipped = [];
      for (const r of validationResults) {
        if (!r) continue; // safety
        if (r.validation.valid) {
          validPayloads.push({
            userId: req.user.id,
            roomId,
            startTime: r.occ.start,
            endTime: r.occ.end,
            purpose: purpose || null,
            type: bookingType,
            notes: notes || null,
            status: 'confirmed',
          });
        } else {
          skipped.push({
            date: r.occ.start.toISOString().slice(0, 10),
            reason: (r.validation.errors || []).join('; ') || 'Validazione fallita',
            code: r.validation.codes?.find((c) => !!c) || 'BOOKING_INVALID',
          });
        }
      }

      // FASE 2 — UNA SOLA transazione READ COMMITTED per tutti gli INSERT.
      // L'EXCLUDE constraint Postgres `bookings_no_overlap` (vedi
      // lib/preSyncMigrations.js) garantisce no-overlap a livello DB anche
      // sotto race condition. Su SQLite/MySQL test, il validator + check
      // applicativo sono sufficienti.
      // Inseriamo singolarmente per poter gestire fallimenti per-occorrenza
      // (race con altri utenti su EXCLUDE constraint) senza rollbackare tutto.
      const created = [];
      if (validPayloads.length > 0) {
        await sequelize.transaction(async (t) => {
          for (const payload of validPayloads) {
            try {
              const b = await Booking.create(payload, { transaction: t });
              created.push(b.id);
            } catch (err) {
              // Race con altro utente: EXCLUDE constraint o unique violato.
              // Sequelize wrapper sequelize.UniqueConstraintError o
              // SequelizeDatabaseError (Postgres EXCLUDE → 23P01).
              const isOverlapErr =
                err?.name === 'SequelizeUniqueConstraintError' ||
                err?.original?.code === '23P01' ||
                /overlap|exclud/i.test(err?.message || '');
              if (isOverlapErr) {
                skipped.push({
                  date: payload.startTime.toISOString().slice(0, 10),
                  reason: 'Conflitto rilevato a livello DB',
                  code: 'BOOKING_OVERLAP',
                });
              } else {
                throw err; // errore non recuperabile → rollback intera tx
              }
            }
          }
        });
      }

      // FASE 3 — Email post-commit (fire-and-forget, fuori transazione)
      if (created.length > 0) {
        Booking.findAll({
          where: { id: created },
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'firstName', 'lastName', 'email', 'emailNotifications'],
            },
            { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
          ],
        })
          .then((list) => {
            for (const b of list) {
              sendBookingEmail({ user: b.user, booking: b, kind: 'confirmation' }).catch((e) => {
                if (e) {
                  /* swallow: la booking è stata creata, l'email è best-effort */
                }
              });
            }
          })
          .catch(() => {
            /* swallow: notifica via email è fire-and-forget */
          });
      }

      // Ordina skipped per data (può capitare out-of-order dai batch paralleli)
      skipped.sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        created: created.length,
        skipped,
        bookingIds: created,
      });
    } catch (err) {
      next(err);
    }
  },
);

// =====================================================
// GET /api/bookings/usage/me
// Restituisce ore prenotate / residue per l'utente corrente,
// settimanali e giornaliere (settimana ISO lun→dom, giorno odierno).
// =====================================================
router.get('/usage/me', authenticate, async (req, res, next) => {
  try {
    const rule = await BookingRule.findOne({ where: { role: req.user.role } });
    const nowLocal = dayjs().tz(DEFAULT_TZ);
    const weekStart = nowLocal.startOf('isoWeek').toDate();
    const weekEnd = nowLocal.endOf('isoWeek').toDate();
    const dayStart = nowLocal.startOf('day').toDate();
    const dayEnd = nowLocal.endOf('day').toDate();

    // P1-3: caricamento booking con `attributes` selettivi (riduce payload
    // ~80% rispetto al fetch dei record completi) + `roomId` invece di
    // include Room → faremo un singolo round-trip aggiuntivo per Room.type.
    // Una query include con N JOIN per N booking è più costoso di 1 query
    // base + 1 query Room IN (touchedRoomIds).
    const [weekBookings, dayBookings] = await Promise.all([
      Booking.findAll({
        where: {
          userId: req.user.id,
          status: 'confirmed',
          startTime: { [Op.gte]: weekStart, [Op.lte]: weekEnd },
        },
        attributes: ['id', 'roomId', 'startTime', 'endTime'],
      }),
      Booking.findAll({
        where: {
          userId: req.user.id,
          status: 'confirmed',
          startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
        },
        attributes: ['id', 'roomId', 'startTime', 'endTime'],
      }),
    ]);

    const minutesOf = (b) => dayjs(b.endTime).diff(dayjs(b.startTime), 'minute');
    const round1 = (mins) => Math.round(mins / 6) / 10; // minuti → ore con 1 decimale

    const weekUsed = round1(weekBookings.reduce((a, b) => a + minutesOf(b), 0));
    const dayUsed = round1(dayBookings.reduce((a, b) => a + minutesOf(b), 0));
    const isAdmin = req.user.role === 'admin';
    const weekMax = rule?.maxHoursPerWeek ?? null;
    const dayMax = rule?.maxHoursPerDay ?? null;

    // -------- Quote per risorsa: aggregazione consumi per scope --------
    // Recuperiamo le quote attive del ruolo e pre-aggreghiamo i consumi
    // PER TIPO (room.type, equipment.type) UNA SOLA VOLTA. Le quote
    // diventano lookup O(1) sulle Map invece di un O(N×Q) filter+reduce.
    // Per un coordinatore admin con 200 booking/sett × 10 quote attive,
    // passa da ~2000 iterazioni filter a 1 build + 10 lookup.
    const { BookingQuota, Equipment } = require('../models');
    const quotas = await BookingQuota.findAll({
      where: { role: req.user.role, isActive: true },
    });

    // Solo se ci sono quote: altrimenti niente da aggregare.
    let weekMinutesByRoomType = new Map();
    let dayMinutesByRoomType = new Map();
    let weekMinutesByEquipType = new Map();
    let dayMinutesByEquipType = new Map();

    if (quotas.length > 0) {
      // Pre-fetch room types in batch per le stanze toccate.
      const touchedRoomIds = [
        ...new Set([...weekBookings.map((b) => b.roomId), ...dayBookings.map((b) => b.roomId)]),
      ];
      const roomTypeById = new Map();
      const equipByRoom = new Map();
      if (touchedRoomIds.length > 0) {
        // 2 query parallele invece di 2 sequenziali.
        const [rooms, eqs] = await Promise.all([
          Room.findAll({
            where: { id: { [Op.in]: touchedRoomIds } },
            attributes: ['id', 'type'],
          }),
          Equipment.findAll({
            where: { roomId: { [Op.in]: touchedRoomIds } },
            attributes: ['roomId', 'type'],
          }),
        ]);
        for (const r of rooms) roomTypeById.set(r.id, r.type);
        for (const e of eqs) {
          if (!equipByRoom.has(e.roomId)) equipByRoom.set(e.roomId, new Set());
          equipByRoom.get(e.roomId).add(e.type);
        }
      }

      // Aggregazione single-pass: per ogni booking aggiungi i suoi minuti
      // alle Map by-room-type e by-equipment-type. O(N booking × E equip/room),
      // tipicamente E ≤ 5 → O(5N).
      const aggregate = (bookings, mapRoomType, mapEquipType) => {
        for (const b of bookings) {
          const m = minutesOf(b);
          const rt = roomTypeById.get(b.roomId);
          if (rt) {
            mapRoomType.set(rt, (mapRoomType.get(rt) ?? 0) + m);
          }
          const equipTypes = equipByRoom.get(b.roomId);
          if (equipTypes) {
            for (const et of equipTypes) {
              mapEquipType.set(et, (mapEquipType.get(et) ?? 0) + m);
            }
          }
        }
      };
      aggregate(weekBookings, weekMinutesByRoomType, weekMinutesByEquipType);
      aggregate(dayBookings, dayMinutesByRoomType, dayMinutesByEquipType);
    }

    // Pre-calcolato fuori dalla closure per evitare di ricalcolarlo per ogni quota.
    const totalWeekMinutes = weekBookings.reduce((a, b) => a + minutesOf(b), 0);
    const totalDayMinutes = dayBookings.reduce((a, b) => a + minutesOf(b), 0);

    // Lookup O(1) per scope. `global` somma tutto, `roomType`/`equipmentType`
    // chiavato sulle Map pre-aggregate.
    const minutesForQuotaScope = (quota, periodKind) => {
      if (quota.scopeKind === 'global') {
        return periodKind === 'week' ? totalWeekMinutes : totalDayMinutes;
      }
      if (quota.scopeKind === 'roomType') {
        const m = periodKind === 'week' ? weekMinutesByRoomType : dayMinutesByRoomType;
        return m.get(quota.scopeValue) ?? 0;
      }
      if (quota.scopeKind === 'equipmentType') {
        const m = periodKind === 'week' ? weekMinutesByEquipType : dayMinutesByEquipType;
        return m.get(quota.scopeValue) ?? 0;
      }
      return 0;
    };

    const quotaUsage = quotas.map((q) => {
      const usedWeek = q.maxHoursPerWeek > 0 ? round1(minutesForQuotaScope(q, 'week')) : 0;
      const usedDay = q.maxHoursPerDay > 0 ? round1(minutesForQuotaScope(q, 'day')) : 0;
      return {
        id: q.id,
        scopeKind: q.scopeKind,
        scopeValue: q.scopeKind === 'global' ? null : q.scopeValue,
        maxHoursPerWeek: q.maxHoursPerWeek,
        maxHoursPerDay: q.maxHoursPerDay,
        usedHoursWeek: usedWeek,
        usedHoursDay: usedDay,
        remainingHoursWeek:
          q.maxHoursPerWeek > 0
            ? Math.max(0, Math.round((q.maxHoursPerWeek - usedWeek) * 10) / 10)
            : null,
        remainingHoursDay:
          q.maxHoursPerDay > 0
            ? Math.max(0, Math.round((q.maxHoursPerDay - usedDay) * 10) / 10)
            : null,
      };
    });

    // Per comodità del frontend, separiamo le quote per scope in 3 array.
    // Gli admin sono "unlimited" rispetto a BookingRule ma le BookingQuota
    // del loro ruolo, se attive, vengono comunque applicate dal validator
    // (futura politica): le ritorniamo per trasparenza.
    const byRoomType = quotaUsage.filter((q) => q.scopeKind === 'roomType');
    const byEquipment = quotaUsage.filter((q) => q.scopeKind === 'equipmentType');
    const globalQuotas = quotaUsage.filter((q) => q.scopeKind === 'global');

    res.json({
      unlimited: isAdmin,
      // Backward-compat: i due blocchi `weekly` e `daily` non cambiano.
      weekly: {
        max: weekMax,
        usedHours: weekUsed,
        remainingHours:
          weekMax != null && !isAdmin
            ? Math.max(0, Math.round((weekMax - weekUsed) * 10) / 10)
            : null,
        periodFrom: dayjs(weekStart).format('YYYY-MM-DD'),
        periodTo: dayjs(weekEnd).format('YYYY-MM-DD'),
      },
      daily: {
        max: dayMax,
        usedHours: dayUsed,
        remainingHours:
          dayMax != null && !isAdmin ? Math.max(0, Math.round((dayMax - dayUsed) * 10) / 10) : null,
      },
      // Nuovo: aggregazione per quote dinamiche.
      global: globalQuotas,
      byRoomType,
      byEquipment,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/availability/:roomId', authenticate, async (req, res) => {
  const roomId = Number.parseInt(req.params.roomId, 10);
  if (!Number.isInteger(roomId)) {
    return res.status(400).json({ error: 'roomId non valido' });
  }
  // Il parametro `date` è YYYY-MM-DD (calendario italiano). Il filtro
  // [dayStart, dayEnd] deve essere il giorno solare Europe/Rome:
  // un concerto delle 22:30 italiane = 20:30 UTC, su VPS UTC sarebbe
  // fuori da [00:00 UTC, 23:59 UTC] di "ieri".
  const dateStr = req.query.date ? String(req.query.date) : null;
  const parsed = dateStr ? dayjs.tz(dateStr, DEFAULT_TZ) : dayjs().tz(DEFAULT_TZ);
  const date = parsed.isValid() ? parsed : dayjs().tz(DEFAULT_TZ);
  const dayStart = date.startOf('day').toDate();
  const dayEnd = date.endOf('day').toDate();

  const bookings = await Booking.findAll({
    where: {
      roomId,
      status: 'confirmed',
      startTime: { [Op.gte]: dayStart, [Op.lte]: dayEnd },
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'role'] }],
    order: [['startTime', 'ASC']],
  });

  res.json({ date: date.format('YYYY-MM-DD'), bookings });
});

// POST /api/bookings/:id/checkin
//   Marca checkedInAt=now se:
//     - utente è il proprietario
//     - status === 'confirmed'
//     - now è in [startTime - CHECKIN_EARLY_MINUTES, startTime + GHOST_GRACE_MINUTES]
//     - non ancora confermato
//     - body.qrToken (se fornito) matcha Room.qrToken corrente — invalida i QR
//       stampati prima dell'ultima rigenerazione. Se assente, accettato per
//       compat con flow manuale (pulsante "Conferma presenza" senza scansione).
//     - se Institute.checkInRequireInstituteNetwork=true, l'IP del client deve
//       cadere in Institute.instituteNetworkCidrs.
router.post('/:id/checkin', authenticate, async (req, res) => {
  const booking = await Booking.findByPk(req.params.id);
  if (!booking) {
    return res.status(404).json({ error: 'Prenotazione non trovata', code: 'NOT_FOUND' });
  }
  if (booking.userId !== req.user.id) {
    return res.status(403).json({ error: 'Non autorizzato', code: 'FORBIDDEN' });
  }
  if (booking.checkedInAt) {
    return res.status(409).json({
      error: 'Check-in già effettuato',
      code: 'ALREADY_CHECKED_IN',
      checkedInAt: booking.checkedInAt,
    });
  }
  if (booking.status !== 'confirmed') {
    return res.status(400).json({
      error: 'La prenotazione non è confermata',
      code: 'CHECKIN_INVALID_STATUS',
    });
  }

  // Se l'admin ha disabilitato il check-in per questa aula (esplicitamente o
  // ereditando da Building.checkInDefault=false), rifiutiamo a monte: il
  // ghost-cancel sweep già skippa queste booking, ma senza questo guard un
  // client potrebbe comunque chiamare l'endpoint direttamente (es. via QR
  // scansionato prima della disabilitazione).
  const roomMeta = await Room.findByPk(booking.roomId, {
    attributes: ['id', 'qrToken', 'requireCheckIn'],
    include: [{ model: Building, as: 'building', attributes: ['id', 'checkInDefault'] }],
  });
  if (roomMeta && !isCheckInRequired(roomMeta)) {
    return res.status(400).json({
      error: 'Il check-in non è richiesto per questa aula',
      code: 'CHECKIN_NOT_REQUIRED',
    });
  }

  // Validazione token QR (se fornito): se il token non matcha quello corrente
  // dell'aula, il QR è obsoleto (rigenerato dopo la stampa).
  const providedToken =
    req.body && typeof req.body.qrToken === 'string' ? req.body.qrToken.trim() : null;
  if (providedToken) {
    if (!roomMeta || !roomMeta.qrToken || roomMeta.qrToken !== providedToken) {
      return res.status(400).json({
        error: "QR-code non valido o scaduto: chiedere all'admin di stampare il QR aggiornato",
        code: 'CHECKIN_INVALID_QR_TOKEN',
      });
    }
  }

  // Validazione rete d'istituto (se abilitata).
  const institute = await Institute.findOne({
    attributes: ['checkInRequireInstituteNetwork', 'instituteNetworkCidrs'],
    order: [['id', 'ASC']],
  });
  if (institute && institute.checkInRequireInstituteNetwork) {
    const cidrs = Array.isArray(institute.instituteNetworkCidrs)
      ? institute.instituteNetworkCidrs
      : [];
    const clientIp = extractClientIp(req);
    if (cidrs.length === 0 || !isIpInCidrList(clientIp, cidrs)) {
      return res.status(403).json({
        error: "Check-in consentito solo dalla rete d'istituto",
        code: 'CHECKIN_NETWORK_RESTRICTED',
        clientIp: normalizeIp(clientIp),
      });
    }
  }

  const now = dayjs();
  const start = dayjs(booking.startTime);
  const minTime = start.subtract(CHECKIN_EARLY_MINUTES, 'minute');
  const maxTime = start.add(GHOST_GRACE_MINUTES, 'minute');

  if (now.isBefore(minTime)) {
    return res.status(400).json({
      error: `Il check-in apre ${CHECKIN_EARLY_MINUTES} minuti prima dell'inizio`,
      code: 'CHECKIN_TOO_EARLY',
      opensAt: minTime.toISOString(),
    });
  }
  if (now.isAfter(maxTime)) {
    return res.status(400).json({
      error: `Il check-in si chiude ${GHOST_GRACE_MINUTES} minuti dopo l'inizio`,
      code: 'CHECKIN_TOO_LATE',
      closedAt: maxTime.toISOString(),
    });
  }

  // Atomic UPDATE WHERE: due check-in concorrenti non passano entrambi.
  // L'`affected===0` significa che un'altra request ha vinto la race
  // (oppure lo status è cambiato nel frattempo).
  const checkedInAt = new Date();
  const [affected] = await Booking.update(
    { checkedInAt },
    {
      where: {
        id: booking.id,
        checkedInAt: null,
        status: 'confirmed',
      },
    },
  );
  if (affected === 0) {
    return res.status(409).json({
      error: 'Check-in già effettuato',
      code: 'ALREADY_CHECKED_IN',
    });
  }
  booking.checkedInAt = checkedInAt;
  res.json({ booking, message: 'Check-in registrato' });
});

// =====================================================
// Scheda concerto (1:1 con Booking di tipo 'concerto')
// =====================================================
//
//   GET    /api/bookings/:id/concert         → leggi scheda (404 se non esiste)
//   PUT    /api/bookings/:id/concert         → upsert scheda (title obbligatorio)
//   DELETE /api/bookings/:id/concert         → cancella scheda + locandina
//   POST   /api/bookings/:id/concert/poster  → carica locandina (sharp 1200x675 webp)
//   DELETE /api/bookings/:id/concert/poster  → rimuovi locandina
//
// Permessi: owner della booking oppure admin.
// Vincolo: la booking deve avere type = 'concerto'.

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_POSTER_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const POSTER_TARGET_WIDTH = 1200;
const POSTER_TARGET_HEIGHT = 1600; // 3:4 verticale (formato locandina)
const posterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_POSTER_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o HEIC)'));
    }
    cb(null, true);
  },
});

function tryDeleteOldPoster(posterUrl) {
  if (!posterUrl || !posterUrl.startsWith('/storage/')) return;
  const file = path.basename(posterUrl);
  fs.unlink(path.join(UPLOADS_DIR, file), () => {});
}

async function loadConcertContext(bookingId, user) {
  const booking = await Booking.findByPk(bookingId, {
    include: [{ model: ConcertInfo, as: 'concertInfo' }],
  });
  if (!booking)
    return { error: { status: 404, code: 'NOT_FOUND', message: 'Prenotazione non trovata' } };
  if (booking.userId !== user.id && user.role !== 'admin') {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Non autorizzato' } };
  }
  if (booking.type !== 'concerto') {
    return {
      error: {
        status: 400,
        code: 'CONCERT_INVALID_TYPE',
        message: 'La prenotazione non è di tipo concerto',
      },
    };
  }
  return { booking };
}

router.get('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo)
      return res
        .status(404)
        .json({ error: 'Scheda concerto non presente', code: 'CONCERT_NOT_FOUND' });
    res.json({ concertInfo: booking.concertInfo });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });

    const title = (req.body?.title || '').toString().trim();
    if (!title) {
      return res.status(400).json({ error: 'Titolo obbligatorio', code: 'CONCERT_TITLE_REQUIRED' });
    }
    const performers = (req.body?.performers ?? '').toString();
    const program = (req.body?.program ?? '').toString();

    if (booking.concertInfo) {
      await booking.concertInfo.update({ title, performers, program });
      return res.json({ concertInfo: booking.concertInfo });
    }
    const created = await ConcertInfo.create({
      bookingId: booking.id,
      title,
      performers,
      program,
      posterUrl: null,
    });
    res.status(201).json({ concertInfo: created });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/concert', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo) return res.json({ message: 'Nessuna scheda da cancellare' });
    tryDeleteOldPoster(booking.concertInfo.posterUrl);
    await booking.concertInfo.destroy();
    res.json({ message: 'Scheda concerto cancellata' });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/concert/poster',
  authenticate,
  posterUpload.single('file'),
  async (req, res, next) => {
    try {
      const { booking, error } = await loadConcertContext(req.params.id, req.user);
      if (error) return res.status(error.status).json({ error: error.message, code: error.code });
      if (!booking.concertInfo) {
        return res
          .status(400)
          .json({ error: 'Crea prima la scheda concerto', code: 'CONCERT_NOT_FOUND' });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Nessun file caricato', code: 'VALIDATION_FAILED' });
      }
      const processed = await sharp(req.file.buffer)
        .rotate()
        .resize({
          width: POSTER_TARGET_WIDTH,
          height: POSTER_TARGET_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();

      const filename = `concert-${booking.id}-${Date.now()}.webp`;
      await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), processed);
      tryDeleteOldPoster(booking.concertInfo.posterUrl);
      const newUrl = `/storage/${filename}`;
      await booking.concertInfo.update({ posterUrl: newUrl });
      res.json({ concertInfo: booking.concertInfo, posterUrl: newUrl });
    } catch (err) {
      if (err && err.message && /sharp|input|unsupported/i.test(err.message)) {
        return res.status(400).json({
          error: 'Immagine non valida o formato non supportato',
          code: 'FILE_FORMAT_UNSUPPORTED',
        });
      }
      next(err);
    }
  },
);

router.delete('/:id/concert/poster', authenticate, async (req, res, next) => {
  try {
    const { booking, error } = await loadConcertContext(req.params.id, req.user);
    if (error) return res.status(error.status).json({ error: error.message, code: error.code });
    if (!booking.concertInfo) return res.json({ message: 'Nessuna locandina' });
    tryDeleteOldPoster(booking.concertInfo.posterUrl);
    await booking.concertInfo.update({ posterUrl: null });
    res.json({ concertInfo: booking.concertInfo });
  } catch (err) {
    next(err);
  }
});

// =====================================================
// Prenotazioni ricorrenti — POST /bookings/recurring + DELETE serie
// MRBS-style: pattern "eager + group". La richiesta espande la regola in N
// booking individuali, ognuno validato per conflitti, tutti legati alla
// stessa BookingRecurrence row. Cancellazione singola via DELETE /:id come
// per le booking normali; cancellazione di tutta la serie via DELETE su
// /recurrences/:id (cascade).
// =====================================================

/**
 * Helper: notifica admin di creazione serie ricorrente in pending_approval
 * — fire-and-forget come le booking singole. Una sola email per serie.
 */
function notifyAdminsRecurringPending(recurrence, sampleBookingFull) {
  notifyAdminsOfPendingBooking(sampleBookingFull).catch((err) => {
    console.warn('[recurring] notify admins failed:', err.message);
  });
}

/**
 * Shim retro-compat per il formato legacy `recurrence: { weeks: N }`
 * (UI esistente: BookingFormDialog). Lo traduciamo nel formato nuovo
 * MRBS-style PRIMA della validazione, così il resto del handler usa
 * un solo path.
 */
function normalizeRecurrenceInput(recurrence, startTime) {
  if (!recurrence) return null;
  // Formato nuovo: già pronto
  if (recurrence.frequency) return recurrence;
  // Formato legacy weeks=N → weekly per N settimane partendo da startTime
  if (recurrence.weeks) {
    const n = Number(recurrence.weeks);
    // Convenzione legacy: "ripetizione" implica almeno 2 occorrenze
    if (!Number.isInteger(n) || n < 2 || n > 52) return null;
    const start = dayjs(startTime);
    if (!start.isValid()) return null;
    return {
      frequency: 'weekly',
      interval: 1,
      // byWeekday null → recurrenceExpander dedurrà da startDate
      byWeekday: null,
      startDate: start.format('YYYY-MM-DD'),
      endDate: start.add((n - 1) * 7, 'day').format('YYYY-MM-DD'),
    };
  }
  return null;
}

router.post(
  '/recurring',
  authenticate,
  requireApproved,
  requireCompleteProfile,
  recurringBookingLimiter,
  // Normalizza il payload PRIMA della validazione schema: copre sia il
  // formato legacy (recurrence.weeks) sia il nuovo (recurrence.frequency).
  (req, _res, next) => {
    const normalized = normalizeRecurrenceInput(req.body.recurrence, req.body.startTime);
    if (normalized) req.body.recurrence = normalized;
    next();
  },
  [
    body('roomId').isInt(),
    body('startTime').isISO8601(),
    body('endTime').isISO8601(),
    body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
    body('purpose').optional().trim(),
    body('recurrence.frequency').isIn(['daily', 'weekly']),
    body('recurrence.interval').optional().isInt({ min: 1, max: 12 }),
    body('recurrence.byWeekday').optional({ nullable: true }).isArray(),
    body('recurrence.startDate').isISO8601(),
    body('recurrence.endDate').isISO8601(),
    body('recurrence.excludeDates').optional().isArray(),
    body('skipConflicts').optional().isBoolean(),
  ],
  async (req, res, next) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({
        error: 'Validazione fallita',
        code: 'VALIDATION_FAILED',
        details: errs.array(),
      });
    }
    const {
      roomId,
      startTime,
      endTime,
      type,
      purpose,
      notes,
      recurrence,
      skipConflicts = false,
    } = req.body;

    try {
      // Validazione regola + espansione occorrenze. RecurrenceError viene
      // catturato qui sotto e trasformato in 400 con `code` strutturato.
      const rule = recurrenceExpander.validateRule(recurrence);

      // Gate per ruolo: BookingRule.allowRecurring=false → 403
      const userRule = await BookingRule.findOne({ where: { role: req.user.role } });
      if (userRule && userRule.allowRecurring === false) {
        return res.status(403).json({
          error: 'Il tuo ruolo non può creare prenotazioni ricorrenti.',
          code: 'RECURRING_NOT_ALLOWED',
        });
      }

      const occurrences = recurrenceExpander.expandOccurrences(rule, startTime, endTime);
      if (occurrences.length === 0) {
        return res.status(400).json({
          error: 'La regola di ricorrenza non produce alcuna occorrenza',
          code: 'RECURRENCE_EMPTY',
        });
      }

      const room = await Room.findByPk(roomId);
      if (!room) return res.status(400).json({ error: 'Aula non trovata', code: 'ROOM_NOT_FOUND' });
      const needsApproval = room.requiresApproval === true && req.user.role !== 'admin';
      const initialStatus = needsApproval ? 'pending_approval' : 'confirmed';

      // Pre-validazione: lanciamo validateBooking per OGNI occorrenza FUORI
      // dalla transazione (read-only check). Se troviamo conflitti e
      // skipConflicts=false, ritorniamo 409 con lista per UX. Se
      // skipConflicts=true, droppiamo le occorrenze in conflitto e
      // procediamo con le altre.
      const validations = [];
      const cache = createValidationCache();
      for (const occ of occurrences) {
        const v = await validateBooking({
          user: req.user,
          roomId,
          startTime: occ.startTime,
          endTime: occ.endTime,
          type,
          cache,
        });
        validations.push({ occ, valid: v.valid, errors: v.errors, codes: v.codes });
      }

      const conflicts = validations
        .filter((v) => !v.valid)
        .map((v) => ({
          startTime: v.occ.startTime,
          endTime: v.occ.endTime,
          error: v.errors?.[0] || 'Conflitto',
          code: v.codes?.find((c) => !!c) || 'BOOKING_INVALID',
        }));
      const validOccurrences = validations.filter((v) => v.valid).map((v) => v.occ);

      if (conflicts.length > 0 && !skipConflicts) {
        return res.status(409).json({
          error: `${conflicts.length} occorrenze in conflitto`,
          code: 'RECURRENCE_CONFLICTS',
          conflicts,
          validCount: validOccurrences.length,
        });
      }

      if (validOccurrences.length === 0) {
        return res.status(409).json({
          error: 'Tutte le occorrenze sono in conflitto, nessuna creata',
          code: 'RECURRENCE_ALL_CONFLICT',
          conflicts,
        });
      }

      // Crea la serie + tutti i booking in una transazione SERIALIZABLE.
      // Re-validiamo dentro la transazione per chiudere la race window tra
      // la pre-validazione e la insert (qualcuno potrebbe aver prenotato
      // nel frattempo). Se trovo conflitti qui, abort.
      const result = await withSerializableRetry(
        sequelize,
        { isolationLevel: WRITE_ISOLATION },
        async (t) => {
          const series = await BookingRecurrence.create(
            {
              userId: req.user.id,
              roomId,
              frequency: rule.frequency,
              interval: rule.interval,
              byWeekday: rule.byWeekday,
              startDate: rule.startDate,
              endDate: rule.endDate,
              excludeDates: rule.excludeDates,
            },
            { transaction: t },
          );

          const created = [];
          const tCache = createValidationCache();
          for (const occ of validOccurrences) {
            const v = await validateBooking({
              user: req.user,
              roomId,
              startTime: occ.startTime,
              endTime: occ.endTime,
              type,
              cache: tCache,
              transaction: t,
            });
            if (!v.valid) {
              // Race window: skip questa occorrenza, NON falliamo l'intera
              // serie. Logghiamo per visibilità.
              console.warn(
                `[recurring] race conflict skipped: ${occ.startTime.toISOString()} — ${v.errors?.[0]}`,
              );
              continue;
            }
            const b = await Booking.create(
              {
                userId: req.user.id,
                roomId,
                startTime: occ.startTime,
                endTime: occ.endTime,
                purpose: purpose || null,
                type: type || 'studio_individuale',
                notes: notes || null,
                status: initialStatus,
                recurrenceId: series.id,
              },
              { transaction: t },
            );
            created.push(b);
          }

          return { series, created };
        },
      );

      // Email: una conferma per il proprietario riferita alla PRIMA occorrenza
      // (no spam di N email). L'admin riceve UNA notifica di pending se applicabile.
      if (result.created.length > 0) {
        const sample = await Booking.findByPk(result.created[0].id, {
          include: [
            { model: User, as: 'user' },
            { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
          ],
        });
        if (initialStatus === 'pending_approval') {
          notifyAdminsRecurringPending(result.series, sample);
        }
      }

      return res.status(201).json({
        recurrenceId: result.series.id,
        createdCount: result.created.length,
        requestedCount: occurrences.length,
        skipped: conflicts.length,
        conflicts: skipConflicts ? conflicts : [],
        bookingIds: result.created.map((b) => b.id),
        status: initialStatus,
      });
    } catch (err) {
      // RecurrenceError → 400 strutturato (no 500)
      if (err && err.code && /^RECURRENCE_/.test(err.code)) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  },
);

/**
 * DELETE /bookings/recurrences/:id
 *
 * Cancella la serie e tutte le occorrenze FUTURE (>= now). Le occorrenze
 * passate restano in DB con `recurrenceId` valorizzato per storia/audit
 * (la serie viene comunque eliminata: il valore `recurrenceId` punterà
 * a una riga inesistente — accettabile, è solo storia).
 *
 * Solo il proprietario o un admin possono cancellare.
 */
router.delete('/recurrences/:id', authenticate, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });

    const series = await BookingRecurrence.findByPk(id);
    if (!series) return res.status(404).json({ error: 'Serie non trovata' });

    if (series.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato' });
    }

    const now = new Date();
    const futureBookings = await Booking.findAll({
      where: { recurrenceId: id, startTime: { [Op.gte]: now } },
    });
    const cancelledCount = futureBookings.length;

    await sequelize.transaction(async (t) => {
      // Soft-cancel le future occorrenze (status='cancelled') invece di
      // hard-destroy: l'audit/iCal/reminders esistenti devono poterle
      // ancora referenziare per coerenza con il flusso DELETE /:id singolo.
      for (const b of futureBookings) {
        await b.update(
          { status: 'cancelled', cancelledAt: now, cancelReason: 'Cancellazione serie ricorrente' },
          { transaction: t },
        );
      }
      // Hard-destroy della serie: non serve più (occorrenze già marcate)
      await series.destroy({ transaction: t });
    });

    return res.json({ ok: true, cancelledCount });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /bookings/recurrences/:id
 *
 * Dettaglio della serie + lista delle occorrenze (per la pagina dettaglio
 * "La mia serie ricorrente"). Solo proprietario o admin.
 */
router.get('/recurrences/:id', authenticate, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID non valido' });

    const series = await BookingRecurrence.findByPk(id, {
      include: [
        { model: Room, as: 'room', include: [{ model: Building, as: 'building' }] },
        {
          model: Booking,
          as: 'occurrences',
          order: [['startTime', 'ASC']],
          attributes: ['id', 'startTime', 'endTime', 'status', 'cancelledAt'],
        },
      ],
    });
    if (!series) return res.status(404).json({ error: 'Serie non trovata' });
    if (series.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato' });
    }

    return res.json(series);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
