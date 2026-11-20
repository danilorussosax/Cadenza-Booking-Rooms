'use strict';

/**
 * Modulo mail: unico punto che (a) costruisce il contesto comune dei template
 * (institute / now / copyright / baseUrl) e (b) fa getTemplate + render +
 * consegna. Tutta l'ora passa da lib/institutionTime, quindi ogni mail mostra
 * l'ora dell'istituto indipendentemente dal TZ del processo (VPS = UTC).
 *
 * Varianti di contesto (differenze volute, conservate):
 *  - 'notification' (default): footer "Cadenza · Per disattivare le notifiche
 *    <hint> vai sul tuo profilo." (o institute.copyright se impostato);
 *    now.dateTime = 'DD MMM YYYY · HH:mm'.
 *  - 'security' (reset password / setup): footer legale "© anno nome";
 *    now.dateTime = 'DD/MM/YYYY HH:mm'. Niente invito a disattivare notifiche
 *    perché le mail di sicurezza non sono disattivabili.
 *
 * Consegna (`deliver`):
 *  - 'queue' (default): enqueueMail, con gate bounce/throttle, priorità 5.
 *  - 'security': sendSecurityEmail, invio sincrono con fallback outbox,
 *    priorità 0, bypassa i gate.
 *  - con `transaction`: scrittura outbox nella transazione del chiamante
 *    (nessun gate, errori propagati).
 */

const institutionTime = require('../lib/institutionTime');

const DT_NOTIFICATION = 'DD MMM YYYY · HH:mm';
const DT_SECURITY = 'DD/MM/YYYY HH:mm';

// Lazy: emailService e models dipendono (indirettamente) da questo modulo.
const emailService = () => require('./emailService');

async function loadInstitute() {
  const { Institute } = require('../models');
  return Institute.findOne({
    attributes: ['name', 'copyright'],
    order: [['id', 'ASC']],
  }).catch(() => null);
}

function baseUrl() {
  return (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

/**
 * @param {object} [opts]
 * @param {object|null} [opts.institute] riga Institute già caricata (altrimenti la legge)
 * @param {Date|string} [opts.at] istante di riferimento (default: orologio istituto)
 * @param {'notification'|'security'} [opts.variant]
 * @param {string} [opts.footerHint] 'email' | 'avvisi' … (solo variant notification)
 * @param {string} [opts.timezone] override del fuso (default: institutionTime.getTimezone())
 */
async function buildContext({
  institute,
  at,
  variant = 'notification',
  footerHint = 'email',
  timezone,
} = {}) {
  const inst = institute === undefined ? await loadInstitute() : institute;
  const name = inst?.name || 'Cadenza';
  const fmt = (pattern) => institutionTime.format(at, pattern, { tz: timezone });
  const security = variant === 'security';
  return {
    institute: { name },
    now: {
      dateTime: fmt(security ? DT_SECURITY : DT_NOTIFICATION),
      date: fmt('DD/MM/YYYY'),
      time: fmt('HH:mm'),
    },
    copyright: security
      ? `© ${fmt('YYYY')} ${name}`
      : inst?.copyright ||
        `Cadenza · Per disattivare le notifiche ${footerHint} vai sul tuo profilo.`,
    baseUrl: baseUrl(),
  };
}

/** Contesto pronto per i template: institute.{name,copyright} + now + baseUrl. */
async function buildTemplateContext(opts = {}) {
  const base = await buildContext(opts);
  return {
    institute: { name: base.institute.name, copyright: base.copyright },
    now: base.now,
    baseUrl: base.baseUrl,
  };
}

/** Formatta un istante nell'ora istituto (per le variabili dei template). */
function formatAt(at, pattern, timezone) {
  return institutionTime.format(at, pattern, { tz: timezone });
}

/**
 * getTemplate + render + consegna.
 *
 * @param {string} kind kind del template
 * @param {object|Function} vars variabili specifiche; se funzione riceve il
 *   contesto comune e ritorna le variabili
 * @param {object} opts
 * @param {string} opts.to
 * @param {'queue'|'security'} [opts.deliver]
 * @param {number} [opts.priority] solo per 'queue' (default 5)
 * @param {string|null} [opts.idempotencyKey]
 * @param {object} [opts.transaction]
 * Il resto (institute, at, variant, footerHint, timezone) va a buildContext.
 * @returns {Promise<{ok:boolean, queued?:boolean, error?:string, code?:string}>}
 */
async function renderAndQueue(kind, vars, opts = {}) {
  const {
    to,
    deliver = 'queue',
    priority,
    idempotencyKey,
    transaction,
    replyTo,
    ...ctxOpts
  } = opts;
  const svc = emailService();
  const tpl = await svc.getTemplate(kind);
  if (!tpl) {
    return {
      ok: false,
      queued: false,
      error: `template ${kind} mancante`,
      code: 'TEMPLATE_MISSING',
    };
  }

  const common = await buildTemplateContext({
    variant: deliver === 'security' ? 'security' : 'notification',
    ...ctxOpts,
  });
  const resolved = typeof vars === 'function' ? vars(common) : vars;
  const ctx = { ...common, ...resolved };
  // Se le vars portano un blocco institute proprio lo uniamo al comune.
  if (resolved?.institute) ctx.institute = { ...common.institute, ...resolved.institute };
  const subject = svc.renderText(tpl.subject, ctx);
  const html = svc.render(tpl.bodyHtml, ctx);

  if (deliver === 'security') {
    return svc.sendSecurityEmail({ to, subject, html });
  }
  return svc.enqueueMail({
    kind,
    to,
    subject,
    html,
    replyTo,
    priority: typeof priority === 'number' ? priority : 5,
    idempotencyKey,
    transaction,
  });
}

module.exports = { buildContext, buildTemplateContext, renderAndQueue, formatAt };
