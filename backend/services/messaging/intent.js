'use strict';

// =============================================================================
// Entry point del bot: smista il testo ricevuto al comando o al wizard.
//
// Moduli:
//   - dateTimeParser : parser puro di giorni/fasce orarie (no DB)
//   - bookWizard     : macchina a stati di /book (deps iniettabili)
//   - readCommands   : list, cancel, check, aule, agenda, libere
//   - catalog        : risoluzione sedi/aule/tipi
//   - telegramText   : escape Markdown, troncamento, formattazione giorni/ore
//
// Unica interfaccia pubblica: `handle({ text, user, session, channel })`.
// =============================================================================

const wizard = require('./bookWizard');
const {
  handleListMy,
  handleCancel,
  handleCheck,
  handleListRooms,
  handleAgenda,
  handleFreeRooms,
} = require('./readCommands');

const HELP_TEXT = `🤖 *Cadenza — Bot*

📅 *Vista d'insieme*
• /aule — elenco delle aule prenotabili (nome + codice)
• /agenda [data] — chi prenota cosa nel giorno (default: oggi)
• /oggi · /domani — scorciatoie per /agenda
• /libere [@sede] [data] [ora] — cerca aule libere con filtri opzionali

📝 *Prenotazione*
• /book — prenota un'aula (wizard: sede → aula → quando → tipo → conferma)
• /list — le mie prenotazioni future
• /cancel <id> — annulla la prenotazione
• /check <aula>[@sede] <data> — slot liberi del giorno per una specifica aula

ℹ️ *Altro*
• /help — questa guida

📌 *Esempi*
  \`/aule\`
  \`/agenda\`                            (oggi)
  \`/agenda venerdì\`
  \`/libere ven 14-15\`                   (libere venerdì 14-15, ovunque)
  \`/libere @Storica ven 14-15\`          (filtro sede)
  \`/libere ven\`                          (libere tutto il giorno)
  \`/book\`                                (wizard guidato)
  \`/book <codice> ven 14-15\`             (shortcut: aula + quando)
  \`/book <codice> ven 14-15 lezione\`     (con tipo attività)
  \`/check <codice> venerdì\`
  \`/check <codice>@Storica venerdì\`      (disambigua aule omonime)
  \`/cancel 142\`

Per qualsiasi dubbio: contatta la segreteria.`;

// =============================================================================
// Top-level handle: dato testo + sessione corrente, decide cosa fare.
// =============================================================================
async function handle({ text, user, session, channel: _channel }) {
  const cmd = String(text || '').trim();
  if (!cmd) return { reply: null };

  // /reset o annulla durante wizard
  if (/^\/?(annulla|reset|cancel-wizard)$/i.test(cmd)) {
    return {
      reply: '↩️ Operazione annullata.',
      session: { state: null, slots: null },
    };
  }

  // Se siamo in un wizard, smista al gestore di quello stato
  if (wizard.isWizardState(session.state)) {
    return wizard.step({ text: cmd, session });
  }

  // Smista per comando
  if (/^\/?(help|aiuto|guida)\b|^\?\s*$/i.test(cmd)) {
    return { intent: 'help', reply: HELP_TEXT };
  }
  if (/^\/?(list|elenco|mie\s+prenotazioni)\b/i.test(cmd)) {
    return handleListMy({ user });
  }
  // /aule, /rooms, /aula → lista delle aule prenotabili (no bookings).
  if (/^\/?(aule|rooms|aula)\b\s*$/i.test(cmd)) {
    return handleListRooms();
  }
  // /agenda [data], /oggi, /domani → snapshot prenotazioni del giorno
  // su tutte le aule, raggruppate per sede.
  const agendaMatch = cmd.match(/^\/?agenda(?:\s+(.+))?$/i);
  if (agendaMatch) {
    return handleAgenda({ dayQuery: (agendaMatch[1] || '').trim() || 'oggi' });
  }
  if (/^\/?oggi\b\s*$/i.test(cmd)) return handleAgenda({ dayQuery: 'oggi' });
  if (/^\/?domani\b\s*$/i.test(cmd)) return handleAgenda({ dayQuery: 'domani' });
  const cancelMatch = cmd.match(/^\/?cancel\s+(\d+)(?:\s+(.+))?$/i);
  if (cancelMatch) {
    return handleCancel({ user, id: Number(cancelMatch[1]), reason: cancelMatch[2] });
  }
  // /libere [@sede] [data] [ora] — cerca aule libere
  const freeMatch = cmd.match(/^\/?(libere|free)\b\s*(.*)$/i);
  if (freeMatch) {
    return handleFreeRooms({ argsLine: freeMatch[2] || '' });
  }
  // /check <aula>[@<sede>] <data>
  // L'aula può contenere spazi (es. "Aula 5", "Sala Prove"); la data è
  // sempre il singolo token finale (es. "venerdì", "2026-04-30").
  const checkMatch = cmd.match(/^\/?check\s+(.+)\s+(\S+)\s*$/i);
  if (checkMatch) {
    return handleCheck({ roomQuery: checkMatch[1].trim(), dayQuery: checkMatch[2].trim() });
  }
  // /book con o senza argomenti
  if (/^\/?(book|prenota)\b/i.test(cmd)) {
    const args = cmd.replace(/^\/?(book|prenota)\s*/i, '').trim();
    return wizard.start({ args, session });
  }

  // Fallback
  return {
    reply: `🤔 Non ho capito. Scrivi *help* o */help* per la guida.`,
  };
}

module.exports = { handle };
