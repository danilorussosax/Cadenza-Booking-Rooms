'use strict';

/**
 * Seed deterministico per i test E2E.
 *
 * Crea:
 *   - 1 corso "Pianoforte"
 *   - 1 admin (admin@test.local / Password1!)
 *   - 1 studente approvato (studente@test.local / Password1!)
 *   - 1 docente in stato pending (pending@test.local / Password1!)
 *   - 1 istituto + 1 edificio + 2 aule prenotabili
 *   - regole booking permissive per studente e docente
 */

const path = require('node:path');
const BACKEND_DIR = path.resolve(__dirname, '..', '..', 'backend');

async function seedE2E() {
  const {
    User, Course, Institute, Building, Room, BookingRule, Instrument,
  } = require(path.join(BACKEND_DIR, 'models'));

  const course = await Course.create({ code: 'PIA', name: 'Pianoforte', isActive: true });

  await User.create({
    email: 'admin@test.local',
    passwordHash: 'Password1!',
    firstName: 'Admin',
    lastName: 'E2E',
    role: 'admin',
    status: 'approved',
    isActive: true,
  });

  await User.create({
    email: 'studente@test.local',
    passwordHash: 'Password1!',
    firstName: 'Stud',
    lastName: 'Ente',
    role: 'studente',
    status: 'approved',
    isActive: true,
    courseId: course.id,
    matricola: 'STU001',
  });

  await User.create({
    email: 'pending@test.local',
    passwordHash: 'Password1!',
    firstName: 'Doc',
    lastName: 'Pending',
    role: 'docente',
    status: 'pending',
    isActive: true,
  });

  const institute = await Institute.create({ name: 'Conservatorio E2E', city: 'Roma' });
  const building = await Building.create({
    instituteId: institute.id,
    name: 'Edificio A',
    floors: ['Piano terra', 'Primo piano'],
  });
  await Room.create({
    buildingId: building.id,
    name: 'Aula 101',
    floor: 'Piano terra',
    capacity: 5,
    type: 'studio',
    isBookable: true,
    requireCheckIn: false,
  });
  await Room.create({
    buildingId: building.id,
    name: 'Sala concerti',
    floor: 'Primo piano',
    capacity: 100,
    type: 'concerto',
    isBookable: true,
    requireCheckIn: false,
  });

  await Instrument.create({
    code: 'VL-001',
    name: 'Violino E2E',
    family: 'archi',
    brand: 'Stradivari',
    condition: 'ottimo',
    isLoanable: true,
  });

  // Regole permissive per non interferire con la logica di business sotto test.
  // `admin` incluso perché alcuni spec (waitlist-claim) usano il token admin
  // per "occupare" lo slot e poi cancellarlo, e il backend rifiuta la POST
  // /api/bookings senza una BookingRule per quel ruolo.
  for (const role of ['admin', 'studente', 'docente']) {
    await BookingRule.create({
      role,
      maxActiveBookings: 50,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 12,
      maxBookingDurationMinutes: 480,
      minBookingDurationMinutes: 15,
      maxAdvanceDays: 90,
      minAdvanceHours: 0,
      cancellationDeadlineHours: 0,
      allowRecurring: true,
      allowNightHours: true,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });
  }

  // eslint-disable-next-line no-console
  console.log('[e2e] seed completato');
}

module.exports = { seedE2E };
