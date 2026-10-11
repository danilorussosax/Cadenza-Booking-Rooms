'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { Booking, ConcertInfo } = require('../../models');
const { authenticate } = require('../../middleware/auth');

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

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
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

module.exports = function registerConcerts(router) {
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
        return res
          .status(400)
          .json({ error: 'Titolo obbligatorio', code: 'CONCERT_TITLE_REQUIRED' });
      }
      const performers = (req.body?.performers ?? '').toString();
      const program = (req.body?.program ?? '').toString();
      // Campi v1.15: eventType ENUM applicativo, description max 500, language
      // ISO 639-1. NULL ammesso (vincolo facoltativo).
      const allowedTypes = ['concerto', 'saggio', 'masterclass', 'conferenza', 'lezione_aperta'];
      const rawType = req.body?.eventType;
      const eventType =
        rawType == null || rawType === ''
          ? null
          : allowedTypes.includes(String(rawType))
            ? String(rawType)
            : undefined;
      if (eventType === undefined) {
        return res
          .status(400)
          .json({ error: 'eventType non valido', code: 'CONCERT_INVALID_TYPE' });
      }
      const description = req.body?.description ? String(req.body.description).slice(0, 500) : null;
      const rawLang = req.body?.language;
      const language =
        rawLang == null || rawLang === ''
          ? null
          : /^[a-z]{2}$/.test(String(rawLang).toLowerCase())
            ? String(rawLang).toLowerCase()
            : undefined;
      if (language === undefined) {
        return res.status(400).json({
          error: 'language deve essere ISO 639-1 (2 lettere)',
          code: 'CONCERT_INVALID_LANG',
        });
      }

      const payload = { title, performers, program, eventType, description, language };

      if (booking.concertInfo) {
        await booking.concertInfo.update(payload);
        return res.json({ concertInfo: booking.concertInfo });
      }
      const created = await ConcertInfo.create({
        bookingId: booking.id,
        ...payload,
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
};
