'use strict';

/**
 * Costruisce l'istanza Express dell'applicazione (middleware + route + error handler).
 *
 * Estratta da server.js per consentire l'uso con supertest senza dover
 * effettivamente fare listen su una porta. server.js continua a essere
 * l'entry point operativo (sync DB, scheduler, signal handler).
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');
const passport = require('./config/passport');
const logger = require('./lib/logger');
const { apiDefaultLimiter } = require('./middleware/rateLimit');
const { auditMiddleware } = require('./middleware/audit');
const { mapSequelizeError } = require('./lib/dbErrors');
const sentry = require('./lib/sentry');

function buildApp({ serveFrontend = true } = {}) {
  const app = express();

  // Trust proxy in produzione (X-Forwarded-For dal reverse proxy).
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // ============================================================
  // Security headers (Helmet + CSP custom + Permissions-Policy)
  // ============================================================
  // Strategia:
  //  - CSP rigorosa con default-src 'self', no inline script (lo script
  //    anti-FOUC è esternalizzato in /theme-init.js).
  //  - 'unsafe-inline' su style-src: Tailwind/shadcn iniettano stili inline
  //    runtime (es. style={{...}}). Hash/nonce non praticabile.
  //  - 'wasm-unsafe-eval' su script-src: predisposto per moduli WASM
  //    (recharts può usarlo in alcune build).
  //  - img-src: include i CDN OAuth (avatar Google/Microsoft) + data/blob
  //    (preview foto upload sharp lato client) + il proprio /storage.
  //  - font-src: include Google Fonts (Inter); per self-host basta togliere
  //    `https://fonts.gstatic.com`.
  //  - frame-ancestors 'none': clickjacking protection. Eccezione futura
  //    per /embed/* (vedi roadmap §5.8) tramite override middleware.
  //  - HSTS preload solo in produzione (max-age 2 anni, includeSubDomains).
  //  - crossOriginEmbedderPolicy: false → necessario per pop-up OAuth
  //    (Google/Microsoft). Riabilitarla solo se si rinuncia a OAuth.
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      'https://*.googleusercontent.com',
      'https://*.microsoftonline.com',
    ],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    // PWA: il service worker (/sw.js) e il manifest devono essere first-party.
    // worker-src include anche blob: per consentire workbox-window di usare
    // module workers durante l'init (alcuni browser).
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    // CSP violation reports → endpoint backend che logga + forwarda a Sentry.
    // - `report-uri` è la sintassi legacy (Chrome <94, Firefox, Safari).
    // - `report-to` è la sintassi moderna ma richiede l'header `Reporting-Endpoints`.
    //   Includiamo entrambi per copertura cross-browser.
    reportUri: ['/api/csp-report'],
    reportTo: ['cadenza-csp'],
  };
  if (process.env.NODE_ENV === 'production') {
    cspDirectives.upgradeInsecureRequests = [];
  }
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: cspDirectives },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

  // Reporting-Endpoints: dichiara il gruppo `cadenza-csp` referenziato dal
  // `report-to` della CSP. Header standardizzato (W3C Reporting API).
  app.use((req, res, next) => {
    res.setHeader('Reporting-Endpoints', 'cadenza-csp="/api/csp-report"');
    next();
  });

  // Permissions-Policy: nessuna API potente abilitata di default.
  // Il kiosk /display in fullscreen NON richiede l'API fullscreen permission
  // (è user-gesture initiated, non bloccato da questa policy).
  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'autoplay=()',
        'camera=()',
        'display-capture=()',
        'encrypted-media=()',
        'fullscreen=(self)',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'midi=()',
        'payment=()',
        'picture-in-picture=()',
        'publickey-credentials-get=(self)',
        'screen-wake-lock=()',
        'usb=()',
        'xr-spatial-tracking=()',
      ].join(', '),
    );
    next();
  });
  // CORS: in produzione FRONTEND_URL DEVE essere impostato. Se manca,
  // `origin: true` riflette l'Origin di QUALUNQUE sito + invia
  // Access-Control-Allow-Credentials: true → qualsiasi pagina può chiamare
  // l'API con i cookie di sessione dell'utente. In dev/test ammettiamo il
  // wildcard per facilitare lo sviluppo.
  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    throw new Error('FRONTEND_URL non impostato in produzione: CORS richiede un origin esplicito');
  }
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || true,
      credentials: true,
    }),
  );

  // Request id per correlazione log
  app.use((req, res, next) => {
    const id = req.get('x-request-id') || randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  });

  // Sentry scope per request: tag request_id sempre, user.id (anonimizzato) +
  // user.role appena disponibili. Va PRIMA di qualunque route per essere
  // attivo già nella prima eccezione.
  if (sentry.isInitialized()) {
    app.use((req, res, next) => {
      sentry.setRequestScope(req);
      next();
    });
  }

  // Log strutturato (silenziato in test per non sporcare l'output di vitest)
  if (process.env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id,
        customLogLevel: (req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'debug';
        },
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
    if (process.env.NODE_ENV !== 'production') {
      app.use(morgan('dev'));
    }
  }

  // express.json con `verify` callback per preservare req.rawBody:
  // necessario per la verifica HMAC SHA256 del webhook WhatsApp Cloud
  // (firma calcolata sul body raw, non sul JSON re-stringificato).
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        // Solo per le request webhook messaging — evita memoria sprecata altrove.
        if (req.url && req.url.startsWith('/api/messaging/')) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // Express 5: req.body è `undefined` se la richiesta non ha body o
  // Content-Type (in Express 4 era `{}`). 100+ access point del codebase
  // assumono il vecchio comportamento (`req.body.xxx`). Ripristiniamo
  // il default `{}` qui, evitando refactor invasivo. Optional chaining
  // resta best-practice per nuovo codice.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  // Rate limiting baseline. In test bypassato per non interferire con
  // sequenze rapide di richieste (i test che vogliono colpire il rate
  // limiter usano un app dedicato — vedi auth.test.js).
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api/', apiDefaultLimiter);
  }

  app.use('/api/', auditMiddleware);

  // Passport solo per le strategie OAuth. Niente express-session / passport.session():
  // tutte le strategie sono invocate con { session: false } e l'autenticazione
  // applicativa usa JWT (vedi middleware/auth.js), non i cookie di sessione.
  app.use(passport.initialize());

  // Static frontend (saltato quando esplicitamente disattivato — vedi tests/)
  if (serveFrontend) {
    const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
    // Cartella icone app: serviamo direttamente dal SORGENTE
    // `frontend/public/logo-app/` con precedenza su dist, così droppare un
    // PNG nella cartella lo rende disponibile immediatamente — senza dover
    // rilanciare `npm run build`. Path montato PRIMA dello static dist.
    const FRONTEND_LOGO_APP = path.join(__dirname, '..', 'frontend', 'public', 'logo-app');
    app.use(
      '/logo-app',
      express.static(FRONTEND_LOGO_APP, { maxAge: '5m', etag: true, fallthrough: true }),
    );
    app.use(
      express.static(FRONTEND_DIST, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );
    const UPLOADS_DIR = path.join(__dirname, 'uploads');
    app.use('/storage', express.static(UPLOADS_DIR, { maxAge: '7d', etag: true }));
  }

  // ============== API routes ==============
  // CSP violation reports: registrato PRIMA degli altri routes per garantire
  // che il body parser dedicato (`application/csp-report`) sia montato
  // anteriormente al middleware express.json globale.
  app.use('/api/csp-report', require('./routes/cspReport'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users/me/gdpr', require('./routes/gdpr'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/courses', require('./routes/courses'));
  app.use('/api/course-levels', require('./routes/courseLevels'));
  app.use('/api/structure', require('./routes/structure'));
  app.use('/api/admin/quotas', require('./routes/quotas'));
  app.use('/api/admin/audit-log', require('./routes/auditLog'));
  app.use('/api/admin/analytics', require('./routes/analytics'));
  app.use('/api/bookings/waitlist', require('./routes/waitlist'));
  app.use('/api/bookings/templates', require('./routes/bookingTemplates'));
  // Booking type catalog (gap #7 EasyRoom parity): personalizzazione admin
  // di label/color/icon/sortOrder per i 5 tipi prenotazione legacy ENUM.
  // Montato PRIMA di /api/bookings/:id per evitare match come id="types".
  {
    const bt = require('./routes/bookingTypes');
    app.use('/api/booking-types', bt.router);
    app.use('/api/admin/booking-types', bt.adminRouter);
  }
  app.use('/api/rules', require('./routes/rules'));
  app.use('/api/admin/rules', require('./routes/rulesPreview'));
  app.use('/api/bookings', require('./routes/bookings'));
  // Module-guard: se "Prestito strumenti" è disattivato, le 4 rotte qui sotto
  // ritornano 404 con code MODULE_DISABLED (utenti redirezionati a una
  // pagina di placeholder lato UI).
  const { requireModuleEnabled } = require('./middleware/moduleGuard');
  const guardLoans = requireModuleEnabled('instrumentLoans');
  app.use('/api/instruments', guardLoans, require('./routes/instruments'));
  app.use('/api/loans', guardLoans, require('./routes/instrumentLoans'));
  app.use('/api/admin/instrument-loan-rules', guardLoans, require('./routes/instrumentLoanRules'));
  app.use('/api/admin/instrument-loan-quotas', guardLoans, require('./routes/loanQuotas'));
  app.use('/api/admin/announcements', require('./routes/announcementsAdmin'));
  app.use('/api/announcements', require('./routes/announcements'));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/admin/mail-settings', require('./routes/mailSettings'));
  app.use('/api/admin/mail-templates', require('./routes/mailTemplates'));
  app.use('/api/admin/mail-outbox', require('./routes/mailOutbox'));
  app.use('/api/admin/backups', require('./routes/backups'));
  app.use('/api/admin/excel-export', require('./routes/excelExport'));
  app.use('/api/admin/oauth-settings', require('./routes/oauthSettings'));
  app.use('/api/admin/messaging-settings', require('./routes/messagingSettings'));
  app.use('/api/admin/integrations', require('./routes/integrations'));
  // Monte Ore — proposte annuali del docente + gestione coordinatore.
  // Module-guard: se il toggle "Monte Ore docenti" è OFF entrambi i router
  // ritornano 404 MODULE_DISABLED.
  const monteOre = require('./routes/monteOre');
  const guardMonteOre = requireModuleEnabled('monteOre');
  app.use('/api/monte-ore', guardMonteOre, monteOre.router);
  app.use('/api/admin/monte-ore', guardMonteOre, monteOre.adminRouter);
  app.use('/api/users/me/bot-bindings', require('./routes/botBindings'));
  app.use('/api/messaging', require('./routes/messagingWebhook'));
  // Listing dinamico delle icone app personalizzabili (Profilo → Icona app)
  app.use('/api/app-icons', require('./routes/appIcons'));
  // Tipologie contrattuali docenti (Monte Ore — gestione admin + lookup)
  app.use('/api/contract-types', require('./routes/contractTypes'));
  app.use('/api/docs', require('./routes/docs'));

  // Liveness: il processo è vivo (sempre 200, no DB call). Per Kubernetes
  // livenessProbe (riavvio container).
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness: il processo può servire traffico (DB raggiungibile, schema OK).
  // Per Kubernetes readinessProbe (instradare/no instradare traffico) e per
  // load balancer di front. Risponde 503 se la connessione DB è giù.
  app.get('/api/ready', async (req, res) => {
    try {
      const { sequelize } = require('./models');
      await sequelize.query('SELECT 1');
      res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({
        status: 'not_ready',
        error: 'database_unreachable',
        message: err?.message?.slice(0, 200),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Smoke test della pipeline Sentry — admin-only. Lancia un errore
  // intenzionale e restituisce l'eventId. Utile per validare la
  // configurazione (DSN, env, rete egress) una volta in produzione.
  // Non è un endpoint di abuso: il rate è già limitato dal limiter API.
  {
    const { authenticate, requireRole } = require('./middleware/auth');
    app.post('/api/admin/_sentry/test', authenticate, requireRole('admin'), (req, res) => {
      if (!sentry.isInitialized()) {
        return res.status(503).json({
          ok: false,
          message: 'Sentry non inizializzato (SENTRY_DSN non impostato)',
        });
      }
      const Sentry = require('@sentry/node');
      const err = new Error(`Sentry smoke test (intenzionale) — ${new Date().toISOString()}`);
      err.code = 'SENTRY_SMOKE_TEST';
      const eventId = Sentry.captureException(err);
      res.json({
        ok: true,
        eventId,
        message: "Errore inviato a Sentry. Cerca l'eventId nella dashboard del progetto.",
      });
    });
  }

  // SPA fallback (saltato quando serveFrontend === false)
  if (serveFrontend) {
    const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
    app.get(/^(?!\/api).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  // Sentry error handler — DEVE stare PRIMA dell'error handler custom così
  // gli errori vengono catturati prima di essere mappati a JSON e persi.
  // No-op se Sentry non è inizializzato.
  if (sentry.isInitialized()) {
    const Sentry = require('@sentry/node');
    Sentry.setupExpressErrorHandler(app);
  }

  // Error handler (stessa logica di server.js)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.status && err.code) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code,
        ...(err.details && { details: err.details }),
        ...(err.fields && { fields: err.fields }),
      });
    }
    const mapped = mapSequelizeError(err);
    if (mapped) {
      return res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
        ...(mapped.fields && mapped.fields.length && { fields: mapped.fields }),
        ...(mapped.details && { details: mapped.details }),
      });
    }
    if (process.env.NODE_ENV !== 'test') {
      console.error('Errore non gestito:', err);
    }
    // Stack incluso solo in dev/test esplicito: se NODE_ENV è undefined
    // (mis-config in produzione) NON esponiamo lo stack.
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    res.status(err.status || 500).json({
      error: err.message || 'Errore interno del server',
      ...(err.code && { code: err.code }),
      ...(isDevOrTest && { stack: err.stack }),
    });
  });

  return app;
}

module.exports = { buildApp };
