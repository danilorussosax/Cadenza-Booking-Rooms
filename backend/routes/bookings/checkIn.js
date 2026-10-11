'use strict';

const { Booking, Room, Building, Institute } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { extractClientIp, isIpInCidrList, normalizeIp } = require('../../lib/network');
const { isCheckInRequired } = require('../../lib/checkInPolicy');
const { dayjs, CHECKIN_EARLY_MINUTES, GHOST_GRACE_MINUTES } = require('./shared');

module.exports = function registerCheckIn(router) {
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
};
