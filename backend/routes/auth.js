'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const passport = require('../config/passport');
const { OAuthDomainNotAllowedError } = require('../config/passport');
const { body, validationResult } = require('express-validator');
const { User, Course } = require('../models');
const { authenticate, signToken } = require('../middleware/auth');
const logger = require('../lib/logger');
const {
  loginLimiter,
  registerLimiter,
  tfaVerifyLimiter,
  tfaResendLimiter,
  passwordResetRequestLimiter,
  passwordResetConfirmLimiter,
} = require('../middleware/rateLimit');
const twoFa = require('../services/twoFa');
const emailService = require('../services/emailService');
const { sendSecurityEmail } = emailService;
const { PasswordResetToken, Institute } = require('../models');
const dayjs = require('dayjs');
const { Op } = require('sequelize');

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// =====================================================
// Multer: upload della foto profilo su backend/uploads
// =====================================================
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_PHOTO_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
// Mappa MIME → extension canonica: l'estensione del file salvato deriva dal
// MIME (verificato), non da `originalname` (controllabile dall'attaccante).
const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      // Estensione decisa dal MIME (server-side), non da originalname:
      // evita upload di `evil.html` con MIME image/png che servirebbe HTML.
      const ext = MIME_TO_EXT[file.mimetype] ?? '.png';
      cb(null, `user-${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PHOTO_MIME.includes(file.mimetype)) {
      return cb(new Error('Formato non supportato (usa PNG, JPG o WEBP)'));
    }
    // Doppia verifica: anche l'estensione di originalname deve essere
    // immagine (difesa-in-profondità contro upload con MIME spoofato).
    const claimedExt = path.extname(file.originalname || '').toLowerCase();
    if (claimedExt && !ALLOWED_PHOTO_EXT.has(claimedExt)) {
      return cb(new Error('Estensione non valida'));
    }
    cb(null, true);
  },
});

// Helper: rimuovi file foto profilo precedente se gestito da noi (path /storage/…)
function tryDeleteOldPhoto(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/storage/')) return;
  const file = path.basename(photoUrl);
  const fp = path.join(UPLOADS_DIR, file);
  fs.unlink(fp, () => {});
}

// =====================================================
// POST /api/auth/register  - Registrazione locale
// =====================================================
// Password policy: minimo 10 caratteri, almeno una maiuscola E almeno un
// numero. Resa più stringente delle 8 cifre originali per rispettare le
// raccomandazioni AGID 2024 sui sistemi PA. Non richiediamo simboli
// (UX trade-off: gli utenti tendono a scegliere `Password1!`).
const PASSWORD_MIN_LEN = 10;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

router.post(
  '/register',
  registerLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password')
      .isLength({ min: PASSWORD_MIN_LEN })
      .withMessage(`Password di almeno ${PASSWORD_MIN_LEN} caratteri`)
      .matches(PASSWORD_REGEX)
      .withMessage('La password deve contenere almeno una maiuscola e un numero'),
    body('firstName').notEmpty().trim().isLength({ max: 100 }),
    body('lastName').notEmpty().trim().isLength({ max: 100 }),
    body('matricola').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('courseId').optional({ nullable: true }).isInt(),
    body('role').optional().isIn(['docente', 'studente']),
  ],
  async (req, res, next) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) {
        return res.status(400).json({
          error: 'Validazione fallita',
          code: 'VALIDATION_FAILED',
          details: errs.array(),
        });
      }

      const { email, password, firstName, lastName, matricola, courseId, role } = req.body;

      // Verifica corso (se fornito) — fast-fail se il corso non esiste/è inattivo.
      // Il vincolo FK a livello DB scatterebbe comunque, ma con errore 500
      // generico — qui restituiamo 400 con code esplicito per UX migliore.
      if (courseId) {
        const course = await Course.findByPk(courseId);
        if (!course || !course.isActive) {
          return res.status(400).json({ error: 'Corso non valido', code: 'COURSE_INVALID' });
        }
      }

      // Stato iniziale:
      //   - studente con profilo già completo (matricola + corso) → approved
      //   - studente con dati mancanti                            → pending (completerà profilo)
      //   - docente                                               → pending (richiede approvazione admin)
      const finalRole = role || 'studente';
      let initialStatus = 'pending';
      if (finalRole === 'studente' && matricola && courseId) {
        initialStatus = 'approved';
      }

      // Affidiamo la verifica univocità a Sequelize/DB anziché a un
      // findOne+create separati: elimina la race window (due richieste
      // concorrenti con stessa email che superavano entrambe il check
      // findOne e poi una falliva al create). Cattura SequelizeUniqueConstraintError
      // sotto e mappa al codice corretto.
      let user;
      try {
        user = await User.create({
          email,
          passwordHash: password, // hashata dal hook beforeCreate
          firstName,
          lastName,
          matricola: matricola || null,
          courseId: courseId || null,
          role: finalRole,
          status: initialStatus,
        });
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError') {
          // Sequelize espone l'array `errors` con `path` del campo che ha
          // collisionato. Distinguamo email vs matricola per UX.
          const fields = Array.isArray(err.errors) ? err.errors.map((e) => e.path) : [];
          if (fields.includes('email')) {
            return res
              .status(409)
              .json({ error: 'Email già registrata', code: 'EMAIL_ALREADY_REGISTERED' });
          }
          if (fields.includes('matricola')) {
            return res
              .status(409)
              .json({ error: 'Matricola già registrata', code: 'MATRICOLA_ALREADY_USED' });
          }
          return res.status(409).json({
            error: 'Vincolo di unicità violato',
            code: 'UNIQUE_CONSTRAINT',
            fields,
          });
        }
        throw err;
      }

      const token = signToken(user);
      res.status(201).json({ token, user: user.toSafeJSON() });
    } catch (err) {
      // Logger strutturato (pino) invece di console.error — finisce in Sentry
      // e include request-id per correlation. Il middleware di errore globale
      // gestisce la response (500 generico) preservando lo stack lato server.
      logger.error({ err, route: '/api/auth/register' }, 'register failed');
      next(err);
    }
  },
);

// =====================================================
// POST /api/auth/login  - Login locale
// =====================================================
// Helper: genera challenge 2FA, salva in DB, manda email all'utente.
// Restituisce { ok, sentTo, expiresInMinutes } o { ok: false, error }.
async function issueAndSendTwoFaCode(user, purpose) {
  const issuer = process.env.TWO_FA_ISSUER || 'Cadenza';
  const { code, record } = await twoFa.createChallenge(purpose);
  user.twoFaChallenge = record;
  await user.save();
  const subject = `${issuer} · Codice di accesso`;
  const expires = twoFa.TWO_FA_TTL_MIN;
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;">
      <h1 style="font-size:18px;color:#3762aa;margin:0 0 12px;">Codice di verifica · ${issuer}</h1>
      <p style="color:#1a2234;font-size:14px;margin:0 0 16px;">Ciao ${escapeHtml(user.firstName || '')},</p>
      <p style="color:#1a2234;font-size:14px;margin:0 0 16px;">Inserisci questo codice per ${
        purpose === 'enroll' ? 'attivare la verifica in due passaggi' : "completare l'accesso"
      }. Il codice scade tra <b>${expires} minuti</b> e può essere usato una sola volta.</p>
      <div style="margin:20px 0;text-align:center;">
        <span style="display:inline-block;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;letter-spacing:10px;font-weight:700;color:#1a2234;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:14px 22px;">${code}</span>
      </div>
      <p style="color:#6b7a90;font-size:12px;margin:0 0 8px;">Se non hai richiesto tu questo codice, ignora questa email — qualcuno potrebbe aver provato ad accedere al tuo account. Considera anche di cambiare la password.</p>
      <p style="color:#9aa5b4;font-size:11px;margin-top:24px;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">${issuer} · email automatica</p>
    </div>
  </body></html>`;
  const result = await sendSecurityEmail({ to: user.email, subject, html });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    sentTo: twoFa.maskEmail(user.email),
    expiresInMinutes: expires,
  };
}

