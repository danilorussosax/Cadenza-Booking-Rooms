'use strict';

/**
 * Inizializzazione Sentry per il backend Cadenza.
 *
 * IMPORTANTE: questo file deve essere richiesto come PRIMA cosa in server.js
 * (prima di qualunque altro require), così l'instrumentation di @sentry/node
 * intercetta http, express, postgres, ecc.
 *
 * Se SENTRY_DSN non è impostata, il modulo è no-op: utile per dev locale.
 *
 * PII scrubbing:
 *   - beforeBreadcrumb: rimuove email/password/token dal body delle request
 *     loggate come breadcrumb (categoria 'http').
 *   - beforeSend: replica la stessa pulizia sull'evento prima dell'invio,
 *     così anche eventuali request body in `event.request.data` sono safe.
 *
 * Tagging utente:
 *   - userScopeFor(user, requestId) ritorna i metadati da setScope, con
 *     anonimizzazione di user.id via SHA-256 (salt opzionale via env
 *     SENTRY_USER_ID_SALT). Email mai inviata.
 */

const crypto = require('crypto');

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'refreshToken',
  'accessToken',
  'authorization',
  'secret',
  'clientSecret',
  'apiKey',
  'twoFaSecret',
  'twoFaSecretEncrypted',
  'recoveryCode',
  'codiceFiscale',
  'matricola',
  'vatNumber',
  'fiscalCode',
]);

const PII_KEYS = new Set(['email', 'firstName', 'lastName', 'phone']);

function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrubObject);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (PII_KEYS.has(k)) {
      out[k] = '[PII]';
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) {
    breadcrumb.data = scrubObject(breadcrumb.data);
  }
  return breadcrumb;
}

function scrubEvent(event) {
  if (!event) return event;
  if (event.request) {
    if (event.request.data) event.request.data = scrubObject(event.request.data);
    if (event.request.headers) event.request.headers = scrubObject(event.request.headers);
    if (event.request.cookies) event.request.cookies = '[REDACTED]';
  }
  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.contexts && event.contexts.body) {
    event.contexts.body = scrubObject(event.contexts.body);
  }
  return event;
}

let _initialized = false;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  // require lazy così senza DSN il modulo non importa @sentry/node
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
  _initialized = true;
  return true;
}

function isInitialized() {
  return _initialized;
}

/**
 * SHA-256 di user.id con salt opzionale (env SENTRY_USER_ID_SALT). Permette
 * di correlare errori dello stesso utente senza inviare l'id reale a Sentry.
 */
function anonymousUserId(id) {
  if (id == null) return undefined;
  const salt = process.env.SENTRY_USER_ID_SALT || '';
  return crypto
    .createHash('sha256')
    .update(`${salt}:${String(id)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Imposta scope (user, tags) per la request corrente. Da chiamare nel
 * middleware dopo authenticate. No-op se Sentry non è inizializzato.
 */
function setRequestScope(req) {
  if (!_initialized) return;
  const Sentry = require('@sentry/node');
  Sentry.withScope((scope) => {
    scope.setTag('request_id', req.id);
    if (req.user) {
      scope.setUser({
        id: anonymousUserId(req.user.id),
        role: req.user.role,
      });
      scope.setTag('user_role', req.user.role);
    }
  });
  // Setto anche sul current scope (usato dagli error handler successivi)
  const scope = Sentry.getCurrentScope();
  scope.setTag('request_id', req.id);
  if (req.user) {
    scope.setUser({
      id: anonymousUserId(req.user.id),
      role: req.user.role,
    });
    scope.setTag('user_role', req.user.role);
  }
}

module.exports = {
  init,
  isInitialized,
  anonymousUserId,
  setRequestScope,
  // Esposti per uso da test/diagnostica:
  scrubObject,
  scrubBreadcrumb,
  scrubEvent,
};
