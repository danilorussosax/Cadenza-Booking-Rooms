'use strict';

// =============================================================================
// POST /api/csp-report
//
// Endpoint pubblico (no auth) per ricevere CSP violation reports dal browser.
// Il browser invia automaticamente reports quando l'utente o uno script
// violano la policy dichiarata in `Content-Security-Policy`:
//
//   - Sintassi legacy (Chrome <94, Firefox, Safari pre-17): JSON con root
//     `{ "csp-report": {...} }` e content-type `application/csp-report`.
//   - Sintassi moderna (Chrome 94+, Reporting API): array di
//     `{ type, age, body, ... }` con content-type `application/reports+json`.
//
// Strategia:
//   - Loggiamo TUTTO con pino (scope: csp.violation) per analisi log
//   - Inoltriamo a Sentry come breadcrumb + event lieve (non error) se DSN
//     configurato — l'admin vede il volume e i dettagli in dashboard
//   - Risposta sempre 204 No Content (il browser ignora il body)
//   - Rate-limit per evitare flood di report (estensioni rumorose)
// =============================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const logger = require('../lib/logger').child({ scope: 'csp.violation' });
const sentryLib = require('../lib/sentry');

// Endpoint pubblico: oltre al limiter globale /api/ serve un tetto dedicato
// più severo — un'estensione rumorosa o un flood doloso non deve saturare
// log e quota Sentry.
const cspReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parser dedicato: il browser usa due content-type. Express bodyParser
// di default gestisce solo `application/json` → senza override perderemmo
// i report `application/csp-report`.
router.post(
  '/',
  cspReportLimiter,
  express.json({
    type: ['application/json', 'application/csp-report', 'application/reports+json'],
  }),
  (req, res) => {
    try {
      // Normalizza: legacy `{csp-report: {...}}` → primo elemento;
      // reports moderni: array di {type, body}.
      const payload = req.body;
      let violations = [];
      if (payload && Array.isArray(payload)) {
        // Reporting API moderna
        violations = payload
          .filter((r) => r && (r.type === 'csp-violation' || r.body))
          .map((r) => r.body || r);
      } else if (payload && payload['csp-report']) {
        // Legacy
        violations = [payload['csp-report']];
      } else if (payload && typeof payload === 'object') {
        // Body singolo (raro)
        violations = [payload];
      }

      if (violations.length === 0) {
        return res.status(204).end();
      }

      for (const v of violations) {
        const summary = {
          documentURI: v['document-uri'] || v.documentURL || null,
          violatedDirective: v['violated-directive'] || v.effectiveDirective || null,
          blockedURI: v['blocked-uri'] || v.blockedURL || null,
          sourceFile: v['source-file'] || v.sourceFile || null,
          lineNumber: v['line-number'] || v.lineNumber || null,
          disposition: v.disposition || 'enforce',
          // User-Agent può aiutare a discriminare estensioni note (chrome-extension://)
          // da violazioni reali. Loggato ma non incluso negli alert Sentry per ridurre rumore.
          userAgent: req.get('user-agent') || null,
        };
        logger.warn(summary, 'CSP violation');

        // Sentry: solo se inizializzato. Inviato come messaggio "warning"
        // (no error) per non sporcare il rate-limit error events.
        if (sentryLib.isInitialized()) {
          try {
            const Sentry = require('@sentry/node');
            Sentry.captureMessage(
              `CSP: ${summary.violatedDirective || 'unknown'} blocked ${summary.blockedURI || 'n/a'}`,
              {
                level: 'warning',
                tags: {
                  csp_directive: summary.violatedDirective,
                  csp_disposition: summary.disposition,
                },
                extra: summary,
              },
            );
          } catch {
            /* Sentry failure non deve bloccare la response */
          }
        }
      }

      // 204 No Content: il browser non legge il body, evitiamo overhead.
      res.status(204).end();
    } catch (err) {
      logger.error({ err: err.message }, 'CSP report handler error');
      res.status(204).end();
    }
  },
);

module.exports = router;
