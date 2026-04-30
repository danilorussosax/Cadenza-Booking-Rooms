'use strict';

const jwt = require('jsonwebtoken');
const { User } = require('../models');
const sentry = require('../lib/sentry');
const { getJwtSecret } = require('../lib/secrets');

const JWT_SECRET = getJwtSecret();

/**
 * Verifica il JWT presente nell'header Authorization: Bearer <token>
 * e popola req.user con l'istanza utente.
 *
 * Oltre alla firma + scadenza, controlla che `payload.tokenVersion` corrisponda
 * a quello corrente del User. Se non corrisponde → token revocato (logout,
 * cambio password, sospetta compromise). Risponde 401 con `code='TOKEN_REVOKED'`
 * così il client distingue dal classico "token scaduto" e può fare un logout
 * pulito senza tentare retry.
 */
async function authenticate(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token mancante' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Utente non valido o disabilitato' });
    }
    // Token emessi prima dell'introduzione del campo NON hanno tokenVersion:
    // li rifiutiamo (sono al massimo vecchi 7gg, finestra di transizione
    // accettabile). I nuovi token includono sempre il numero.
    const tv = typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : -1;
    if (tv !== user.tokenVersion) {
      return res.status(401).json({
        error: 'Sessione invalidata, effettua nuovamente il login',
        code: 'TOKEN_REVOKED',
      });
    }
    req.user = user;
    // Aggiorna scope Sentry con id (anonimizzato) + ruolo: utile a
    // correlare gli errori 5xx successivi a questo utente. No-op senza DSN.
    sentry.setRequestScope(req);

    // 2FA enforcement automatico per admin: se il middleware globale stabilisce
    // che l'admin DEVE avere 2FA attivo, blocchiamo qui tutte le request
    // tranne quelle del flusso 2FA stesso (/api/auth/2fa/*) e operazioni di
    // sessione (/api/auth/me, /api/auth/logout) che servono al setup.
    if (user.role === 'admin' && !user.twoFaEnabled) {
      const path = req.path || '';
      const isAuthBypass =
        path.startsWith('/2fa/') ||
        path === '/me' ||
        path === '/logout' ||
        path === '/change-password';
      if (!isAuthBypass) {
        const blocked = enforceAdminTwoFa(user, res);
        if (blocked) return;
      }
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

/**
 * Middleware factory per consentire solo a determinati ruoli.
 * @example router.get('/admin', authenticate, requireRole('admin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accesso negato: permessi insufficienti' });
    }
    next();
  };
}

/**
 * Middleware che richiede che il profilo dell'utente sia completo
 * (matricola + corso impostati). Necessario per prenotare.
 */
function requireCompleteProfile(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  if (req.user.role === 'admin') return next();
  if (req.user.role === 'studente' && !req.user.matricola) {
    return res.status(403).json({
      error: 'Profilo incompleto: imposta la matricola prima di proseguire',
      code: 'INCOMPLETE_PROFILE',
    });
  }
  if (!req.user.courseId) {
    return res.status(403).json({
      error: 'Profilo incompleto: seleziona il corso prima di proseguire',
      code: 'INCOMPLETE_PROFILE',
    });
  }
  next();
}

/**
 * Middleware che richiede l'approvazione dell'account (status='approved').
 * Gli admin sono sempre considerati approvati.
 */
function requireApproved(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  if (req.user.role === 'admin') return next();
  if (req.user.status !== 'approved') {
    return res.status(403).json({
      error:
        req.user.status === 'rejected'
          ? "Il tuo account è stato rifiutato dall'amministratore"
          : 'Account in attesa di approvazione',
      code: req.user.status === 'rejected' ? 'ACCOUNT_REJECTED' : 'ACCOUNT_PENDING',
    });
  }
  next();
}

// Default 2h: compromesso UX/sicurezza per single-page app senza refresh
// token. Sovrascrivibile via env JWT_EXPIRES_IN (es. "30m", "1d").
const DEFAULT_JWT_EXPIRES_IN = '2h';

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      // Inclusione di tokenVersion: incrementare User.tokenVersion invalida
      // tutti i JWT precedentemente firmati per quell'utente.
      tokenVersion: user.tokenVersion ?? 0,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN },
  );
}

/**
 * Logica 2FA-for-admin (chiamata internamente da authenticate per admin
 * senza 2FA attivo) e disponibile come middleware standalone per usi mirati.
 *
 *   - Admin con `twoFaActivatedAt` valorizzato (ha già attivato in passato
 *     ma poi disabilitato) → blocca subito senza grace.
 *   - Admin che non ha mai attivato → grace di TWO_FA_GRACE_DAYS dal
 *     createdAt del proprio account.
 *
 * Quando "ancora in grace": setta header `X-TwoFa-Grace-Days-Left` per
 * permettere all'UI di mostrare un avviso. Ritorna `true` se ha bloccato,
 * `false` se ha lasciato passare.
 */
const TWO_FA_GRACE_DAYS = Number(process.env.TWO_FA_GRACE_DAYS) || 7;
function enforceAdminTwoFa(user, res) {
  if (user.twoFaEnabled) return false;
  if (user.twoFaActivatedAt) {
    res.status(403).json({
      error:
        '2FA disattivato: gli admin devono mantenere il 2FA attivo. Riattiva da Profilo → Sicurezza.',
      code: 'TWO_FA_REQUIRED_FOR_ADMIN',
    });
    return true;
  }
  const created = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();
  const ageDays = (Date.now() - created) / 86400000;
  if (ageDays > TWO_FA_GRACE_DAYS) {
    res.status(403).json({
      error: 'Periodo di grazia scaduto: attiva il 2FA da Profilo → Sicurezza.',
      code: 'TWO_FA_REQUIRED_FOR_ADMIN',
    });
    return true;
  }
  res.setHeader(
    'X-TwoFa-Grace-Days-Left',
    String(Math.max(0, Math.ceil(TWO_FA_GRACE_DAYS - ageDays))),
  );
  return false;
}

/** Middleware standalone (uso esplicito in route admin specifiche). */
function require2FAForAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  if (req.user.role !== 'admin') return next();
  if (enforceAdminTwoFa(req.user, res)) return;
  next();
}

module.exports = {
  authenticate,
  requireRole,
  requireCompleteProfile,
  requireApproved,
  require2FAForAdmin,
  signToken,
};
