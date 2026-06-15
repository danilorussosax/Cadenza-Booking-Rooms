'use strict';

// =============================================================================
// scripts/telegram-setup — configura/verifica il bot Telegram dal VPS.
//
// Fa, da CLI, esattamente ciò che fa il bottone "Auto-configura" della UI admin
// (services/messaging/telegramSetup.autoConfigure), ma senza bisogno di un JWT
// admin: legge/scrive direttamente la riga `messaging_settings` (channel=
// 'telegram') con le credenziali cifrate via lib/crypto, poi registra il
// webhook su Telegram e stampa l'esito di ogni step.
//
// MODI D'USO (dalla cartella backend/):
//
//   1. Verifica stato (read-only, NON tocca nulla):
//        node scripts/telegram-setup.js --check
//
//   2. Configurazione completa (idempotente, ri-eseguibile):
//        BOT_TOKEN=123456:AAEh... node scripts/telegram-setup.js
//      oppure passando il token come argomento (meno sicuro: finisce in
//      `ps`/history):
//        node scripts/telegram-setup.js --token 123456:AAEh...
//
//      Se il token è già salvato in DB da una run precedente, puoi ometterlo
//      e riusare quello esistente (utile per ri-registrare solo il webhook):
//        node scripts/telegram-setup.js
//
//   Opzioni:
//     --url   https://dominio.it   override di FRONTEND_URL (URL pubblico https)
//     --name  "Cadenza Bot"        setMyName (best-effort)
//     --check                      solo verifica, nessuna scrittura
//
// Prerequisiti: FRONTEND_URL (o --url) deve essere un URL https pubblico —
// Telegram rifiuta http e localhost.
// =============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const { sequelize, MessagingSettings } = require('../models');
const { encrypt, decrypt } = require('../lib/crypto');
const telegramSetup = require('../services/messaging/telegramSetup');

const TELEGRAM_API = 'https://api.telegram.org';

// --- parsing argomenti -------------------------------------------------------
function parseArgs(argv) {
  const out = { check: false, token: null, url: null, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--name') out.name = argv[++i];
  }
  return out;
}

/** Maschera un token per il log: mostra solo `<botId>:…<ultimi 4>`. */
function maskToken(token) {
  if (typeof token !== 'string' || !token.includes(':')) return '(assente)';
  const [id, secret] = token.split(':');
  const tail = secret ? secret.slice(-4) : '????';
  return `${id}:…${tail}`;
}

/** Carica la riga telegram + credenziali decifrate (o struttura vuota). */
async function loadRow() {
  const row = await MessagingSettings.findOne({ where: { channel: 'telegram' } });
  let credentials = {};
  if (row?.credentialsEncrypted) {
    try {
      credentials = JSON.parse(decrypt(row.credentialsEncrypted));
    } catch {
      credentials = {};
    }
  }
  return { row, credentials };
}

/** getWebhookInfo standalone (per --check). */
async function getWebhookInfo(token) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json?.description || `HTTP ${res.status}`);
  }
  return json.result;
}

// --- modo CHECK (read-only) --------------------------------------------------
async function runCheck() {
  const { row, credentials } = await loadRow();
  console.log('═══ Stato Telegram (read-only) ═══\n');
  if (!row) {
    console.log('❌ Nessuna riga messaging_settings per "telegram". Bot mai configurato.');
    return;
  }
  console.log(`isEnabled        : ${row.isEnabled ? '✅ true' : '❌ false'}`);
  console.log(
    `botToken         : ${credentials.botToken ? `✅ ${maskToken(credentials.botToken)}` : '❌ assente'}`,
  );
  console.log(`webhookSecret    : ${credentials.webhookSecret ? '✅ presente' : '❌ assente'}`);

  if (!credentials.botToken) {
    console.log('\n→ Manca il botToken: lancia lo script in modo configure.');
    return;
  }

  try {
    const info = await getWebhookInfo(credentials.botToken);
    const expected = telegramSetup.buildWebhookUrl(
      process.env.FRONTEND_URL || process.env.APP_URL || '',
    );
    console.log('\n─── Telegram getWebhookInfo ───');
    console.log(`url              : ${info.url || '(vuoto)'}`);
    console.log(`atteso           : ${expected || '(FRONTEND_URL non impostato)'}`);
    const matches = expected && info.url === expected;
    console.log(`match URL        : ${matches ? '✅' : '⚠️ no'}`);
    console.log(`pending updates  : ${info.pending_update_count ?? 0}`);
    console.log(`last error       : ${info.last_error_message || '— nessuno'}`);
    console.log(`webhook          : ${info.url ? '✅ attivo' : '❌ nessun webhook registrato'}`);
  } catch (err) {
    console.log(`\n❌ getWebhookInfo fallito: ${err.message} (token errato o revocato?)`);
  }
}

