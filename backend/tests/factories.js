'use strict';

/**
 * Factory pattern per creare entità di test.
 *
 * Convenzioni:
 *   - Ogni factory accetta un override parziale (`overrides`) e ritorna
 *     l'istanza Sequelize creata.
 *   - Default ragionevoli ma deterministici (no random) salvo gli `id`
 *     univoci (incrementati ad ogni chiamata).
 *   - Le factory creano dipendenze automaticamente dove serve (es.
 *     createBooking crea User+Room se non passati).
 */

const {
  User,
  Course,
  Institute,
  Building,
  Room,
  Booking,
  Instrument,
  BookingRule,
} = require('../models');
const { signToken } = require('../middleware/auth');

let seq = 0;
function next() {
  return ++seq;
}

async function createCourse(overrides = {}) {
  const n = next();
  return Course.create({
    code: overrides.code || `C${n}`,
    name: overrides.name || `Corso ${n}`,
    isActive: overrides.isActive ?? true,
    ...overrides,
  });
}

async function createInstitute(overrides = {}) {
  const n = next();
  return Institute.create({
    name: overrides.name || `Conservatorio ${n}`,
    code: overrides.code || `INST${n}`,
    city: overrides.city || 'Roma',
    country: overrides.country || 'Italia',
    ...overrides,
  });
}

async function createBuilding(overrides = {}) {
  const institute = overrides.institute || (await createInstitute());
  const n = next();
  return Building.create({
    name: overrides.name || `Edificio ${n}`,
    instituteId: institute.id,
    floors: overrides.floors || ['Piano terra', 'Primo piano'],
    ...overrides,
    instituteId: institute.id, // ri-applico per evitare override accidentali
  });
}

async function createRoom(overrides = {}) {
  const building = overrides.building || (await createBuilding());
  const n = next();
  return Room.create({
    name: overrides.name || `Aula ${n}`,
    buildingId: building.id,
    floor: overrides.floor || 'Piano terra',
    capacity: overrides.capacity ?? 10,
    type: overrides.type || 'studio',
    isBookable: overrides.isBookable ?? true,
    requireCheckIn: overrides.requireCheckIn ?? false,
    ...overrides,
    buildingId: building.id,
  });
}

async function createUser(overrides = {}) {
  const n = next();
  const password = overrides.password || 'Password123!';
  return User.create({
    firstName: overrides.firstName || `Test${n}`,
    lastName: overrides.lastName || `User${n}`,
    email: overrides.email || `user${n}@test.invalid`,
    passwordHash: password, // hashata dal hook beforeCreate
    role: overrides.role || 'studente',
    status: overrides.status || 'approved',
    isActive: overrides.isActive ?? true,
    matricola: overrides.matricola ?? `M${n}`,
    courseId: overrides.courseId,
    ...overrides,
    passwordHash: password, // riapplico
  });
}

/**
 * Crea utente + ritorna anche un JWT pronto per `Authorization: Bearer ...`
 */
async function createAuthedUser(overrides = {}) {
  const user = await createUser(overrides);
  const token = signToken(user);
  return { user, token, authHeader: `Bearer ${token}` };
}

async function createAdmin(overrides = {}) {
  return createAuthedUser({ role: 'admin', ...overrides });
}

async function createBooking(overrides = {}) {
  const user = overrides.user || (await createUser());
  const room = overrides.room || (await createRoom());
  const start = overrides.startTime || new Date(Date.now() + 60 * 60 * 1000);
  const end = overrides.endTime || new Date(start.getTime() + 60 * 60 * 1000);
  return Booking.create({
    userId: user.id,
    roomId: room.id,
    startTime: start,
    endTime: end,
    type: overrides.type || 'studio',
    purpose: overrides.purpose || null,
    status: overrides.status || 'confirmed',
    ...overrides,
    userId: user.id,
    roomId: room.id,
  });
}

async function createBookingRule(overrides = {}) {
  // Campi: vedi models/BookingRule.js. La regola è UNIQUE per `role`.
  return BookingRule.create({
    role: overrides.role || 'studente',
    maxActiveBookings: overrides.maxActiveBookings ?? 5,
    maxHoursPerWeek: overrides.maxHoursPerWeek ?? 10,
    maxHoursPerDay: overrides.maxHoursPerDay ?? 4,
    maxBookingDurationMinutes: overrides.maxBookingDurationMinutes ?? 240,
    minBookingDurationMinutes: overrides.minBookingDurationMinutes ?? 30,
    maxAdvanceDays: overrides.maxAdvanceDays ?? 30,
    minAdvanceHours: overrides.minAdvanceHours ?? 0,
    cancellationDeadlineHours: overrides.cancellationDeadlineHours ?? 0,
    allowRecurring: overrides.allowRecurring ?? true,
    allowNightHours: overrides.allowNightHours ?? true,
    allowedStartTime: overrides.allowedStartTime || '00:00',
    allowedEndTime: overrides.allowedEndTime || '23:59',
    ...overrides,
  });
}

async function createInstrument(overrides = {}) {
  const n = next();
  return Instrument.create({
    name: overrides.name || `Violino #${n}`,
    family: overrides.family || 'archi',
    serialNumber: overrides.serialNumber || `SN-${n}`,
    isAvailable: overrides.isAvailable ?? true,
    ...overrides,
  });
}

module.exports = {
  createCourse,
  createInstitute,
  createBuilding,
  createRoom,
  createUser,
  createAuthedUser,
  createAdmin,
  createBooking,
  createBookingRule,
  createInstrument,
};
