'use strict';
/**
 * Read-only: legge le proposte Monte Ore in stato 'generated' e classifica
 * i motivi degli "skipped" del generationSummary. Aiuta a capire perché
 * alcune occorrenze del pattern non hanno generato un Booking.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const m = require('../models');
  const proposals = await m.MonteOreProposal.findAll({
    where: { status: 'generated' },
    include: [
      { model: m.User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { model: m.MonteOreSchedule, as: 'schedules', include: [{ model: m.Room, as: 'room' }] },
    ],
    order: [['generatedAt', 'DESC']],
  });

  if (!proposals.length) {
    console.log('Nessuna proposta in stato generated.');
    process.exit(0);
  }

  for (const p of proposals) {
    const sum = p.generationSummary || {};
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Proposta #${p.id} — ${p.user?.firstName} ${p.user?.lastName} (${p.user?.email})`);
    console.log(`AA: ${p.academicYear}  Range: ${p.validFrom} → ${p.validTo}`);
    console.log(`Generato: ${p.generatedAt?.toISOString()}`);
    console.log(`Riepilogo: ${sum.created} creati, ${sum.skipped} saltati, ${sum.errors} errori`);
    console.log();

    console.log('Schedules (pattern):');
    for (const s of p.schedules || []) {
      const room = s.room ? `${s.room.name}` : '(no room)';
      console.log(
        `  #${s.id}  giorno=${s.dayOfWeek}  ${s.startTime}–${s.endTime}  aula=${room}  type=${s.bookingType}`,
      );
    }
    console.log();

    const skipped = sum.details?.skipped || [];
    const errors = sum.details?.errors || [];

    if (skipped.length) {
      console.log(`Skipped: ${skipped.length}`);
      // Raggruppa per reason
      const byReason = new Map();
      for (const sk of skipped) {
        const k = sk.reason || '(no reason)';
        if (!byReason.has(k)) byReason.set(k, []);
        byReason.get(k).push(sk);
      }
      for (const [reason, items] of [...byReason.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        console.log(`  → ${items.length}× "${reason}"`);
        // Mostra max 5 esempi per gruppo
        for (const it of items.slice(0, 5)) {
          console.log(`     • ${it.date}  schedule=#${it.scheduleId}`);
        }
        if (items.length > 5) console.log(`     … e altri ${items.length - 5}`);
      }
    }
    if (errors.length) {
      console.log(`Errors: ${errors.length}`);
      for (const e of errors.slice(0, 10)) {
        console.log(`  • ${e.date}  schedule=#${e.scheduleId}  msg=${e.message}`);
      }
    }
    console.log();
  }

  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
