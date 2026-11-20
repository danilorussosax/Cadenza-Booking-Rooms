'use strict';

const express = require('express');
// QR-code di check-in per aula.

const { Institute, Building, Room } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');

const router = express.Router();
// =========================================================
// QR-code di check-in per aula
//
//   GET    /api/structure/rooms/:id/qr               PNG con URL+token
//   POST   /api/structure/rooms/:id/qr/regenerate    rigenera token
//   POST   /api/structure/rooms/qr/bulk-regenerate   bulk rigenera tutti
//   GET    /api/structure/rooms/qr-overview          lista aule + status QR
//   GET    /api/structure/rooms/qr/download-all      ZIP con i PNG di tutte le aule
//
// L'admin può stampare il PNG e affiggerlo all'ingresso dell'aula. Lo studente,
// dopo aver inquadrato il QR, viene portato a `/check-in/room/:id?t=<token>`.
// Il token è validato lato server al momento del check-in (vedi
// routes/bookings.js POST /:id/checkin) — rigenerare il token invalida tutti
// i QR fisici stampati prima.
// =========================================================
const { buildRoomQrCard } = require('../../services/roomQrCard');
const { buildZip } = require('../../services/zipStore');
const cryptoLib = require('crypto');
const { domainError } = require('../../lib/domainError');

function generateQrToken() {
  // 16 byte → 32 char hex. Spazio ~3.4×10^38, collisione trascurabile.
  return cryptoLib.randomBytes(16).toString('hex');
}

async function ensureRoomQrToken(room) {
  if (room.qrToken && room.qrToken.length >= 16) return room.qrToken;
  const token = generateQrToken();
  room.qrToken = token;
  await room.save();
  return token;
}

function buildQrUrl(req, room) {
  const base =
    process.env.FRONTEND_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/check-in/room/${room.id}?t=${room.qrToken}`;
}

router.get('/rooms/:id/qr', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const room = await Room.findByPk(req.params.id, {
      include: [
        { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
      ],
    });
    if (!room) throw domainError('NOT_FOUND', 'Aula non trovata', { status: 404 });

    await ensureRoomQrToken(room);
    const url = buildQrUrl(req, room);

    // Genera prima di inviare: gli errori restano gestibili dal middleware.
    const png = await buildRoomQrCard({ url, room });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-room-${room.id}.png"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// Nome file sicuro per ZIP/filesystem (niente separatori di percorso o caratteri di controllo).
function safeFileName(value, fallback) {
  const cleaned = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned.slice(0, 80) || fallback;
}

// Scarica in un unico ZIP i PNG di tutte le aule, in una cartella per sede.
router.get('/rooms/qr/download-all', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rooms = await Room.findAll({
      include: [
        { model: Building, as: 'building', include: [{ model: Institute, as: 'institute' }] },
      ],
      order: [
        [{ model: Building, as: 'building' }, 'name', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    if (rooms.length === 0) {
      throw domainError('NOT_FOUND', 'Nessuna aula configurata', { status: 404 });
    }

    const entries = new Array(rooms.length);
    const used = new Set();
    let next_ = 0;
    // Generazione con concorrenza limitata: sharp è CPU-bound.
    const worker = async () => {
      while (next_ < rooms.length) {
        const i = next_++;
        const room = rooms[i];
        await ensureRoomQrToken(room);
        const png = await buildRoomQrCard({ url: buildQrUrl(req, room), room });
        entries[i] = { room, data: png };
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));

    const files = entries.map(({ room, data }) => {
      const folder = safeFileName(room.building?.name, 'Sede');
      const base = safeFileName(
        room.code ? `${room.name} (${room.code})` : room.name,
        `aula-${room.id}`,
      );
      let name = `${folder}/${base}.png`;
      if (used.has(name.toLowerCase())) name = `${folder}/${base} (${room.id}).png`;
      used.add(name.toLowerCase());
      return { name, data };
    });

    const zip = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="qr-aule-${stamp}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(zip);
  } catch (err) {
    next(err);
  }
});

// Rigenera il token QR di una singola aula → invalida i QR stampati prima.
router.post(
  '/rooms/:id/qr/regenerate',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const room = await Room.findByPk(req.params.id);
      if (!room) throw domainError('NOT_FOUND', 'Aula non trovata', { status: 404 });
      room.qrToken = generateQrToken();
      await room.save();
      res.json({
        ok: true,
        roomId: room.id,
        qrTokenUpdatedAt: room.updatedAt,
        url: buildQrUrl(req, room),
      });
    } catch (err) {
      next(err);
    }
  },
);

// Bulk regenerate: rigenera tutti i token in un colpo solo.
router.post(
  '/rooms/qr/bulk-regenerate',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const rooms = await Room.findAll({ attributes: ['id', 'qrToken'] });
      let updated = 0;
      for (const r of rooms) {
        r.qrToken = generateQrToken();
        await r.save();
        updated += 1;
      }
      res.json({ ok: true, updated });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
