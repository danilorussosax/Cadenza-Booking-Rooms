'use strict';

/**
 * Preview del validator di prenotazione (admin only).
 *
 * Endpoint POST /api/admin/rules/preview
 *
 * Permette all'admin di testare in modo non-distruttivo se una booking
 * "tipica" passerebbe le regole correnti, senza creare la booking.
 *
 * Body: { role, courseId?, roomId, startTime, endTime, type? }
 *
 * Strategia: chiama validateBooking con un fake user senza id reale
 * (id=-1). Le query "consumi pregressi" su quel userId tornano vuote,
 * quindi la simulazione mostra le regole strutturali (fascia oraria,
 * durata, anticipo, conflitti, scope quota su bookings esistenti di
 * altri utenti, eccezioni) ma NON le quote individuali (es.
 * "hai già prenotato 8h questa settimana"). È per design: la preview
 * serve a testare la configurazione, non lo stato di un utente reale.
 *
 * Risposta:
 *   { valid: boolean, errors: string[], codes: (string|null)[] }
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateBooking } = require('../services/bookingValidator');

const router = express.Router();
const VALID_ROLES = ['admin', 'docente', 'studente'];

router.post('/preview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { role, courseId = null, roomId, startTime, endTime } = req.body || {};

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Ruolo non valido', code: 'VALIDATION_FAILED' });
    }
    if (!Number.isInteger(Number(roomId))) {
      return res.status(400).json({ error: 'roomId obbligatorio', code: 'VALIDATION_FAILED' });
    }
    if (!startTime || !endTime) {
      return res
        .status(400)
        .json({ error: 'startTime e endTime obbligatori', code: 'VALIDATION_FAILED' });
    }

    // Fake user: id=-1 → nessuna prenotazione esistente match
    // (le quote individuali non sono testate, vedi commento sopra).
    const fakeUser = {
      id: -1,
      role,
      courseId: courseId ? Number(courseId) : null,
    };

    const result = await validateBooking({
      user: fakeUser,
      roomId: Number(roomId),
      startTime,
      endTime,
    });

    res.json({
      valid: result.valid,
      errors: result.errors,
      codes: result.codes,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