// Escape HTML inline (replicato qui per non esporre la versione di emailService).
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Account lockout — difesa contro brute force distribuito (botnet su molti IP
// vs lo stesso account, che il rate-limit per IP non ferma).
// Configurabile via env:
//   LOCKOUT_MAX_FAILED   = 10  (tentativi consecutivi prima del lockout)
//   LOCKOUT_DURATION_MIN = 30  (durata lockout in minuti)
const LOCKOUT_MAX_FAILED = Math.max(1, Number(process.env.LOCKOUT_MAX_FAILED) || 10);
const LOCKOUT_DURATION_MIN = Math.max(1, Number(process.env.LOCKOUT_DURATION_MIN) || 30);

router.post('/login', loginLimiter, (req, res, next) => {
  // Pre-check lockout PRIMA di passport.authenticate per non sprecare bcrypt
  // su account lockati (DoS amplification). Lookup per email (case-insensitive).
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;

  (async () => {
    if (email) {
      const candidate = await User.findOne({
        where: { email },
        attributes: ['id', 'lockedUntil', 'failedLoginAttempts'],
      });
      if (candidate?.lockedUntil && candidate.lockedUntil > new Date()) {
        return res.status(423).json({
          error: 'Account temporaneamente bloccato per troppi tentativi falliti',
          code: 'ACCOUNT_LOCKED',
          retryAfterMinutes: Math.ceil((candidate.lockedUntil - new Date()) / 60000),
        });
      }
    }

    passport.authenticate('local', { session: false }, async (err, user, info) => {
      if (err) return res.status(500).json({ error: 'Errore interno' });
      if (!user) {
        // Risposta uniforme per tutti i casi di failure (password sbagliata,
        // email non registrata, account disabilitato): codici/messaggi
        // distinti permettevano di enumerare email registrate.
        //
        // Eccezione deliberata: i due code PASSWORD_NOT_SET (utente importato
        // da Isidata che non ha ancora completato il setup tramite magic-link)
        // e OAUTH_ONLY (account che usa solo Google/Microsoft) vengono
        // propagati al frontend per mostrare il CTA giusto. Rilassano
        // l'anti-enumeration ma per il target Conservatorio (perimetro
        // chiuso, ~500 utenti noti) il rischio è basso e il guadagno UX
        // elevato (gli studenti capiscono perché non possono entrare).
        //
        // Account lockout: incrementa il contatore SOLO se l'email matcha un
        // utente esistente (con password locale). Altrimenti chiunque potrebbe
        // lockare arbitrariamente: sapendo l'email + ripetendo password sbagliata.
        if (email) {
          const target = await User.findOne({
            where: { email },
            attributes: ['id', 'passwordHash', 'failedLoginAttempts'],
          });
          if (target?.passwordHash) {
            const next = (target.failedLoginAttempts ?? 0) + 1;
            const update = { failedLoginAttempts: next };
            if (next >= LOCKOUT_MAX_FAILED) {
              update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MIN * 60_000);
              logger.warn(
                { userId: target.id, attempts: next, lockedUntil: update.lockedUntil },
                'account locked: max failed login attempts reached',
              );
            }
            await User.update(update, { where: { id: target.id } });
          }
        }
        if (info?.code === 'PASSWORD_NOT_SET' || info?.code === 'OAUTH_ONLY') {
          return res.status(401).json({
            error: info.message || 'Email o password non validi',
            code: info.code,
          });
        }
        return res.status(401).json({
          error: 'Email o password non validi',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // Login OK — reset contatori lockout
      if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        await User.update(
          { failedLoginAttempts: 0, lockedUntil: null },
          { where: { id: user.id } },
        );
      }

      // 2FA — se l'utente ha attivato la verifica in due passaggi via email,
      // generiamo subito una challenge e mandiamo il codice via email.
      // Restituiamo tempToken (5min) + maschera email + scadenza.
      if (user.twoFaEnabled) {
        const send = await issueAndSendTwoFaCode(user, 'login');
        if (!send.ok) {
          // SMTP down: NON emettiamo tempToken. Senza di esso l'attaccante
          // non ha materiale di sessione su cui iterare /verify o /resend.
          // L'utente legittimo riproverà il login appena la mail risale.
          return res.status(503).json({
            error: 'Impossibile inviare il codice 2FA. Riprova tra qualche istante.',
            code: 'TWO_FA_SEND_FAILED',
            sentTo: twoFa.maskEmail(user.email),
          });
        }
        const tempToken = twoFa.signPre2faToken(user.id);
        return res.json({
          needsTwoFa: true,
          tempToken,
          sentTo: send.sentTo,
          expiresInMinutes: send.expiresInMinutes,
        });
      }

      user.lastLogin = new Date();
      await user.save();

      const token = signToken(user);
      res.json({ token, user: user.toSafeJSON() });
    })(req, res, next);
  })().catch(next);
});

// =====================================================
// GET /api/auth/me  - Profilo utente corrente
// =====================================================
router.get('/me', authenticate, async (req, res) => {
  const user = await User.findByPk(req.user.id, {
    include: [{ model: Course, as: 'course' }],
  });
  res.json({ user: user.toSafeJSON() });
});

// =====================================================
// PATCH /api/auth/me  - Completa/aggiorna profilo
// (necessario dopo login OAuth se mancano matricola/corso)
// =====================================================
router.patch(
  '/me',
  authenticate,
  [
    // `.optional({ nullable: true })` su tutti i campi: il frontend invia
    // esplicitamente `null` per rimuovere il valore (es. utente che svuota
    // il campo Corso → courseId=null). Senza il flag, express-validator
    // considera null come "valore presente" e fa fallire le validazioni
    // tipate sotto (.isInt, .notEmpty, ...). Questo era un bug: il bottone
    // "Salva modifiche" tornava 400 silenziosamente per gli utenti senza
    // courseId (admin, alcuni docenti).
    body('matricola').optional({ nullable: true }).trim(),
    body('courseId').optional({ nullable: true }).isInt(),
    body('firstName').optional({ nullable: true }).trim().notEmpty(),
    body('lastName').optional({ nullable: true }).trim().notEmpty(),
    body('emailNotifications').optional({ nullable: true }).isBoolean(),
    body('notifyOnConfirmation').optional({ nullable: true }).isBoolean(),
    body('notifyOnReminder').optional({ nullable: true }).isBoolean(),
    body('notifyOnCancellation').optional({ nullable: true }).isBoolean(),
    // role NON è qui: il cambio ruolo passa sempre da /api/users/:id (admin).
    // Permettere il flip da /me era una liability per gli account pending
    // (un docente in coda poteva diventare studente e auto-approvarsi).
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty())
      return res.status(400).json({ error: 'Validazione fallita', details: errs.array() });

    const {
      matricola,
      courseId,
      firstName,
      lastName,
      emailNotifications,
      notifyOnConfirmation,
      notifyOnReminder,
      notifyOnCancellation,
    } = req.body;

    if (courseId) {
      const course = await Course.findByPk(courseId);
      if (!course || !course.isActive) {
        return res.status(400).json({ error: 'Corso non valido', code: 'COURSE_INVALID' });
      }
    }

    if (matricola && matricola !== req.user.matricola) {
      const matExists = await User.findOne({ where: { matricola } });
      if (matExists)
        return res
          .status(409)
          .json({ error: 'Matricola già registrata', code: 'MATRICOLA_ALREADY_USED' });
    }

    if (matricola !== undefined) req.user.matricola = matricola || null;
    if (courseId !== undefined) req.user.courseId = courseId;
    if (firstName) req.user.firstName = firstName;
    if (lastName) req.user.lastName = lastName;
    if (typeof emailNotifications === 'boolean') req.user.emailNotifications = emailNotifications;
    if (typeof notifyOnConfirmation === 'boolean')
      req.user.notifyOnConfirmation = notifyOnConfirmation;
    if (typeof notifyOnReminder === 'boolean') req.user.notifyOnReminder = notifyOnReminder;
    if (typeof notifyOnCancellation === 'boolean')
      req.user.notifyOnCancellation = notifyOnCancellation;

    // Transizione di stato dopo la compilazione del profilo:
    //   - studente con matricola + corso              → approved (auto)
    //   - docente con corso                            → pending (attende admin)
    //   - admin                                        → invariato (sempre approved)
    if (
      req.user.role !== 'admin' &&
      req.user.status !== 'approved' &&
      req.user.status !== 'rejected'
    ) {
      if (req.user.role === 'studente') {
        if (!req.user.matricola) {
          return res.status(400).json({
            error: 'La matricola è obbligatoria per gli studenti',
            code: 'MATRICOLA_REQUIRED',
          });
        }
        if (!req.user.courseId) {
          return res.status(400).json({
            error: 'Il corso è obbligatorio',
            code: 'COURSE_REQUIRED',
          });
        }
        req.user.status = 'approved';
      } else if (req.user.role === 'docente') {
        if (!req.user.courseId) {
          return res.status(400).json({
            error: 'Il corso è obbligatorio',
            code: 'COURSE_REQUIRED',
          });
        }
        // resta 'pending' in attesa dell'amministratore
      }
    }

    await req.user.save();

    res.json({ user: req.user.toSafeJSON() });
  },
);

// =====================================================
// POST /api/auth/me/photo  - Upload foto profilo
// (multipart/form-data, field name "file")
// =====================================================
router.post('/me/photo', authenticate, photoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
  tryDeleteOldPhoto(req.user.profilePhotoUrl);
  const newUrl = `/storage/${req.file.filename}`;
  req.user.profilePhotoUrl = newUrl;
  await req.user.save();
  res.json({ user: req.user.toSafeJSON(), profilePhotoUrl: newUrl });
});

