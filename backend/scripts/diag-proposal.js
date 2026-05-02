'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const PROPOSAL_ID = Number(process.argv[2]) || 2;

(async () => {
  const m = require('../models');
  const p = await m.MonteOreProposal.findByPk(PROPOSAL_ID, {
    include: [
      { model: m.User, as: 'user' },
      { model: m.MonteOreSchedule, as: 'schedules', include: [{ model: m.Room, as: 'room' }] },
      { model: m.MonteOreSlot, as: 'slots', paranoid: false },
      { model: m.MonteOreAmendment, as: 'amendments' },
    ],
  });
  if (!p) {
    console.log('Proposta', PROPOSAL_ID, 'non trovata');
    process.exit(1);
  }

  console.log(
    `\n═══ Proposta ${p.id} — ${p.user?.firstName} ${p.user?.lastName} (${p.user?.email}) ═══`,
  );
  console.log(`Status: ${p.status}  AA: ${p.academicYear}  Range: ${p.validFrom} → ${p.validTo}`);
  console.log(
    `workingDaysCount=${p.workingDaysCount}  totalHoursPlanned=${p.totalHoursPlanned}  amendmentCount=${p.amendmentCount}`,
  );
  console.log(`generatedAt=${p.generatedAt?.toISOString()}\n`);

  console.log('SCHEDULES (pattern):');
  for (const s of p.schedules || []) {
    console.log(
      `  #${s.id}  giorno=${s.dayOfWeek}  ${s.startTime}–${s.endTime}  aula=${s.room?.name}  generatedBookingIds=[${(s.generatedBookingIds || []).slice(0, 5).join(',')}${(s.generatedBookingIds || []).length > 5 ? '...' : ''}] (${(s.generatedBookingIds || []).length})`,
    );
  }

  console.log('\nSLOT counts:');
  const slots = p.slots || [];
  console.log(
    `  totali=${slots.length}  attivi=${slots.filter((s) => s.isActive).length}  lockati=${slots.filter((s) => s.isLocked).length}  con bookingId=${slots.filter((s) => s.bookingId).length}  originalActive=${slots.filter((s) => s.originalActive).length}`,
  );
  console.log(
    `  isActive distribution: true=${slots.filter((s) => s.isActive && !s.isLocked).length}, false=${slots.filter((s) => !s.isActive && !s.isLocked).length}, locked=${slots.filter((s) => s.isLocked).length}`,
  );

  console.log('\nAMENDMENTS:');
  if (!p.amendments?.length) console.log('  (nessuno)');
  for (const a of p.amendments || []) {
    console.log(
      `  #${a.id}  ${a.kind} status=${a.status}  slotId=${a.slotId}  payload=${JSON.stringify(a.payload).slice(0, 80)}  notes=${a.requestNotes || ''}`,
    );
  }

  // Bookings di questo userId nel range della proposta
  const bookings = await m.Booking.findAll({
    where: {
      userId: p.userId,
      startTime: { [require('sequelize').Op.between]: [p.validFrom, p.validTo + 'T23:59:59'] },
    },
    paranoid: false,
    order: [['startTime', 'ASC']],
  });
  console.log(`\nBOOKINGS in range (${bookings.length} totali):`);
  console.log(
    `  confirmed attivi (visibili): ${bookings.filter((b) => b.status === 'confirmed' && !b.deletedAt).length}`,
  );
  console.log(
    `  confirmed soft-deleted: ${bookings.filter((b) => b.status === 'confirmed' && b.deletedAt).length}`,
  );
  console.log(
    `  cancelled attivi: ${bookings.filter((b) => b.status === 'cancelled' && !b.deletedAt).length}`,
  );
  console.log(
    `  cancelled soft-deleted: ${bookings.filter((b) => b.status === 'cancelled' && b.deletedAt).length}`,
  );
  console.log(
    `  altri status: ${bookings.filter((b) => !['confirmed', 'cancelled'].includes(b.status)).length}`,
  );

  if (
    bookings.filter((b) => b.status === 'confirmed' && !b.deletedAt).length === 0 &&
    p.status === 'generated'
  ) {
    console.log(
      '\n  ⚠️ Proposta GENERATED ma 0 booking confirmed visibili — il docente non vedrà nulla!',
    );
  }

  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e.message, e.stack);
  process.exit(1);
});