// --- modo CONFIGURE ----------------------------------------------------------
async function runConfigure(args) {
  const { row, credentials } = await loadRow();
  const targetRow =
    row || (await MessagingSettings.create({ channel: 'telegram', isEnabled: false }));

  // Token: priorità a env BOT_TOKEN > --token > quello già salvato in DB.
  const token = process.env.BOT_TOKEN || args.token || credentials.botToken;
  if (!token) {
    throw new Error(
      'botToken mancante. Passa BOT_TOKEN=... come variabile env, --token <TOKEN>, ' +
        'oppure salvane uno prima dalla UI admin.',
    );
  }
  credentials.botToken = token;

  // webhookSecret: genera se assente (32 byte hex).
  let secretGenerated = false;
  if (!credentials.webhookSecret) {
    credentials.webhookSecret = crypto.randomBytes(32).toString('hex');
    secretGenerated = true;
  }

  const frontendUrl = args.url || process.env.FRONTEND_URL || process.env.APP_URL || '';

  console.log('═══ Configurazione Telegram ═══\n');
  console.log(`token   : ${maskToken(token)}`);
  console.log(`url base: ${frontendUrl || '(vuoto!)'}`);
  console.log(`secret  : ${secretGenerated ? '🔑 generato ora' : 'riuso esistente'}\n`);

  let result;
  try {
    result = await telegramSetup.autoConfigure({
      botToken: credentials.botToken,
      webhookSecret: credentials.webhookSecret,
      frontendUrl,
      botName: args.name,
    });
  } catch (err) {
    // Persisti comunque il secret generato così la prossima run non lo rigenera.
    if (secretGenerated) {
      targetRow.credentialsEncrypted = encrypt(JSON.stringify(credentials));
      await targetRow.save();
      console.log('(secret generato salvato per la prossima run)\n');
    }
    throw err;
  }

  // Successo → persisti credenziali + abilita il canale.
  targetRow.credentialsEncrypted = encrypt(JSON.stringify(credentials));
  targetRow.isEnabled = true;
  await targetRow.save();

  // Stampa esito step.
  console.log(`✅ Bot: @${result.bot?.username ?? '?'} (${result.bot?.firstName ?? ''})`);
  console.log(`   webhook → ${result.webhookUrl}\n`);
  for (const [step, info] of Object.entries(result.steps)) {
    const mark = info.ok ? '✅' : '⚠️ ';
    const extra = info.error ? ` — ${info.error}` : info.count != null ? ` (${info.count})` : '';
    console.log(`   ${mark} ${step}${extra}`);
  }
  if (result.warnings?.length) {
    console.log('\n⚠️  Warning:');
    for (const w of result.warnings) console.log(`   • ${w}`);
  }
  const wh = result.steps.getWebhookInfo;
  if (wh) {
    console.log(
      `\nPending updates: ${wh.pendingUpdateCount} · last error: ${wh.lastErrorMessage || '—'}`,
    );
  }
  console.log(
    '\n✔ messaging_settings aggiornato: isEnabled=true. Manda /help al bot per provarlo.',
  );
}

// --- entrypoint --------------------------------------------------------------
(async () => {
  const args = parseArgs(process.argv.slice(2));
  try {
    await sequelize.authenticate();
    if (args.check) await runCheck();
    else await runConfigure(args);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
})();
