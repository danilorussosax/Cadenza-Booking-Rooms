'use strict';

/**
 * Diagnostica: conta righe nelle tabelle principali. Read-only.
 * Uso: node scripts/diag-counts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const m = require('../models');
  const tables = [
    'User',
    'Institute',
    'Building',
    'Room',
    'Course',
    'Booking',
    'BookingRule',
    'Instrument',
    'MonteOreProposal',
    'MonteOreSchedule',
    'MonteOreSettings',
    'MonteOreSuspension',
    'MonteOreSlot',
    'MonteOreAmendment',
  ];
  console.log('--- Conteggi righe (DB attuale) ---');
  for (const name of tables) {
    if (!m[name]) {
      console.log(`  ${name.padEnd(28)}  (model non trovato)`);
      continue;
    }
    try {
      const c = await m[name].count();
      console.log(`  ${name.padEnd(28)}  ${c}`);
    } catch (e) {
      console.log(`  ${name.padEnd(28)}  ERR: ${e.message.slice(0, 80)}`);
    }
  }
  // Ultimi User/Booking creati per verificare freschezza
  try {
    const u = await m.User.findOne({ order: [['createdAt', 'DESC']] });
    console.log(`\nUltimo user createdAt: ${u?.createdAt ?? '—'} (${u?.email ?? '—'})`);
  } catch {
    // best-effort: tabelle potrebbero non esistere in DB vergine
  }
  try {
    const b = await m.Booking.findOne({ order: [['createdAt', 'DESC']] });
    console.log(`Ultimo booking createdAt: ${b?.createdAt ?? '—'}`);
  } catch {
    // best-effort (vedi sopra)
  }
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
