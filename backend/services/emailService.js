'use strict';

/**
 * Servizio email per Cadenza.
 * La configurazione SMTP viene letta da DB (tabella mail_settings)
 * gestita via UI admin. Fallback alle env SMTP_* se la tabella è vuota
 * o disabilitata (utile in sviluppo).
 */

const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
require('dayjs/locale/it');
dayjs.locale('it');
const { decrypt } = require('../lib/crypto');
const { render, renderText } = require('./templateRenderer');
const { DEFAULTS: TEMPLATE_DEFAULTS } = require('./mailTemplateDefaults');

let cache = null; // { transporter, from, replyTo, expiresAt }
const CACHE_TTL_MS = 60_000;
let warned = false;

async function loadConfig() {
  if (cache && cache.expiresAt > Date.now()) return cache;

  const { MailSettings } = require('../models');
  const row = await MailSettings.findByPk(1).catch(() => null);

  let host, port, secure, user, pass, from, replyTo;

  if (row && row.isEnabled && row.host) {
    host = row.host;
    port = row.port || 587;
    secure = !!row.secure;
    user = row.username || undefined;
    pass = row.passwordEncrypted ? decrypt(row.passwordEncrypted) : undefined;
    const fromAddr = row.fromAddress || user;
    from = fromAddr ? (row.fromName ? `${row.fromName} <${fromAddr}>` : fromAddr) : null;
    replyTo = row.replyTo || undefined;
  } else if (process.env.SMTP_HOST) {
    host = process.env.SMTP_HOST;
    port = Number(process.env.SMTP_PORT || 587);
    secure = process.env.SMTP_SECURE === 'true';
    user = process.env.SMTP_USER;
    pass = process.env.SMTP_PASS;
    from = process.env.SMTP_FROM || 'Cadenza <noreply@cadenza.local>';
  } else {
    if (!warned) {
      console.warn('[email] Nessuna configurazione SMTP (né DB né env) → email disattivate.');
      warned = true;
    }
    cache = { transporter: null, from: null, expiresAt: Date.now() + CACHE_TTL_MS };
    return cache;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  cache = {
    transporter,
    from: from || 'Cadenza <noreply@cadenza.local>',
    replyTo,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return cache;
}

function invalidateCache() {
  cache = null;
}

async function emailEnabled() {
  const cfg = await loadConfig();
  return !!cfg?.transporter;
}

async function getTransporter() {
  const cfg = await loadConfig();
  return cfg?.transporter ?? null;
}

async function senderFrom() {
  const cfg = await loadConfig();
  return cfg?.from || 'Cadenza <noreply@cadenza.local>';
}

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #1a2234; background: #f7f9fc; margin: 0; padding: 24px; }
  .card { max-width: 540px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 8px; color: #3762aa; }
  .meta { color: #4a5568; font-size: 14px; line-height: 1.6; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
  .pill-ok { background: #d1fae5; color: #065f46; }
  .pill-cancel { background: #fee2e2; color: #991b1b; }
  .pill-info { background: #dbeafe; color: #1e40af; }
  .row { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
  .row:last-child { border: 0; }
  .label { width: 110px; color: #6b7a90; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 2px; }
  .val { flex: 1; font-size: 14px; }
  .footer { margin-top: 16px; color: #9aa5b4; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; text-align: center; }
`;

const TYPE_LABEL = {
  studio_individuale: 'Studio individuale',
  lezione: 'Lezione',
  prova: 'Prova',
  concerto: 'Concerto',
  altro: 'Altro',
};

/**
 * Costruisce il contesto da passare al template renderer.
 * Le date sono pre-formattate (locale italiano) per semplicità degli admin.
 */
async function buildBookingContext({ user, booking, extra }) {
  const { Institute } = require('../models');
  const inst = await Institute.findOne({
    attributes: ['name', 'copyright'],
    order: [['id', 'ASC']],
  }).catch(() => null);

  const room = booking.room || {};
  const building = room.building || {};
  const start = dayjs(booking.startTime);
  const end = dayjs(booking.endTime);
  const durMin = Math.max(0, end.diff(start, 'minute'));

  return {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      matricola: user.matricola || '',
    },
    booking: {
      type: TYPE_LABEL[booking.type] || booking.type,
      purpose: booking.purpose || '',
      cancelReason: booking.cancelReason || '',
      dateLong: start.format('dddd D MMMM YYYY'),
      dateShort: start.format('DD/MM/YYYY'),
      timeRange: `${start.format('HH:mm')} – ${end.format('HH:mm')}`,
      startTime: start.format('HH:mm'),
      endTime: end.format('HH:mm'),
      duration: durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin} min`,
    },
    room: {
      name: room.name || '',
      floor: room.floor || '',
      capacity: room.capacity || '',
    },
    building: { name: building.name || '' },
    institute: {
      name: inst?.name || 'Cadenza',
      copyright:
        inst?.copyright || 'Cadenza · Per disattivare le notifiche email vai sul tuo profilo.',
    },
    now: { dateTime: dayjs().format('DD MMM YYYY · HH:mm') },
    // Campo libero per dati specifici del kind (es. claim_waitlist passa
    // claimUrl + expiresAt). Reso assoluto per i link cliccabili dalle
    // email: prependiamo FRONTEND_URL se i path arrivano relativi.
    extra: normalizeExtra(extra),
  };
}

function normalizeExtra(extra) {
  if (!extra || typeof extra !== 'object') return {};
  const out = { ...extra };
  const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (out.claimUrl && typeof out.claimUrl === 'string' && out.claimUrl.startsWith('/') && base) {
    out.claimUrl = `${base}${out.claimUrl}`;
  }
  if (out.expiresAt instanceof Date) {
    out.expiresAt = dayjs(out.expiresAt).format('DD MMM YYYY · HH:mm');
  }
  return out;
}

/**
 * Carica il template per il kind, fallback ai defaults se non presente / disabilitato.
 */
async function getTemplate(kind) {
  if (!TEMPLATE_DEFAULTS[kind]) return null;
  const { MailTemplate } = require('../models');
  const row = await MailTemplate.findOne({ where: { kind } }).catch(() => null);
  if (row && row.isEnabled) {
    return { subject: row.subject, bodyHtml: row.bodyHtml };
  }
  return TEMPLATE_DEFAULTS[kind];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mappa kind → flag granulare sull'utente.
// Se l'utente ha disattivato lo specifico tipo, l'email NON parte.
// emailNotifications resta master-switch globale (false = blocca tutto).
const KIND_PREF_FIELD = {
  confirmation: 'notifyOnConfirmation',
  reminder: 'notifyOnReminder',
  cancellation: 'notifyOnCancellation',
  // Ghost cancel è una variante di cancellazione: rispetta lo stesso flag.
  ghost_cancellation: 'notifyOnCancellation',
  // Claim waitlist = "buona notizia, c'è posto" → riusa flag conferma.
  claim_waitlist: 'notifyOnConfirmation',
  // Approvazione: l'utente vede l'esito della richiesta. Mappiamo l'esito
  // positivo su 'notifyOnConfirmation' e quello negativo su
  // 'notifyOnCancellation' per coerenza con i flag esistenti.
  // booking_pending_admin viene inviata all'admin (non all'utente che ha
  // richiesto): nessun mapping qui — l'invio avviene solo se admin ha
  // emailNotifications=true.
  booking_approved: 'notifyOnConfirmation',
  booking_rejected: 'notifyOnCancellation',
};

async function sendBookingEmail({ user, booking, kind, extra }) {
  if (!user?.email || user.emailNotifications === false) return;
  // Preferenza granulare per tipologia (default true se mai impostata)
  const prefField = KIND_PREF_FIELD[kind];
  if (prefField && user[prefField] === false) return;
  const cfg = await loadConfig();
  if (!cfg?.transporter) return;
  const tpl = await getTemplate(kind);
  if (!tpl) return;
  const ctx = await buildBookingContext({ user, booking, extra });
  try {
    await cfg.transporter.sendMail({
      from: cfg.from,
      to: user.email,
      replyTo: cfg.replyTo,
      subject: renderText(tpl.subject, ctx),
      html: render(tpl.bodyHtml, ctx),
    });
  } catch (err) {
    console.error('[email] errore invio:', err.message);
  }
}

/**
 * Invia un'email di test arbitraria (usato dalla pagina admin mail-settings).
 * Restituisce { ok: bool, error?: string }.
 */
function smtpHumanError(err) {
  const msg = String(err?.message || err || '');
  // Mismatch porta/protocollo (caso più comune)
  if (
    /wrong version number/i.test(msg) ||
    /SSL routines/i.test(msg) ||
    /unsupported protocol/i.test(msg)
  ) {
    return 'Mismatch porta/protocollo SMTP. Tipicamente: porta 465 richiede TLS implicito (secure ON); porta 587 richiede STARTTLS (secure OFF). Verifica la combinazione.';
  }
  if (/getaddrinfo|ENOTFOUND/i.test(msg)) {
    return 'Host SMTP non raggiungibile (DNS). Controlla il nome del server.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(msg)) {
    return 'Connessione rifiutata o scaduta. Verifica host, porta e firewall.';
  }
  if (/535|EAUTH|auth/i.test(msg)) {
    return 'Autenticazione SMTP fallita: username o password errati (per Google/Microsoft serve una "App password").';
  }
  if (/self.signed|unable to verify/i.test(msg)) {
    return 'Certificato TLS non verificabile (self-signed). Contatta il provider SMTP.';
  }
  return msg;
}

async function sendTestEmail({ to, subject, message }) {
  invalidateCache(); // forza ricarica delle nuove credenziali appena salvate
  const cfg = await loadConfig();
  if (!cfg?.transporter) {
    return { ok: false, error: 'Configurazione SMTP mancante o disabilitata' };
  }
  try {
    await cfg.transporter.sendMail({
      from: cfg.from,
      to,
      replyTo: cfg.replyTo,
      subject: subject || 'Test invio email · Cadenza',
      html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;padding:24px">
        <h2 style="color:#3762aa">Cadenza · email di test</h2>
        <p>${escapeHtml(
          message ||
            'Questo è un messaggio di test inviato dalla pagina amministrazione del server di posta. Se lo ricevi, la configurazione SMTP è corretta.',
        )}</p>
        <p style="color:#9aa5b4;font-size:11px;margin-top:32px">Inviato il ${dayjs().format(
          'DD MMM YYYY · HH:mm:ss',
        )}</p>
      </body></html>`,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: smtpHumanError(err),
      raw: err.message || String(err),
    };
  }
}

/**
 * Email "di sicurezza" che NON rispetta le preferenze granulari di notifica
 * (un codice 2FA deve sempre arrivare). Restituisce { ok, error? }.
 * Usata per: codice 2FA via email, alert sicurezza, recovery flow.
 */
async function sendSecurityEmail({ to, subject, html }) {
  const cfg = await loadConfig();
  if (!cfg?.transporter) {
    return { ok: false, error: 'SMTP non configurato' };
  }
  try {
    await cfg.transporter.sendMail({
      from: cfg.from,
      to,
      replyTo: cfg.replyTo,
      subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error('[email-security] errore invio:', err.message);
    return { ok: false, error: smtpHumanError(err) };
  }
}

module.exports = {
  emailEnabled,
  sendBookingEmail,
  sendSecurityEmail,
  sendTestEmail,
  invalidateCache,
  getTemplate,
  buildBookingContext,
  // Esposti per altri servizi (es. announcementEmail) che condividono il
  // transporter + il template renderer. Non considerare API pubblica.
  loadConfig,
  render,
  renderText,
  // Esposto per altri servizi che condividono SMTP/cache/from
  // (es. instrumentLoanEmail). Non considerare API pubblica.
  _internal: { loadConfig, getTransporter, senderFrom },
};
