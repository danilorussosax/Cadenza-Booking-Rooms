'use strict';

/**
 * Seed deterministico per i test E2E.
 *
 * Crea:
 *   - 1 corso "Pianoforte"
 *   - 1 admin (admin@test.local / Password1!)
 *   - 1 admin 2FA-enabled (admin2fa@test.local / Password1!) per 2fa-login.spec
 *   - 1 studente approvato (studente@test.local / Password1!)
 *   - 1 docente approvato (docente@test.local / Password1!) per checkin-qr e suggestions
 *   - 1 docente in stato pending (pending@test.local / Password1!)
 *   - 1 istituto + 1 edificio + 2 aule prenotabili (Aula 101 con qrToken fisso)
 *   - regole booking permissive per studente e docente
 *   - opt-in: una booking del docente domani 10-11 in Aula 101 per checkin-qr.spec
 */

const path = require('node:path');
const BACKEND_DIR = path.resolve(__dirname, '..', '..', 'backend');

// Versioni delle policy correnti: devono coincidere con
// frontend/src/pages/legal/policyVersions.ts altrimenti il ConsentGate
// scatta in E2E e blocca i flussi con un Dialog modale full-screen.
const PRIVACY_POLICY_VERSION = '2026-04-29';
const TERMS_VERSION = '2026-04-27';

async function seedE2E() {
  const {
    User, Course, Institute, Building, Room, BookingRule, Instrument, Booking, UserConsent,
    MonteOreSettings,
  } = require(path.join(BACKEND_DIR, 'models'));
  const { currentAcademicYear } = require(path.join(BACKEND_DIR, 'services', 'monteOreCalendarService'));

  async function grantConsents(user) {
    await UserConsent.create({
      userId: user.id,
      consentType: 'privacy_policy',
      granted: true,
      policyVersion: PRIVACY_POLICY_VERSION,
    });
    await UserConsent.create({
      userId: user.id,
      consentType: 'terms',
      granted: true,
      policyVersion: TERMS_VERSION,
    });
  }

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

  const studente = await User.create({
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

  const docente = await User.create({
    email: 'docente@test.local',
    passwordHash: 'Password1!',
    firstName: 'Doc',
    lastName: 'Approved',
    role: 'docente',
    status: 'approved',
    isActive: true,
    courseId: course.id,
    // ContractType "titolare" è seeded di sistema da preSyncMigrations.
    // Lo associamo al docente per attivare la threshold annual del monte-ore.
    contractType: 'titolare',
  });

  const pending = await User.create({
    email: 'pending@test.local',
    passwordHash: 'Password1!',
    firstName: 'Doc',
    lastName: 'Pending',
    role: 'docente',
    status: 'pending',
    isActive: true,
  });

  // ConsentGate scatta sui non-admin senza consensi correnti: pre-popoliamo
  // per evitare backdrop modale sui flussi /booking etc.
  await grantConsents(studente);
  await grantConsents(docente);
  await grantConsents(pending);

  // Admin con 2FA abilitata (twoFaEnabled) per il 2fa-login.spec.
  // L'enforcement è attivo: questo utente deve passare per il flusso OTP.
  await User.create({
    email: 'admin2fa@test.local',
    passwordHash: 'Password1!',
    firstName: 'Admin',
    lastName: '2FA',
    role: 'admin',
    status: 'approved',
    isActive: true,
    twoFaEnabled: true,
    twoFaActivatedAt: new Date(),
  });

  const institute = await Institute.create({
    name: 'Conservatorio E2E',
    city: 'Roma',
    // Esplicito anche se default=true: rende la dipendenza visibile per i
    // test E2E che esercitano /api/monte-ore (vedi monte-ore-approval.spec).
    moduleMonteOreEnabled: true,
  });

  // MonteOreSettings per l'AA corrente: finestra di submission ampia che
  // include la data del test E2E (mese variabile). Senza queste settings la
  // POST /me/submit fallirebbe con OUTSIDE_SUBMISSION_WINDOW.
  // minRequiredHours=1 per non costringere il docente a inserire 324h
  // settimanali nel test (il suo pattern è 11h/sett → ~330h/anno ok, ma
  // restiamo permissivi così il flow non è bloccato da matematica fragile).
  const year = currentAcademicYear();
  const [aaStartYear] = year.split('/').map(Number);
  await MonteOreSettings.create({
    instituteId: institute.id,
    academicYear: year,
    academicYearStart: `${aaStartYear}-11-01`,
    academicYearEnd: `${aaStartYear + 1}-10-31`,
    lessonsStartDate: `${aaStartYear}-11-01`,
    lessonsEndDate: `${aaStartYear + 1}-06-30`,
    submissionWindowStart: `${aaStartYear}-09-01`,
    submissionWindowEnd: `${aaStartYear + 1}-10-31`,
    minRequiredHours: 1,
    maxAmendmentsPerYear: 3,
    isActiveForTeachers: true,
  });
  const building = await Building.create({
    instituteId: institute.id,
    name: 'Edificio A',
    floors: ['Piano terra', 'Primo piano'],
  });
  const room101 = await Room.create({
    buildingId: building.id,
    name: 'Aula 101',
    floor: 'Piano terra',
    capacity: 5,
    type: 'studio',
    isBookable: true,
    requireCheckIn: true,
    // QR token fisso per il check-in dello spec checkin-qr.
    qrToken: 'e2e-room-101-qr-fixed-token-12345',
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

  // Booking attiva del docente per il checkin-qr.spec: slot che parte tra
  // 2 minuti per durare 1 ora. La finestra eleggibile è
  //   [startTime - CHECKIN_EARLY_MINUTES, startTime + GHOST_GRACE_MINUTES]
  // → [now-3min, now+17min]. `now` ricade tranquillamente dentro.
  const now = new Date();
  const start = new Date(now.getTime() + 2 * 60 * 1000);
  const end = new Date(now.getTime() + 62 * 60 * 1000);
  await Booking.create({
    userId: docente.id,
    roomId: room101.id,
    startTime: start,
    endTime: end,
    type: 'lezione',
    status: 'confirmed',
  });

  // eslint-disable-next-line no-console
  console.log('[e2e] seed completato');
}

module.exports = { seedE2E };
