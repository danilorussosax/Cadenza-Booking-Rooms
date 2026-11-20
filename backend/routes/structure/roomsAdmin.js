'use strict';

const express = require('express');
// Foto aula e rimozione aula.

const multer = require('multer');
const { Room } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const removal = require('../../services/removal');
const storage = require('../../services/storage');

const { domainError, httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// Multer (memory) per le foto delle aule.
// Le immagini caricate vengono ridimensionate con sharp:
//   - aspect ratio 16:9 fisso (1200x675), object-fit:cover
//   - convertite in WEBP qualità 82 per ridurre la dimensione
//   - rimuove EXIF/orientation gestito da sharp.rotate() prima del resize
// =========================================================
const ALLOWED_ROOM_PHOTO_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
];
const roomPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: storage.PROFILES.room.maxBytes }, // 8 MB pre-resize
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ROOM_PHOTO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG, WEBP o HEIC)'));
    }
    cb(null, true);
  },
});

// Helper: rimuovi file foto precedente se gestito da noi (path /storage/…)
function tryDeleteOldRoomPhoto(photoUrl) {
  return storage.removeStored(photoUrl);
}

// Upload foto aula (multipart/form-data, field "file")
// Le immagini vengono ridimensionate a 1200x675 (16:9) WEBP.
router.post(
  '/rooms/:id/photo',
  authenticate,
  requireRole('admin'),
  roomPhotoUpload.single('file'),
  async (req, res, next) => {
    try {
      const room = await Room.findByPk(req.params.id);
      if (!room) throw domainError('NOT_FOUND', 'Aula non trovata', { status: 404 });
      if (!req.file?.buffer) {
        throw domainError('VALIDATION_FAILED', 'Nessun file caricato');
      }

      // Ridimensiona + converte in WEBP (profilo `room`, vedi services/storage).
      const newUrl = await storage.replaceImage(
        room.photoUrl,
        req.file.buffer,
        storage.PROFILES.room,
        { id: room.id },
      );
      await room.update({ photoUrl: newUrl });

      res.json({ room, photoUrl: newUrl });
    } catch (err) {
      // Errori sharp (formato corrotto, ecc.)
      if (storage.isImageFormatError(err)) {
        throw domainError(
          'FILE_FORMAT_UNSUPPORTED',
          'Immagine non valida o formato non supportato',
        );
      }
      next(err);
    }
  },
);

// Rimuovi foto aula
router.delete('/rooms/:id/photo', authenticate, requireRole('admin'), async (req, res) => {
  const room = await Room.findByPk(req.params.id);
  if (!room) throw domainError('NOT_FOUND', 'Aula non trovata', { status: 404 });
  await tryDeleteOldRoomPhoto(room.photoUrl);
  await room.update({ photoUrl: null });
  res.json({ room });
});

router.delete('/rooms/:id', authenticate, requireRole('admin'), async (req, res) => {
  const r = await Room.findByPk(req.params.id);
  if (!r) throw httpError(404, 'Aula non trovata');
  const { removedBookings } = await removal.removeRooms([r.id], { bookings: 'purge' });
  res.json({ message: 'Aula eliminata', removedBookings });
});

module.exports = router;
