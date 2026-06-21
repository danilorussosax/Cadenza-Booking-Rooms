'use strict';

/**
 * originGuard — protezione CSRF-equivalente per modello JWT Bearer.
 *
 * Cadenza non usa cookie di sessione: il JWT vive in localStorage e viene
 * inviato manualmente nell'header `Authorization`. In questo modello il
 * CSRF token classico (csurf con cookie double-submit) non aggiunge sicurezza
 * perché un attaccante cross-origin non può comunque leggere/inviare il
 * Bearer token. L'unico vettore residuo è una richiesta cross-origin che
 * NON necessita di credenziali (es. POST con corpo che produce side-effect
 * solo per il fatto di colpire l'API — caso rarissimo).
 *
 * Questo middleware aggiunge defense-in-depth verificando, sulle sole
 * richieste mutanti (POST/PUT/PATCH/DELETE), che l'header `Origin` (o, in
 * fallback, `Referer`) provenga da un'origin autorizzata. Allinea il
 * controllo a quanto già fatto da CORS per le richieste pre-flight, ma lo
 * estende anche alle richieste "simple" (Content-Type form-urlencoded /
 * text/plain) che il browser invia senza pre-flight.
 *
 * Origin autorizzate:
 *   - `process.env.FRONTEND_URL` (produzione: obbligatorio)
 *   - same-origin (richieste partite dallo stesso host del server)
 *   - localhost:* in development
 *
 * Endpoint esclusi (whitelist):
 *   - `/api/messaging/*` (webhook server-to-server: nessun Origin header)
 *   - `/api/csp-report`  (browser invia application/csp-report da contesto interno)
 *
 * In test (`NODE_ENV=test`) il guard è bypassato: supertest non invia Origin.
 */

const logger = require('../lib/logger');

// Path che NON devono passare per il guard (chiamati da server, non da browser).
const EXEMPT_PREFIXES = ['/api/messaging/', '/api/csp-report'];

// Metodi che bypassano il guard. Sono safe per definizione (RFC 7231 §4.2.1).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getAllowedOrigins(req) {
  const allowed = new Set();
  const frontendUrl = normalizeOrigin(process.env.FRONTEND_URL);
  if (frontendUrl) allowed.add(frontendUrl);

  // Same-origin: l'app SPA è servita dallo stesso host del backend (porta
  // 3199 in dev/e2e, dominio canonico in produzione dietro reverse proxy).
  // Costruiamo l'origin "attesa" dall'header Host + protocollo derivato dal
  // trust-proxy (X-Forwarded-Proto se presente, altrimenti req.protocol).
  const host = req.get('host');
  if (host) {
    const proto = req.protocol; // express risolve X-Forwarded-Proto se trust proxy attivo
    allowed.add(`${proto}://${host}`);
  }

  // In dev tutti i localhost sono leciti (Vite dev server può girare su porte
  // variabili). In produzione solo FRONTEND_URL + same-origin.
  if (process.env.NODE_ENV !== 'production') {
    // Marker speciale: il check userà startsWith per matchare localhost:*
    allowed.add('__DEV_LOCALHOST__');
  }

  return allowed;
}

function isOriginAllowed(origin, allowed) {
  if (!origin) return false;
  if (allowed.has(origin)) return true;
  if (allowed.has('__DEV_LOCALHOST__')) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return true;
    }
  }
  return false;
}

function isExempt(reqPath) {
  return EXEMPT_PREFIXES.some((prefix) => reqPath.startsWith(prefix));
}

function originGuard(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  if (SAFE_METHODS.has(req.method)) return next();
  // `req.path` è relativo al mount point: con `app.use('/api/', originGuard)`
  // Express strippa `/api`, quindi qui arriverebbe `/messaging/...` e i prefissi
  // EXEMPT_PREFIXES (che includono `/api/`) non matcherebbero mai. Ricostruiamo
  // il path completo con `req.baseUrl` per confrontare contro l'URL reale.
  if (isExempt((req.baseUrl || '') + req.path)) return next();

  const origin = normalizeOrigin(req.get('origin')) || normalizeOrigin(req.get('referer'));
  const allowed = getAllowedOrigins(req);

  if (!isOriginAllowed(origin, allowed)) {
    if (logger?.warn) {
      logger.warn(
        {
          ip: req.ip,
          method: req.method,
          path: req.originalUrl,
          origin: req.get('origin') || null,
          referer: req.get('referer') || null,
          requestId: req.id,
        },
        'origin guard: request blocked',
      );
    }
    return res.status(403).json({
      error: 'Origine della richiesta non autorizzata',
      code: 'ORIGIN_FORBIDDEN',
    });
  }

  return next();
}

module.exports = { originGuard };
