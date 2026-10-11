'use strict';

const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getJwtSecret } = require('../../lib/secrets');
const { icalLimiter } = require('../../middleware/rateLimit');
const { parsePagination, setPaginationHeaders } = require('../../lib/pagination');

const {
  Booking,
  Room,
  User,
  Building,
  Institute,
  Equipment,
  ConcertInfo,
} = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { buildIcs } = require('../../services/icalService');
const { isCheckInRequired } = require('../../lib/checkInPolicy');
const { dayjs, CHECKIN_EARLY_MINUTES, GHOST_GRACE_MINUTES } = require('./shared');

module.exports = function registerRead(router) {
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
      } else if (!queryToken) {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m) {
          try {
            // Pin dell'algoritmo (evita alg-confusion) + replica del check
            // tokenVersion del middleware `authenticate`: un JWT revocato
            // (logout, cambio password, bump di tokenVersion) NON deve poter
            // esportare il calendario fino alla scadenza naturale del token.
            const payload = jwt.verify(m[1], getJwtSecret(), { algorithms: ['HS256'] });
            const candidate = await User.findByPk(payload.id);
            const tv = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : -1;
            user = candidate && tv === candidate.tokenVersion ? candidate : null;
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
};