// =====================================================
// DELETE /api/auth/me/photo  - Rimuovi foto profilo
// =====================================================
router.delete('/me/photo', authenticate, async (req, res) => {
  tryDeleteOldPhoto(req.user.profilePhotoUrl);
  req.user.profilePhotoUrl = null;
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
});

// =====================================================
// GET /api/auth/ical-token  - Recupera (o crea) il token per la sottoscrizione iCal
// POST /api/auth/ical-token - Rigenera il token (invalida il precedente)
// Token a sola lettura, senza scadenza, legato a userId.
// =====================================================
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function ensureIcalToken(user) {
  if (user.icalToken) {
    // Token preesistente: assicura che l'hash sia popolato (utenti
    // migrati dal vecchio schema potrebbero avere solo il plain).
    if (!user.icalTokenHash) {
      user.icalTokenHash = sha256Hex(user.icalToken);
      await user.save();
    }
    return user.icalToken;
  }
  const plain = crypto.randomBytes(32).toString('hex');
  user.icalToken = plain;
  user.icalTokenHash = sha256Hex(plain);
  await user.save();
  return plain;
}

router.get('/ical-token', authenticate, async (req, res) => {
  const token = await ensureIcalToken(req.user);
  res.json({ token });
});

router.post('/ical-token', authenticate, async (req, res) => {
  const plain = crypto.randomBytes(32).toString('hex');
  req.user.icalToken = plain;
  req.user.icalTokenHash = sha256Hex(plain);
  await req.user.save();
  res.json({ token: plain });
});

