'use strict';

/**
 * Middleware audit log per Cadenza.
 *
 * Intercetta richieste di scrittura (POST/PUT/DELETE/PATCH) verso rotte
 * "sensibili" (admin / users / structure / quotas / mail-templates / …) e
 * scrive una riga in AuditLog DOPO che la response è stata inviata.
 *
 * Designazioni:
 *   - non blocca mai la risposta (write asincrona, log solo lato server in
 *     caso di fallimento)
 *   - skippa azioni con statusCode >= 400 (errori non sono "azioni" ma
 *     tentativi falliti)
 *   - sanitizza il payload per non scrivere mai password / token in DB
 *
 * Configurazione del match: regex su `req.originalUrl`, valutate in ordine
 * (la prima che matcha vince). Il pattern restituisce `targetType`.
 */

const logger = require('../lib/logger');

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// L'ordine conta: i pattern più specifici davanti.
// Ogni voce: { regex, targetType, skipBody?: bool }
const AUDIT_PATTERNS = [
  // Admin
  { regex: /^\/api\/admin\/quotas(?:\/(\d+))?/, targetType: 'quota' },
  { regex: /^\/api\/admin\/mail-templates\/?([^?]+)?/, targetType: 'mail_template' },
  { regex: /^\/api\/admin\/mail-settings/, targetType: 'mail_settings' },
  { regex: /^\/api\/admin\/instrument-loan-rules\/?([^?]+)?/, targetType: 'instrument_loan_rule' },
  {
    regex: /^\/api\/admin\/instrument-loan-quotas(?:\/(\d+))?/,
    targetType: 'instrument_loan_quota',
  },
  { regex: /^\/api\/admin\/announcements(?:\/(\d+))?(?:\/resend)?/, targetType: 'announcement' },
  { regex: /^\/api\/admin\/audit-log/, skip: true }, // mai loggare visualizzazioni audit

  // Users (sole singole modifiche, non login/list)
  { regex: /^\/api\/users\/(\d+)/, targetType: 'user' },

  // Structure (institute / building / room / equipment)
  { regex: /^\/api\/structure\/institutes(?:\/(\d+))?(?:\/(?:logo))?/, targetType: 'institute' },
  { regex: /^\/api\/structure\/buildings(?:\/(\d+))?/, targetType: 'building' },
  { regex: /^\/api\/structure\/rooms(?:\/(\d+))?(?:\/(?:photo|qr))?/, targetType: 'room' },
  { regex: /^\/api\/structure\/equipment(?:\/(\d+))?/, targetType: 'equipment' },
  { regex: /^\/api\/structure\/equipment-templates(?:\/(\d+))?/, targetType: 'equipment_template' },
  { regex: /^\/api\/structure\/import/, targetType: 'structure_import' },

  // Courses & rules (admin-controlled)
  { regex: /^\/api\/courses(?:\/(\d+))?/, targetType: 'course' },
  { regex: /^\/api\/course-levels(?:\/(\d+))?/, targetType: 'course_level' },
  { regex: /^\/api\/rules(?:\/exceptions)?(?:\/(\d+))?/, targetType: 'booking_rule' },

  // Instruments (admin write paths)
  { regex: /^\/api\/instruments(?:\/(\d+))?(?:\/photo)?/, targetType: 'instrument' },
];

/**
 * Restituisce { targetType, targetId } se la rotta è da auditare, altrimenti null.
 */
function matchAudit(req) {
  if (!AUDITED_METHODS.has(req.method)) return null;
  const url = req.originalUrl.split('?')[0];
  for (const pat of AUDIT_PATTERNS) {
    const m = pat.regex.exec(url);
    if (!m) continue;
    if (pat.skip) return null;
    const idStr = m[1];
    const targetId = idStr && /^\d+$/.test(idStr) ? Number(idStr) : null;
    return { targetType: pat.targetType, targetId };
  }
  return null;
}

// Campi mai persistibili in audit (anche se l'API li accetta)
const PAYLOAD_BLACKLIST = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'refreshToken',
  'googleClientSecret',
  'microsoftClientSecret',
]);

function sanitize(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 1000) return value.slice(0, 1000) + '…';
    return value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (PAYLOAD_BLACKLIST.has(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitize(v, depth + 1);
    }
  }
  return out;
}

/**
 * Estrae un summary minimo dalla response per facilitare il debug:
 *   - id dell'entità creata/aggiornata
 *   - eventuale `message`
 *   - eventuale `code` di errore
 * Non scrive l'intera response perché potrebbe essere grande (es. lista con
 * 100 entry) e non è necessario per l'audit trail.
 */
function summarizeResponse(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  // Ricerca ricorsiva limitata per id su prima entità nota
  const knownEntityKeys = [
    'user',
    'booking',
    'room',
    'building',
    'institute',
    'instrument',
    'loan',
    'course',
    'equipment',
    'quota',
    'rule',
    'exception',
    'template',
    'concertInfo',
  ];
  for (const k of knownEntityKeys) {
    if (body[k] && typeof body[k] === 'object' && body[k].id != null) {
      out.entityId = body[k].id;
      out.entityKey = k;
      break;
    }
  }
  if (typeof body.message === 'string' && body.message.length < 200) out.message = body.message;
  if (body.code) out.code = body.code;
  if (typeof body.deleted === 'number') out.deleted = body.deleted;
  return Object.keys(out).length ? out : null;
}

/**
 * Middleware audit. Va montato PRIMA dei router così abbiamo l'occasione
 * di sostituire `res.json` per intercettare la response.
 */
function auditMiddleware(req, res, next) {
  const match = matchAudit(req);
  if (!match) return next();

  // Cattura del body di risposta: wrappiamo res.json una sola volta.
  let capturedBody = null;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    capturedBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    // Skippa errori (4xx/5xx): non sono "azioni eseguite con successo".
    // Volendo si potrebbe loggare anche le 403/401 come "tentativi", ma
    // moltiplica i record audit con poco valore.
    if (res.statusCode >= 400) return;
    // Lazy require per evitare dipendenza circolare con models/index.
    let AuditLog;
    try {
      AuditLog = require('../models').AuditLog;
    } catch {
      return;
    }

    const entry = {
      actorId: req.user?.id ?? null,
      action: req.method,
      targetType: match.targetType,
      targetId: match.targetId,
      path: req.originalUrl.slice(0, 255),
      statusCode: res.statusCode,
      payload: sanitize(req.body),
      response: summarizeResponse(capturedBody),
      ip: req.ip || null,
      userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
    };
    AuditLog.create(entry).catch((err) => {
      logger.error({ err, entry: { ...entry, payload: undefined } }, 'audit log write failed');
    });
  });

  next();
}

module.exports = { auditMiddleware, matchAudit };
