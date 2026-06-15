'use strict';

// =============================================================================
// scripts/reencrypt-settings — migrazione della chiave di cifratura.
//
// Ri-cifra TUTTI i blob prodotti da lib/crypto (AES-256-GCM) da una chiave
// "vecchia" a una "nuova". Serve per separare la chiave delle credenziali da
// JWT_SECRET (vedi lib/crypto.js: fallback storico `|| getJwtSecret()`).
//
// Colonne interessate:
//   - MailSettings.passwordEncrypted
//   - MessagingSettings.credentialsEncrypted
//   - IntegrationConfig.credentialsEncrypted
//   - OAuthSettings.googleClientSecretEncrypted / microsoftClientSecretEncrypted
//   - User.twoFaSecretEncrypted
//
// CHIAVI (env):
//   SETTINGS_ENCRYPTION_KEY  (obbligatoria) → chiave NUOVA
//   OLD_ENCRYPTION_SECRET    (opzionale)    → segreto VECCHIO; se assente usa
//                                             JWT_SECRET (il fallback storico)
//
// MODI (dalla cartella backend/):
//   Dry-run (nessuna scrittura, conta soltanto):
//     SETTINGS_ENCRYPTION_KEY=<new> node scripts/reencrypt-settings.js --check
//   Migrazione reale:
//     SETTINGS_ENCRYPTION_KEY=<new> node scripts/reencrypt-settings.js
//   Con vecchio segreto esplicito:
//     OLD_ENCRYPTION_SECRET=<old> SETTINGS_ENCRYPTION_KEY=<new> node scripts/reencrypt-settings.js
//
// IDEMPOTENTE: prova prima a decifrare con la chiave NUOVA → se riesce il blob
// è già migrato e viene saltato. Solo se la nuova fallisce e la VECCHIA riesce
// il blob viene ri-cifrato. Se falliscono entrambe → WARN e skip (mai azzerato).
// Quindi è ri-eseguibile senza rischio di distruggere dati.
//
// Backup del DB consigliato PRIMA di eseguire la migrazione reale.
// =============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const models = require('../models');
const { sequelize } = models;
const { encrypt, decrypt, deriveKey } = require('../lib/crypto');
const { getJwtSecret } = require('../lib/secrets');

// Colonne cifrate per modello (nome esportato da models/index.js).
const TARGETS = [
  { model: 'MailSettings', columns: ['passwordEncrypted'] },
  { model: 'MessagingSettings', columns: ['credentialsEncrypted'] },
  { model: 'IntegrationConfig', columns: ['credentialsEncrypted'] },
  {
    model: 'OAuthSettings',
    columns: ['googleClientSecretEncrypted', 'microsoftClientSecretEncrypted'],
  },
  { model: 'User', columns: ['twoFaSecretEncrypted'] },
];

/**
 * Logica core idempotente per un singolo blob. Funzione pura (testabile):
 *   - blob vuoto       → { status: 'empty' }
 *   - già con newKey   → { status: 'already' }
 *   - migrabile        → { status: 'reencrypted', value: <blob ri-cifrato> }
 *   - indecifrabile    → { status: 'undecryptable' }
 */
function reencryptBlob(blob, oldKey, newKey) {
  if (!blob) return { status: 'empty' };
  // Già cifrato con la chiave nuova? (idempotenza)
  if (decrypt(blob, newKey) !== null) return { status: 'already' };
  // Decifrabile con la chiave vecchia → ri-cifra con la nuova.
  const plain = decrypt(blob, oldKey);
  if (plain !== null) return { status: 'reencrypted', value: encrypt(plain, newKey) };
  return { status: 'undecryptable' };
}

async function run({ dryRun }) {
  const newSecret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!newSecret) {
    throw new Error('SETTINGS_ENCRYPTION_KEY (chiave NUOVA) non impostata.');
  }
  const oldSecret = process.env.OLD_ENCRYPTION_SECRET || getJwtSecret();
  if (oldSecret === newSecret) {
    throw new Error(
      'OLD e NEW segreto coincidono: niente da migrare. Imposta una nuova SETTINGS_ENCRYPTION_KEY ' +
        'diversa dal segreto precedente (di default JWT_SECRET).',
    );
  }
  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  console.log(`═══ Re-encrypt settings ${dryRun ? '(DRY-RUN)' : '(REALE)'} ═══\n`);

  const totals = { already: 0, reencrypted: 0, undecryptable: 0, empty: 0 };

  for (const { model, columns } of TARGETS) {
    const Model = models[model];
    if (!Model) {
      console.log(`⚠️  modello ${model} non trovato, skip.`);
      continue;
    }
    const where =
      columns.length === 1
        ? { [columns[0]]: { [Op.ne]: null } }
        : { [Op.or]: columns.map((c) => ({ [c]: { [Op.ne]: null } })) };
    const rows = await Model.findAll({ where, attributes: ['id', ...columns] });

    const stat = { already: 0, reencrypted: 0, undecryptable: 0, empty: 0 };
    for (const row of rows) {
      for (const col of columns) {
        const res = reencryptBlob(row[col], oldKey, newKey);
        stat[res.status] += 1;
        totals[res.status] += 1;
        if (res.status === 'undecryptable') {
          console.log(`   ⚠️  ${model}#${row.id}.${col}: indecifrabile con entrambe le chiavi`);
        }
        if (res.status === 'reencrypted' && !dryRun) {
          await Model.update({ [col]: res.value }, { where: { id: row.id } });
        }
      }
    }
    console.log(
      `   ${model.padEnd(18)} righe=${rows.length}  da-migrare=${stat.reencrypted}  ` +
        `già=${stat.already}  indecifrabili=${stat.undecryptable}`,
    );
  }

  console.log(
    `\nTotale: ri-cifrati=${totals.reencrypted}  già-migrati=${totals.already}  ` +
      `indecifrabili=${totals.undecryptable}`,
  );
  if (dryRun) {
    console.log('\n(DRY-RUN: nessuna scrittura. Rilancia senza --check per applicare.)');
  } else {
    console.log('\n✔ Migrazione applicata. Riavvia il backend e fai smoke test.');
  }
  return totals;
}

module.exports = { reencryptBlob, TARGETS };

// Esegui solo se invocato direttamente (non quando importato dai test).
if (require.main === module) {
  const dryRun = process.argv.slice(2).includes('--check');
  (async () => {
    try {
      await sequelize.authenticate();
      const totals = await run({ dryRun });
      await sequelize.close();
      // In --check i blob indecifrabili sono un segnale di chiave errata → exit 2.
      // In run reale NON falliamo: i blob già ri-cifrati restano coerenti e quelli
      // indecifrabili erano illeggibili anche con la vecchia chiave (già warn-ati),
      // quindi far fallire il deploy dopo scritture parziali peggiorerebbe lo stato.
      process.exit(dryRun && totals.undecryptable > 0 ? 2 : 0);
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
      await sequelize.close().catch(() => {});
      process.exit(1);
    }
  })();
}
