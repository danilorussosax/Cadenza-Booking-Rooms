'use strict';

/**
 * Template HTML predefiniti per le email di sistema.
 * Vengono creati al primo avvio (auto-seed) e usati come fallback se
 * la riga mail_templates corrispondente non esiste o è disabilitata.
 *
 * Variabili disponibili al render:
 *   user.firstName, user.lastName, user.email
 *   booking.purpose, booking.type, booking.dateLong, booking.timeRange,
 *   booking.cancelReason, booking.duration
 *   room.name, room.floor
 *   building.name
 *   institute.name, institute.copyright
 *   now.dateTime
 */

const BASE_STYLES = `
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

function wrap(pillHtml, title, intro, rowsHtml, footerExtra = '') {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
<body>
  <div class="card">
    <div style="margin-bottom: 12px">${pillHtml}</div>
    <h1>${title}</h1>
    <p class="meta">${intro}</p>
    <div style="margin-top: 16px">
${rowsHtml}
    </div>
    <p class="footer">{{institute.copyright}}${footerExtra ? ' · ' + footerExtra : ''}</p>
  </div>
</body></html>`;
}

const COMMON_ROWS = `      <div class="row"><div class="label">Aula</div><div class="val">{{room.name}}{{#if building.name}} · {{building.name}}{{/if}}{{#if room.floor}} · {{room.floor}}{{/if}}</div></div>
      <div class="row"><div class="label">Quando</div><div class="val">{{booking.dateLong}}</div></div>
      <div class="row"><div class="label">Orario</div><div class="val">{{booking.timeRange}}</div></div>
      <div class="row"><div class="label">Tipo</div><div class="val">{{booking.type}}</div></div>
      {{#if booking.purpose}}<div class="row"><div class="label">Titolo</div><div class="val">{{booking.purpose}}</div></div>{{/if}}`;

const LOAN_ROWS = `      <div class="row"><div class="label">Strumento</div><div class="val">{{instrument.name}}{{#if instrument.code}} · {{instrument.code}}{{/if}}{{#if instrument.brand}} · {{instrument.brand}}{{/if}}{{#if instrument.model}} · {{instrument.model}}{{/if}}</div></div>
      <div class="row"><div class="label">Periodo</div><div class="val">{{loan.fromDateLong}} → {{loan.toDateLong}}</div></div>
      <div class="row"><div class="label">Durata</div><div class="val">{{loan.durationLabel}}</div></div>
      {{#if loan.notes}}<div class="row"><div class="label">Note</div><div class="val">{{loan.notes}}</div></div>{{/if}}`;

