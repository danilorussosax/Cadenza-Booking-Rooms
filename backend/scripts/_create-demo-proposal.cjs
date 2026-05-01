'use strict';

/**
 * Demo: crea una proposta Monte Ore submitted col valore di soglia
 * personalizzato (override) per il docente target. Serve a far apparire
 * nella UI admin una proposta con minRequiredHoursSnapshot = 60.
 *
 * Idempotente: se esiste già una proposta dell'AA corrente per quel
 * docente, la riallinea senza duplicare.
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSettings,
  Room,
} = require(path.join(BACKEND, 'models'));

(async () => {
  await sequelize.authenticate();
  const docHint = process.argv[2] || 'danilorusso@outlook.com';
  const doc = await User.findOne({
    where: { role: 'docente', email: { [Op.iLike]: `%${docHint}%` } },
  });
  if (!doc) {
    console.error(`Nessun docente trovato per "${docHint}"`);
    process.exit(3);
  }
  if (doc.monteOreAnnualHoursOverride == null) {
    console.error('Il docente non ha override Monte Ore. Esegui prima _setup-demo-override.cjs.');
    process.exit(4);
  }

  const settings = await MonteOreSettings.findOne({ order: [['createdAt', 'DESC']] });
  if (!settings) {
    console.error('Nessun MonteOreSettings configurato.');
    process.exit(5);
  }
  const academicYear = settings.academicYear;

  const room = await Room.findOne({ where: { isBookable: true } });
  if (!room) {
    console.error('Nessuna Room bookable trovata.');
    process.exit(6);
  }

  const [proposal] = await MonteOreProposal.findOrCreate({
    where: { userId: doc.id, academicYear },
    defaults: {
      userId: doc.id,
      academicYear,
      validFrom: settings.lessonsStartDate,
      validTo: settings.lessonsEndDate,
      status: 'draft',
    },
  });

  // Allineamento: 1 fascia (lun 14-16) e snapshot soglia personalizzata.
  const existingSchedules = await MonteOreSchedule.count({ where: { proposalId: proposal.id } });
  if (existingSchedules === 0) {
    await MonteOreSchedule.create({
      proposalId: proposal.id,
      roomId: room.id,
      dayOfWeek: 1,
      startTime: '14:00',
      endTime: '16:00',
      bookingType: 'lezione',
    });
  }

  // Forziamo lo stato "submitted" con snapshot della soglia personalizzata.
  await proposal.update({
    status: 'submitted',
    submittedAt: new Date(),
    minRequiredHoursSnapshot: doc.monteOreAnnualHoursOverride, // = 60
    workingDaysCount: doc.monteOreBypassDayConstraint ? null : 1,
    totalHoursRequested: 60, // dummy, basta che >= snapshot per il display
  });

  process.stdout.write(
    JSON.stringify({
      proposalId: proposal.id,
      userId: doc.id,
      userEmail: doc.email,
      academicYear,
      snapshot: doc.monteOreAnnualHoursOverride,
    }),
  );
  await sequelize.close();
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