// =====================================================
// POST /api/auth/change-password  - Cambio password
// =====================================================
router.post(
  '/change-password',
  authenticate,
  [body('currentPassword').optional(), body('newPassword').isLength({ min: 8 })],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: 'Password troppo corta' });

    const { currentPassword, newPassword } = req.body;

    if (req.user.passwordHash) {
      const ok = await req.user.verifyPassword(currentPassword || '');
      if (!ok)
        return res.status(401).json({ error: 'Password attuale errata', code: 'WRONG_PASSWORD' });
    }

    req.user.passwordHash = newPassword;
    // Bump della tokenVersion: il client che ha appena cambiato password
    // dovrà rifare login. È la prassi: una password compromessa è ancora
    // sfruttabile finché restano JWT validi firmati con la vecchia.
    req.user.tokenVersion = (req.user.tokenVersion ?? 0) + 1;
    await req.user.save();

    // Riemettiamo subito un nuovo token al client che ha appena fatto il
    // cambio: il vecchio è stato invalidato dal bump → senza questo, il
    // client riceverebbe 401 alla prossima richiesta. UX più pulita.
    const token = signToken(req.user);
    res.json({ message: 'Password aggiornata', token });
  },
);

// =====================================================
// POST /api/auth/logout  -  Invalida le sessioni dell'utente
// =====================================================
//
// "Logout effettivo" lato server: incrementa tokenVersion così TUTTI i JWT
// emessi finora (questo dispositivo + altri device su cui l'utente fosse
// loggato) diventano immediatamente invalidi. Il client dopo questa chiamata
// deve scartare il token locale e portare l'utente al /login.
//
// Idempotente: chiamare logout senza essere loggati ritorna 401 (richiediamo
// authenticate); il client gestisce la pulizia comunque tramite l'interceptor.
router.post('/logout', authenticate, async (req, res) => {
  req.user.tokenVersion = (req.user.tokenVersion ?? 0) + 1;
  await req.user.save();
  res.json({ message: 'Logout effettuato' });
});

