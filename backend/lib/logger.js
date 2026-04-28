'use strict';

/**
 * Logger applicativo basato su pino.
 *
 *   - In produzione (NODE_ENV=production) emette JSON line-by-line, ideale
 *     per ingest su sistemi di osservabilità (Loki, Datadog, ELK).
 *   - In dev usa pino-pretty con colori e timestamp leggibili.
 *
 * Convenzioni di chiamata:
 *   logger.info({ userId, bookingId }, 'booking created');
 *   logger.warn({ err, hint: '…' }, 'something off');
 *   logger.error({ err }, 'unexpected failure');
 *
 * Per propagare il request-id nelle chiamate sotto handler usare il
 * `req.log` aggiunto da pino-http (vedi server.js).
 */

const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Path PII / segreti redatti dal logger.
// Conformità GDPR (art. 5/32) + buon senso operativo.
//   - Niente credenziali in chiaro nei log (password, token, sessioni).
//   - Niente PII identificativa diretta (email, refreshToken OAuth) salvo
//     ID interni; gli ID utente non sono PII se non collegabili senza il DB.
//   - Header Authorization/Cookie sempre redatti su req e request (pino-http
//     espone uno o l'altro a seconda della versione).
const REDACT_PATHS = [
  // Credenziali
  'password',
  'passwordHash',
  'newPassword',
  'oldPassword',
  'currentPassword',
  '*.password',
  '*.passwordHash',
  '*.newPassword',
  '*.oldPassword',
  '*.currentPassword',
  'body.password',
  'body.passwordHash',
  'body.newPassword',
  'body.oldPassword',
  'body.currentPassword',
  'body.confirmPassword',

  // Token (JWT, OAuth, reset, sessione, CSRF)
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'resetToken',
  'sessionToken',
  'csrfToken',
  'apiKey',
  'secret',
  'clientSecret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.resetToken',
  '*.sessionToken',
  '*.csrfToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
  'body.resetToken',

  // Header sensibili (req/request a seconda della shape pino-http)
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-auth-token"]',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.headers["x-api-key"]',
  'request.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'response.headers["set-cookie"]',

  // PII (email + identificativi anagrafici quando passano per body)
  'email',
  '*.email',
  'body.email',
  'body.confirmEmail',
  'body.firstName',
  'body.lastName',
  'body.matricola',
  'body.codiceFiscale',

  // Configurazioni SMTP/OAuth lette da DB
  'smtp.pass',
  'smtp.password',
  '*.smtpPass',
  '*.smtpPassword',
  'oauth.clientSecret',
  '*.oauthSecret',
];

const baseOptions = {
  level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // Serializer custom per req: limitiamo i campi loggati alla terna
  // method/url/id + remote info; niente body, niente query (potrebbe
  // contenere email in /auth/forgot-password ecc.).
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
    err: pino.stdSerializers.err,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
};

const logger = isProd
  ? pino(baseOptions)
  : pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss.l',
        },
      },
    });

module.exports = logger;