const DEFAULTS = {
  confirmation: {
    subject: 'Prenotazione confermata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-ok">CONFERMATA</span>',
      'Prenotazione confermata',
      'Ciao {{user.firstName}}, la tua prenotazione è stata registrata. Ecco i dettagli:',
      COMMON_ROWS,
    ),
  },
  reminder: {
    subject: 'Promemoria · La tua prenotazione tra 1 ora · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">PROMEMORIA</span>',
      'La tua sessione inizia tra circa 1 ora',
      "Ciao {{user.firstName}}, ti ricordiamo l'appuntamento di oggi:",
      COMMON_ROWS,
    ),
  },
  cancellation: {
    subject: 'Prenotazione annullata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-cancel">ANNULLATA</span>',
      'Prenotazione annullata',
      "Ciao {{user.firstName}}, ti confermiamo l'annullamento della seguente prenotazione:",
      `${COMMON_ROWS}
      {{#if booking.cancelReason}}<div class="row"><div class="label">Motivo</div><div class="val">{{booking.cancelReason}}</div></div>{{/if}}`,
    ),
  },
  ghost_cancellation: {
    subject: 'Prenotazione annullata: nessun check-in · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-cancel">AUTO-ANNULLATA</span>',
      'Prenotazione annullata per mancato check-in',
      "Ciao {{user.firstName}}, la tua prenotazione è stata annullata automaticamente perché non è stato registrato il check-in entro il tempo di tolleranza. L'aula è stata liberata e resa disponibile ad altri utenti. Per la prossima prenotazione ricordati di scansionare il QR all'ingresso dell'aula:",
      COMMON_ROWS,
    ),
  },
  loan_requested: {
    subject: 'Richiesta di prestito ricevuta · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">RICHIESTA</span>',
      'Richiesta di prestito ricevuta',
      "Ciao {{user.firstName}}, abbiamo ricevuto la tua richiesta di prestito. Ti avviseremo non appena un amministratore l'avrà valutata:",
      LOAN_ROWS,
    ),
  },
  loan_approved: {
    subject: 'Prestito approvato · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-ok">APPROVATO</span>',
      'Prestito approvato',
      'Ciao {{user.firstName}}, la tua richiesta è stata approvata. Puoi ritirare lo strumento secondo gli accordi con la segreteria:',
      LOAN_ROWS,
    ),
  },
  loan_rejected: {
    subject: 'Prestito non approvato · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-cancel">NON APPROVATO</span>',
      'Prestito non approvato',
      'Ciao {{user.firstName}}, la tua richiesta di prestito non è stata approvata. Per maggiori informazioni contatta la segreteria:',
      LOAN_ROWS,
    ),
  },
  loan_returned: {
    subject: 'Restituzione registrata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-ok">RESTITUITO</span>',
      'Restituzione registrata',
      'Ciao {{user.firstName}}, abbiamo registrato la restituzione del seguente strumento:',
      LOAN_ROWS,
    ),
  },
  loan_reminder: {
    subject:
      'Promemoria · Restituzione strumento tra {{loan.daysToReturn}} giorni · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">PROMEMORIA</span>',
      'Restituzione strumento in scadenza',
      'Ciao {{user.firstName}}, ti ricordiamo che il prestito qui sotto sta per scadere. Riconsegna lo strumento entro la data prevista per non finire in stato "scaduto":',
      LOAN_ROWS,
    ),
  },
  loan_overdue: {
    subject: 'Restituzione strumento in ritardo · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-cancel">SCADUTO</span>',
      'Prestito scaduto: restituisci al più presto',
      'Ciao {{user.firstName}}, il prestito sotto indicato risulta scaduto. Ti chiediamo di restituire lo strumento al più presto:',
      LOAN_ROWS,
    ),
  },
  announcement_published: {
    subject: 'Avviso: {{announcement.title}} · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">AVVISO</span>',
      '{{announcement.title}}',
      'Ciao {{user.firstName}}, è stato pubblicato un nuovo avviso che ti riguarda:',
      `<div class="row"><div class="val" style="white-space:pre-wrap;line-height:1.6;font-size:14px">{{announcement.body}}</div></div>
      {{#if announcement.expiresAtLong}}<div class="row"><div class="label">Scade</div><div class="val">{{announcement.expiresAtLong}}</div></div>{{/if}}`,
    ),
  },
  claim_waitlist: {
    subject: 'È il tuo turno: aula liberata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-ok">DISPONIBILE</span>',
      "L'aula che attendevi è libera",
      'Ciao {{user.firstName}}, una prenotazione è stata cancellata e ora puoi confermare il tuo posto. Hai 30 minuti di tempo: oltre questo limite la coda passa al successivo.',
      `${COMMON_ROWS}
      <div style="margin-top:24px;text-align:center;">
        <a href="{{extra.claimUrl}}" style="display:inline-block;background:#0f5132;color:#fff;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">Conferma prenotazione</a>
      </div>
      <p style="margin-top:16px;font-size:12px;color:#6b7280;">Scade alle {{extra.expiresAt}}.</p>`,
    ),
  },
  booking_pending_admin: {
    subject: 'Nuova richiesta di prenotazione da approvare · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">DA APPROVARE</span>',
      'Richiesta di prenotazione in attesa',
      "{{user.firstName}} {{user.lastName}} ha richiesto la prenotazione di un'aula soggetta ad approvazione. Verifica i dettagli e approva o rifiuta dal pannello amministratore.",
      `${COMMON_ROWS}
      <div class="row"><div class="label">Richiedente</div><div class="val">{{user.firstName}} {{user.lastName}} · {{user.email}}</div></div>`,
    ),
  },
  booking_approved: {
    subject: 'Prenotazione approvata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-ok">APPROVATA</span>',
      'La tua prenotazione è stata approvata',
      "Ciao {{user.firstName}}, la richiesta per un'aula soggetta ad approvazione è stata accolta. La prenotazione è ora confermata:",
      COMMON_ROWS,
    ),
  },
  booking_rejected: {
    subject: 'Prenotazione non approvata · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-cancel">NON APPROVATA</span>',
      'La tua richiesta non è stata approvata',
      'Ciao {{user.firstName}}, la richiesta per la seguente prenotazione non è stata approvata. Puoi contattare la segreteria per maggiori informazioni o presentare una nuova richiesta.',
      `${COMMON_ROWS}
      {{#if booking.cancelReason}}<div class="row"><div class="label">Motivo</div><div class="val">{{booking.cancelReason}}</div></div>{{/if}}`,
    ),
  },
  password_reset: {
    subject: 'Reimposta la tua password · {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">SICUREZZA</span>',
      'Reimposta la tua password',
      'Ciao {{user.firstName}}, abbiamo ricevuto una richiesta di reimpostazione della tua password. Clicca il pulsante qui sotto per scegliere una nuova password. Il link è valido per 1 ora ed è utilizzabile una sola volta.',
      `<div class="row" style="border:0; padding:16px 0">
        <a href="{{reset.url}}" style="display:inline-block; background:#3762aa; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:14px;">Reimposta password</a>
      </div>
      <div class="row"><div class="label">Scadenza</div><div class="val">{{reset.expiresAtLong}}</div></div>
      <div class="row"><div class="label">Account</div><div class="val">{{user.email}}</div></div>
      <p class="meta" style="margin-top: 16px; font-size: 12px; color: #6b7a90;">
        Se non sei stato tu a richiedere il reset, ignora questa email: la tua password non verrà modificata.
        Per motivi di sicurezza, dopo la reimpostazione tutte le sessioni attive verranno disconnesse.
      </p>`,
    ),
  },
  initial_setup: {
    subject: 'Benvenuto in Cadenza — Gestione aule e prenotazioni — {{institute.name}}',
    bodyHtml: wrap(
      '<span class="pill pill-info">PRIMO ACCESSO</span>',
      'Benvenuto, {{user.firstName}}',
      "L'amministrazione di {{institute.name}} ha creato il tuo account su Cadenza, la piattaforma per la gestione delle aule e delle prenotazioni del Conservatorio. Per iniziare, scegli la tua password cliccando il pulsante qui sotto.",
      `<div class="row" style="border:0; padding:16px 0">
        <a href="{{reset.url}}" style="display:inline-block; background:#3762aa; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:14px;">Imposta la mia password</a>
      </div>
      <div class="row"><div class="label">Account</div><div class="val">{{user.email}}</div></div>
      <div class="row"><div class="label">Scadenza link</div><div class="val">{{reset.expiresAtLong}}</div></div>
      <p class="meta" style="margin-top: 16px; font-size: 12px; color: #6b7a90;">
        Il link è valido fino alla data indicata e può essere usato una sola volta. Se è scaduto, contatta la
        Segreteria del Conservatorio per riceverne uno nuovo. Una volta impostata la password potrai accedere
        con la tua email.
      </p>`,
    ),
  },
};

const KINDS = Object.keys(DEFAULTS);
const KIND_LABELS = {
  confirmation: 'Conferma prenotazione',
  reminder: 'Promemoria',
  cancellation: 'Annullamento',
  ghost_cancellation: 'Annullamento per mancato check-in',
  loan_requested: 'Prestito · richiesta ricevuta',
  loan_approved: 'Prestito · approvato',
  loan_rejected: 'Prestito · non approvato',
  loan_returned: 'Prestito · restituito',
  loan_reminder: 'Prestito · promemoria scadenza',
  loan_overdue: 'Prestito · scaduto',
  claim_waitlist: 'Coda · aula libera',
  announcement_published: 'Bacheca · nuovo avviso',
  booking_pending_admin: 'Approvazione · richiesta in attesa',
  booking_approved: 'Approvazione · prenotazione approvata',
  booking_rejected: 'Approvazione · prenotazione non approvata',
  password_reset: 'Sicurezza · reimposta password',
  initial_setup: 'Primo accesso · imposta password',
};

module.exports = { DEFAULTS, KINDS, KIND_LABELS };