// =====================================================
// 2FA via codice EMAIL — endpoints
//
// Flusso enrollment:
//   1. Utente loggato chiama POST /2fa/setup → backend genera codice 6 cifre,
//      lo invia via email all'indirizzo dell'utente, salva l'hash + scadenza
//      in DB. NON attiva ancora il 2FA.
//   2. Utente inserisce il codice → POST /2fa/verify { code } con Bearer →
//      enrollment confirm: twoFaEnabled=true + restituisce 10 recovery codes
//      in chiaro (UNICA occasione).
//
// Flusso login (utente con 2FA attivo):
//   1. POST /login con email+password → backend genera challenge + manda
//      email AUTOMATICAMENTE → 200 { needsTwoFa: true, tempToken, sentTo }.
//   2. Utente inserisce il codice ricevuto → POST /2fa/verify
//      { tempToken, code } → 200 { token, user } finale.
//   3. Resend: POST /2fa/resend { tempToken } rigenera + rimanda email
//      (rate-limit: una nuova challenge invalida la precedente).
//
// Recovery code: in alternativa al codice email, su /2fa/verify e /2fa/disable
// l'utente può presentare uno dei 10 recovery codes (single-use).
// =====================================================

// POST /api/auth/2fa/setup — auth richiesta. Genera codice + manda email.
// NON attiva: la conferma avviene su /2fa/verify.
//
// Rate limit (P1-8): un attaccante con un Bearer legittimo (sessione rubata
// o token leak via XSS) può chiamare /2fa/setup ripetutamente per generare
// flood di email all'indirizzo della vittima — non attiva il 2FA, ma
// "spam-as-a-feature" tramite il nostro SMTP. tfaResendLimiter applica lo
// stesso budget di 5 tentativi/15min/utente già usato su /2fa/resend.
router.post('/2fa/setup', authenticate, tfaResendLimiter, async (req, res, next) => {
  try {
    const send = await issueAndSendTwoFaCode(req.user, 'enroll');
    if (!send.ok) {
      return res.status(503).json({
        error: 'Impossibile inviare il codice via email. Verifica la configurazione SMTP.',
        code: 'TWO_FA_SEND_FAILED',
      });
    }
    res.json({ sentTo: send.sentTo, expiresInMinutes: send.expiresInMinutes });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/resend — rigenera codice e manda di nuovo l'email.
// Duale: con Bearer (resend in fase di enrollment) oppure body.tempToken
// (resend in fase di login step 2).
router.post('/2fa/resend', tfaResendLimiter, async (req, res, next) => {
  try {
    const { tempToken } = req.body ?? {};
    let user;
    let purpose;
    if (tempToken) {
      let payload;
      try {
        payload = twoFa.verifyPre2faToken(tempToken);
      } catch {
        return res
          .status(401)
          .json({ error: 'Token temporaneo non valido o scaduto', code: 'TWO_FA_BAD_TEMP_TOKEN' });
      }
      user = await User.findByPk(payload.id);
      if (!user || !user.twoFaEnabled) {
        return res
          .status(400)
          .json({ error: 'Stato 2FA inconsistente', code: 'TWO_FA_INVALID_STATE' });
      }
      purpose = 'login';
    } else {
      // Fallback: resend in enrollment richiede Bearer.
      return authenticate(req, res, async () => {
        const send = await issueAndSendTwoFaCode(req.user, 'enroll');
        if (!send.ok)
          return res.status(503).json({ error: 'Invio email fallito', code: 'TWO_FA_SEND_FAILED' });
        res.json({ sentTo: send.sentTo, expiresInMinutes: send.expiresInMinutes });
      });
    }
    const send = await issueAndSendTwoFaCode(user, purpose);
    if (!send.ok)
      return res.status(503).json({ error: 'Invio email fallito', code: 'TWO_FA_SEND_FAILED' });
    res.json({ sentTo: send.sentTo, expiresInMinutes: send.expiresInMinutes });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/verify — duale:
//   - body.tempToken + body.code|recoveryCode  → step 2 del login
//   - Bearer + body.code                       → enrollment confirm
router.post('/2fa/verify', tfaVerifyLimiter, async (req, res, next) => {
  try {
    const { code, recoveryCode, tempToken } = req.body ?? {};

    // Caso 1: tempToken → completamento login.
    if (tempToken) {
      let payload;
      try {
        payload = twoFa.verifyPre2faToken(tempToken);
      } catch {
        return res
          .status(401)
          .json({ error: 'Token temporaneo non valido o scaduto', code: 'TWO_FA_BAD_TEMP_TOKEN' });
      }
      const user = await User.findByPk(payload.id);
      if (!user || !user.twoFaEnabled) {
        return res
          .status(400)
          .json({ error: 'Stato 2FA inconsistente', code: 'TWO_FA_INVALID_STATE' });
      }

      let ok = false;
      let consumedRecoveryIdx = -1;
      if (code) {
        const result = await twoFa.consumeChallenge(user.twoFaChallenge, code);
        ok = result.ok;
        if (!ok) {
          // Aggiorniamo attempts/scarto challenge in DB anche se il codice è errato.
          user.twoFaChallenge = result.updated;
          await user.save();
          if (result.reason === 'EXPIRED')
            return res
              .status(401)
              .json({ error: 'Codice scaduto. Richiedi un nuovo invio.', code: 'TWO_FA_EXPIRED' });
          if (result.reason === 'TOO_MANY_ATTEMPTS')
            return res.status(429).json({
              error: 'Troppi tentativi. Richiedi un nuovo codice.',
              code: 'TWO_FA_TOO_MANY_ATTEMPTS',
            });
        } else {
          // Successo: cancella challenge.
          user.twoFaChallenge = null;
        }
      }
      if (!ok && recoveryCode && Array.isArray(user.twoFaRecoveryCodes)) {
        consumedRecoveryIdx = await twoFa.findRecoveryMatch(recoveryCode, user.twoFaRecoveryCodes);
        ok = consumedRecoveryIdx >= 0;
      }
      if (!ok) {
        return res.status(401).json({ error: 'Codice non valido', code: 'TWO_FA_INVALID_CODE' });
      }
      if (consumedRecoveryIdx >= 0) {
        const next = user.twoFaRecoveryCodes.slice();
        next.splice(consumedRecoveryIdx, 1);
        user.twoFaRecoveryCodes = next;
      }
      user.lastLogin = new Date();
      await user.save();
      const token = signToken(user);
      return res.json({ token, user: user.toSafeJSON() });
    }

    // Caso 2: enrollment confirm (Bearer richiesto).
    return authenticate(req, res, async () => {
      try {
        if (!req.user.twoFaChallenge) {
          return res.status(400).json({
            error: 'Nessun codice in attesa: richiedi un nuovo invio.',
            code: 'TWO_FA_NOT_SETUP',
          });
        }
        const result = await twoFa.consumeChallenge(req.user.twoFaChallenge, code);
        if (!result.ok) {
          req.user.twoFaChallenge = result.updated;
          await req.user.save();
          if (result.reason === 'EXPIRED')
            return res.status(401).json({ error: 'Codice scaduto', code: 'TWO_FA_EXPIRED' });
          if (result.reason === 'TOO_MANY_ATTEMPTS')
            return res
              .status(429)
              .json({ error: 'Troppi tentativi', code: 'TWO_FA_TOO_MANY_ATTEMPTS' });
          return res.status(401).json({ error: 'Codice non valido', code: 'TWO_FA_INVALID_CODE' });
        }
        // Successo: attiva 2FA e genera recovery codes (UNICA occasione).
        const codes = twoFa.generateRecoveryCodes();
        const hashed = await twoFa.hashRecoveryCodes(codes);
        req.user.twoFaEnabled = true;
        req.user.twoFaChallenge = null;
        req.user.twoFaRecoveryCodes = hashed;
        if (!req.user.twoFaActivatedAt) req.user.twoFaActivatedAt = new Date();
        await req.user.save();
        return res.json({
          enabled: true,
          recoveryCodes: codes,
          message: '2FA attivato. Salva i recovery codes in un posto sicuro.',
        });
      } catch (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/recovery — rigenera 10 nuovi recovery codes (vecchi
// invalidati). Richiede un codice email VALIDO (manda nuova challenge prima
// se la richiesta arriva senza challenge attiva).
router.post('/2fa/recovery', authenticate, async (req, res, next) => {
  try {
    if (!req.user.twoFaEnabled) {
      return res.status(400).json({ error: '2FA non attivo', code: 'TWO_FA_NOT_ENABLED' });
    }
    const result = await twoFa.consumeChallenge(req.user.twoFaChallenge, req.body?.code);
    if (!result.ok) {
      req.user.twoFaChallenge = result.updated;
      await req.user.save();
      return res.status(401).json({
        error: result.reason === 'EXPIRED' ? 'Codice scaduto' : 'Codice non valido',
        code: result.reason === 'EXPIRED' ? 'TWO_FA_EXPIRED' : 'TWO_FA_INVALID_CODE',
      });
    }
    const codes = twoFa.generateRecoveryCodes();
    req.user.twoFaChallenge = null;
    req.user.twoFaRecoveryCodes = await twoFa.hashRecoveryCodes(codes);
    await req.user.save();
    res.json({ recoveryCodes: codes });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/disable — disattiva 2FA. Richiede codice email valido
// (challenge attiva) o un recovery code.
router.post('/2fa/disable', authenticate, async (req, res, next) => {
  try {
    if (!req.user.twoFaEnabled) {
      return res.status(400).json({ error: '2FA non attivo', code: 'TWO_FA_NOT_ENABLED' });
    }
    const { code, recoveryCode } = req.body ?? {};
    let ok = false;
    if (code) {
      const result = await twoFa.consumeChallenge(req.user.twoFaChallenge, code);
      ok = result.ok;
      if (!ok) {
        req.user.twoFaChallenge = result.updated;
        await req.user.save();
      } else {
        req.user.twoFaChallenge = null;
      }
    }
    if (!ok && recoveryCode && Array.isArray(req.user.twoFaRecoveryCodes)) {
      const idx = await twoFa.findRecoveryMatch(recoveryCode, req.user.twoFaRecoveryCodes);
      ok = idx >= 0;
    }
    if (!ok) {
      return res.status(401).json({ error: 'Codice non valido', code: 'TWO_FA_INVALID_CODE' });
    }
    req.user.twoFaEnabled = false;
    req.user.twoFaChallenge = null;
    req.user.twoFaRecoveryCodes = null;
    // Manteniamo `twoFaActivatedAt` per il middleware admin grace-period
    // (l'admin che riattiva 2FA non riparte da capo con i 7gg).
    await req.user.save();
    res.json({ enabled: false });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/2fa/status — stato corrente per la UI profilo.
router.get('/2fa/status', authenticate, (req, res) => {
  const codes = Array.isArray(req.user.twoFaRecoveryCodes) ? req.user.twoFaRecoveryCodes : [];
  const challenge = req.user.twoFaChallenge;
  const pendingSetup =
    !req.user.twoFaEnabled && !!challenge && new Date(challenge.expiresAt).getTime() > Date.now();
  res.json({
    enabled: req.user.twoFaEnabled === true,
    pendingSetup,
    recoveryCodesRemaining: codes.length,
    activatedAt: req.user.twoFaActivatedAt,
    email: twoFa.maskEmail(req.user.email),
  });
});

// =====================================================
// OAuth Google
// =====================================================
// Se la strategia non è registrata (env mancanti E settings DB inattive),
// rediriga a una pagina informativa nel frontend invece di rispondere JSON:
// l'utente arriva qui da un click su <a href>, vuole vedere una pagina,
// non un payload di errore.
router.get('/google', (req, res, next) => {
  if (!passport._strategy || !passport._strategy('google')) {
    return res.redirect(`${FRONTEND_URL}/auth/oauth-unavailable?provider=google`);
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })(req, res, next);
});

// Wrapper attorno a passport.authenticate per intercettare l'errore di dominio
// non autorizzato (lanciato dal verify callback) e redirigere con un parametro
// specifico, così la pagina di login può mostrare il motivo del rifiuto.
function oauthCallbackHandler(strategy) {
  return (req, res, next) => {
    passport.authenticate(strategy, { session: false }, (err, user) => {
      if (err instanceof OAuthDomainNotAllowedError) {
        const params = new URLSearchParams({
          error: 'oauth_domain_not_allowed',
          domain: err.domain || '',
        });
        return res.redirect(`${FRONTEND_URL}/login.html?${params.toString()}`);
      }
      if (err || !user) {
        return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
      }
      req.user = user;
      next();
    })(req, res, next);
  };
}

router.get('/google/callback', oauthCallbackHandler('google'), async (req, res) => {
  req.user.lastLogin = new Date();
  await req.user.save();
  const token = signToken(req.user);
  // Profilo da completare se: nuovo utente social (status='pending'),
  // mai associato a un corso, o studente senza matricola.
  const needsProfile =
    req.user.status === 'pending' ||
    !req.user.courseId ||
    (req.user.role === 'studente' && !req.user.matricola);
  // Token nel fragment (#) invece che in query string (?): i fragment NON
  // vengono inviati al server, NON appaiono negli access log, NON sono
  // inclusi nel header Referer di richieste successive.
  res.redirect(`${FRONTEND_URL}/oauth-callback.html#token=${token}&needsProfile=${needsProfile}`);
});

// =====================================================
// OAuth Microsoft
// =====================================================
// Vedi commento su /google: redirect a pagina frontend invece di JSON 503.
router.get('/microsoft', (req, res, next) => {
  if (!passport._strategy || !passport._strategy('microsoft')) {
    return res.redirect(`${FRONTEND_URL}/auth/oauth-unavailable?provider=microsoft`);
  }
  passport.authenticate('microsoft', { session: false })(req, res, next);
});

router.get('/microsoft/callback', oauthCallbackHandler('microsoft'), async (req, res) => {
  req.user.lastLogin = new Date();
  await req.user.save();
  const token = signToken(req.user);
  const needsProfile =
    req.user.status === 'pending' ||
    !req.user.courseId ||
    (req.user.role === 'studente' && !req.user.matricola);
  // Token nel fragment (#) invece che in query string (?): i fragment NON
  // vengono inviati al server, NON appaiono negli access log, NON sono
  // inclusi nel header Referer di richieste successive.
  res.redirect(`${FRONTEND_URL}/oauth-callback.html#token=${token}&needsProfile=${needsProfile}`);
});

// =====================================================
// Password reset — flusso self-service via email
// =====================================================

const PASSWORD_RESET_TTL_MIN = 60; // token valido per 1 ora
const PASSWORD_RESET_MAX_PER_HOUR = 3; // max 3 token attivi per utente/ora

function hashResetToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

/**
 * Render del template `password_reset` + send sincrono via sendSecurityEmail.
 * Variabili nel context:
 *   user.firstName, user.email
 *   reset.url, reset.expiresAtLong
 *   institute.name, institute.copyright, now.dateTime
 */
async function sendPasswordResetEmail(user, tokenPlain, expiresAt) {
  const tpl = await emailService.getTemplate('password_reset');
  if (!tpl) {
    logger.warn({ scope: 'auth.password_reset' }, 'password_reset template missing');
    return { ok: false, error: 'template missing' };
  }
  const institute = await Institute.findOne().catch(() => null);
  const resetUrl = `${FRONTEND_URL}/reset-password/${tokenPlain}`;
  const ctx = {
    user: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
    },
    reset: {
      url: resetUrl,
      expiresAtLong: dayjs(expiresAt).format('DD/MM/YYYY HH:mm'),
    },
    institute: {
      name: institute?.name || 'Cadenza',
      copyright: `© ${new Date().getFullYear()} ${institute?.name || 'Cadenza'}`,
    },
    now: { dateTime: dayjs().format('DD/MM/YYYY HH:mm') },
  };
  return sendSecurityEmail({
    to: user.email,
    subject: emailService.renderText(tpl.subject, ctx),
    html: emailService.render(tpl.bodyHtml, ctx),
  });
}

/**
 * POST /auth/forgot-password
 *
 * Genera un token di reset e lo invia via email. Risposta SEMPRE 200 con
 * messaggio generico per evitare enumeration: un attaccante che testa
 * "esiste questa email?" riceve la stessa risposta indipendentemente.
 *
 * Anti-abuse a 2 livelli:
 *   - rate-limit per IP (passwordResetRequestLimiter: 3 / 30min)
 *   - gate per utente (max 3 token attivi nell'ultima ora) per evitare
 *     che un attaccante con IP rotanti possa flooddare un singolo bersaglio
 */
router.post(
  '/forgot-password',
  passwordResetRequestLimiter,
  body('email').isEmail().withMessage('Email non valida').normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Anche su validation error ritorna 200 generico: l'attaccante che invia
      // "email: invalid" non deve poter distinguere da "email: not-found".
      return res.json({ ok: true });
    }
    const { email } = req.body;
    try {
      const user = await User.findOne({ where: { email } });
      // Anche se l'utente non esiste, non lo diciamo (anti-enumeration).
      // Aggiungiamo un piccolo delay artificiale per parificare il timing
      // del path "esiste" (che fa email send + DB write) con "non esiste".
      if (!user) {
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
        return res.json({ ok: true });
      }

      // Gate per-utente: non più di N token attivi nell'ultima ora.
      const recentCount = await PasswordResetToken.count({
        where: {
          userId: user.id,
          createdAt: { [Op.gte]: dayjs().subtract(1, 'hour').toDate() },
        },
      });
      if (recentCount >= PASSWORD_RESET_MAX_PER_HOUR) {
        logger.warn(
          { userId: user.id, scope: 'auth.password_reset' },
          'rate-limit per-user superato — drop silenzioso',
        );
        return res.json({ ok: true });
      }

      // Genera token random sicuro (64 hex char = 32 bytes entropia)
      const tokenPlain = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(tokenPlain);
      const expiresAt = dayjs().add(PASSWORD_RESET_TTL_MIN, 'minute').toDate();

      await PasswordResetToken.create({
        userId: user.id,
        tokenHash,
        expiresAt,
        requestIp: req.ip,
        requestUserAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      });

      // Invio email (best-effort, errori loggati ma non esposti al client).
      const r = await sendPasswordResetEmail(user, tokenPlain, expiresAt);
      if (!r.ok) {
        logger.error(
          { userId: user.id, err: r.error, scope: 'auth.password_reset' },
          'invio email reset fallito',
        );
      } else {
        logger.info(
          { userId: user.id, scope: 'auth.password_reset' },
          'token reset generato e email inviata',
        );
      }
      return res.json({ ok: true });
    } catch (err) {
      logger.error({ err: err.message, scope: 'auth.password_reset' }, 'errore forgot-password');
      // Errore tecnico: 200 generico per non leakare info sull'utente.
      return res.json({ ok: true });
    }
  },
);

/**
 * GET /auth/reset-password/:token/validate
 *
 * Endpoint leggero per la pagina frontend: prima di mostrare il form di
 * nuova password, verifica che il token sia ancora valido (esiste, non
 * scaduto, non usato). Solo metadati pubblici, nessun dato personale.
 */
router.get('/reset-password/:token/validate', passwordResetConfirmLimiter, async (req, res) => {
  const tokenPlain = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(tokenPlain)) {
    return res.status(400).json({ valid: false, reason: 'format' });
  }
  const tokenHash = hashResetToken(tokenPlain);
  const row = await PasswordResetToken.findOne({ where: { tokenHash } });
  if (!row) return res.status(404).json({ valid: false, reason: 'not_found' });
  if (row.usedAt) return res.status(400).json({ valid: false, reason: 'used' });
  if (row.expiresAt < new Date()) return res.status(400).json({ valid: false, reason: 'expired' });
  return res.json({ valid: true, expiresAt: row.expiresAt });
});

/**
 * POST /auth/reset-password
 *
 * Conferma del reset: valida token + cambia password. Dopo il cambio:
 *   - marca il token come `usedAt` (monouso)
 *   - incrementa `tokenVersion` del user → tutti i JWT esistenti decadono
 *     (utile se l'attaccante aveva sessioni attive su altri dispositivi)
 *   - sblocca eventuale account lockout (l'utente ha dimostrato possesso
 *     della casella email)
 */
router.post(
  '/reset-password',
  passwordResetConfirmLimiter,
  body('token')
    .matches(/^[a-f0-9]{64}$/)
    .withMessage('Token non valido'),
  body('newPassword')
    .isLength({ min: PASSWORD_MIN_LEN })
    .withMessage(`Password deve essere lunga almeno ${PASSWORD_MIN_LEN} caratteri`)
    .matches(PASSWORD_REGEX)
    .withMessage('Password deve contenere almeno una maiuscola e un numero'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    const { token: tokenPlain, newPassword } = req.body;
    const tokenHash = hashResetToken(tokenPlain);

    const row = await PasswordResetToken.findOne({ where: { tokenHash } });
    if (!row) return res.status(400).json({ error: 'Token non valido o scaduto' });
    if (row.usedAt) return res.status(400).json({ error: 'Token già utilizzato' });
    if (row.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Token scaduto, richiedi un nuovo link' });
    }

    const user = await User.findByPk(row.userId);
    if (!user) return res.status(400).json({ error: 'Utente non trovato' });

    // Cambia password (beforeUpdate hook ha-sha il valore) + invalida sessioni
    // esistenti + sblocca lockout. Tutto in una save() per atomicità DB.
    user.passwordHash = newPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();

    row.usedAt = new Date();
    await row.save();

    logger.info(
      { userId: user.id, scope: 'auth.password_reset' },
      'password reimpostata via token email',
    );
    return res.json({ ok: true });
  },
);

module.exports = router;
