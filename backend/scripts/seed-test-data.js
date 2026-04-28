'use strict';

/**
 * Seed di dati di test:
 *   1. Cancella TUTTE le prenotazioni esistenti (hard delete + waitlist + concertInfo)
 *   2. Crea utenti docenti e studenti di test (ricreati idempotentemente)
 *   3. Genera prenotazioni random distribuite su tutti gli edifici e aule
 *      prenotabili per i prossimi 14 giorni (Lun→Sab, 08:00-20:00, slot 30')
 *
 * Bypassa il bookingValidator (quote, regole) per essere veloce su DB grossi:
 *   - usa Booking.bulkCreate con fallback per evitare overlap (EXCLUDE constraint)
 *   - crea bookings status='confirmed' (visibili in dashboard/display)
 *
 * Esecuzione (dalla cartella backend):
 *   node scripts/seed-test-data.js
 */

const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(isoWeek);

const {
  sequelize,
  User,
  Course,
  Building,
  Room,
  Booking,
  BookingWaitlist,
  ConcertInfo,
} = require('../models');

const TEST_DOCENTI = [
  { firstName: 'Mario', lastName: 'Rossi' },
  { firstName: 'Luca', lastName: 'Rossi' }, // omonimo per test disambiguazione
  { firstName: 'Marco', lastName: 'Rossi' }, // stessa iniziale di Mario
  { firstName: 'Anna', lastName: 'Bianchi' },
  { firstName: 'Giuseppe', lastName: 'Verdi' },
  { firstName: 'Elena', lastName: 'Russo' },
  { firstName: 'Paolo', lastName: 'Ferrari' },
  { firstName: 'Francesca', lastName: 'Esposito' },
  { firstName: 'Stefano', lastName: 'Romano' },
  { firstName: 'Chiara', lastName: 'Marino' },
];

const TEST_STUDENTI = [
  { firstName: 'Alessandro', lastName: 'Greco' },
  { firstName: 'Beatrice', lastName: 'Conti' },
  { firstName: 'Carlo', lastName: 'Galli' },
  { firstName: 'Diana', lastName: 'Bruno' },
  { firstName: 'Emanuele', lastName: 'De Luca' },
  { firstName: 'Federica', lastName: 'Costa' },
  { firstName: 'Giorgio', lastName: 'Fontana' },
  { firstName: 'Helena', lastName: 'Ricci' },
  { firstName: 'Ivan', lastName: 'Mancini' },
  { firstName: 'Julia', lastName: 'Vitali' },
  { firstName: 'Kevin', lastName: 'Lombardi' },
  { firstName: 'Lara', lastName: 'Moretti' },
  { firstName: 'Matteo', lastName: 'Barbieri' },
  { firstName: 'Noemi', lastName: 'Sanna' },
  { firstName: 'Omar', lastName: 'Caruso' },
  { firstName: 'Petra', lastName: 'Gentile' },
  { firstName: 'Roberto', lastName: 'Rinaldi' },
  { firstName: 'Sara', lastName: 'Serra' },
];

const BOOKING_TYPES_FOR_DOCENTE = ['lezione', 'lezione', 'lezione', 'prova', 'concerto'];
const BOOKING_TYPES_FOR_STUDENTE = ['studio_individuale', 'studio_individuale', 'prova'];
const PURPOSES = [
  'Studio individuale',
  'Lezione di pianoforte',
  'Prova esame',
  'Lezione di canto',
  'Recital di metà corso',
  'Saggio di classe',
  'Lezione di violino',
  'Prova di camera',
  'Studio di esame finale',
  'Lezione di teoria',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function deleteAllBookings() {
  console.log('\n🧹 Cancellazione prenotazioni esistenti...');
  const concertInfoCount = await ConcertInfo.count();
  await ConcertInfo.destroy({ where: {}, force: true });
  console.log(`  · ConcertInfo cancellate: ${concertInfoCount}`);
  const wlCount = await BookingWaitlist.count();
  await BookingWaitlist.destroy({ where: {}, force: true });
  console.log(`  · Waitlist cancellate: ${wlCount}`);
  const bookingCount = await Booking.count();
  // force:true bypassa paranoid → hard delete (DB pulito davvero)
  await Booking.destroy({ where: {}, force: true });
  console.log(`  · Booking cancellate: ${bookingCount}`);
}

async function ensureTestUsers() {
  console.log('\n👥 Creazione/aggiornamento utenti di test...');
  const courses = await Course.findAll({
    where: { isActive: true },
    attributes: ['id', 'code', 'name'],
  });
  if (courses.length === 0) {
    console.warn('  ⚠ Nessun corso attivo: gli utenti saranno creati senza courseId');
  }

  const passwordHash = await bcrypt.hash('Test1234!', 12);
  const created = [];

  // Docenti
  for (let i = 0; i < TEST_DOCENTI.length; i++) {
    const t = TEST_DOCENTI[i];
    const email = `docente${i + 1}@test.cadenza.it`;
    const matricola = `DOC-T${String(i + 1).padStart(3, '0')}`;
    const courseId = courses.length > 0 ? courses[i % courses.length].id : null;
    const [user] = await User.upsert(
      {
        email,
        firstName: t.firstName,
        lastName: t.lastName,
        role: 'docente',
        status: 'approved',
        isActive: true,
        matricola,
        courseId,
        password: passwordHash,
        tokenVersion: 0,
      },
      { returning: true },
    );
    created.push(user);
  }
  console.log(`  · Docenti: ${TEST_DOCENTI.length}`);

  // Studenti
  for (let i = 0; i < TEST_STUDENTI.length; i++) {
    const s = TEST_STUDENTI[i];
    const email = `studente${i + 1}@test.cadenza.it`;
    const matricola = `STU-T${String(i + 1).padStart(3, '0')}`;
    const courseId = courses.length > 0 ? courses[i % courses.length].id : null;
    const [user] = await User.upsert(
      {
        email,
        firstName: s.firstName,
        lastName: s.lastName,
        role: 'studente',
        status: 'approved',
        isActive: true,
        matricola,
        courseId,
        password: passwordHash,
        tokenVersion: 0,
      },
      { returning: true },
    );
    created.push(user);
  }
  console.log(`  · Studenti: ${TEST_STUDENTI.length}`);

  return {
    docenti: created.filter((u) => u.role === 'docente'),
    studenti: created.filter((u) => u.role === 'studente'),
  };
}

/**
 * Genera un singolo booking random in un range temporale dato.
 * Ritorna {start, end, type, purpose, userId} oppure null se non trova
 * uno slot libero dopo N tentativi (collisione con altre prenotazioni).
 *
 * Regola business:
 *   - **Lezione** (docente): durata minima 5h = 10 slot da 30 min, max 8h = 16 slot
 *   - Concerto: 60-120 min (1-4 slot)
 *   - Prova: 60-120 min
 *   - Studio individuale: 30-120 min (bias 1h)
 *
 * Ordine di scelta: prima il TIPO (in base a role + room.type), poi la
 * DURATA in base al tipo, poi lo slotIdx con vincolo che fine ≤ 20:00.
 */
async function tryRandomBookingForRoom(room, day, occupancyMap, users) {
  const isStudent = room.allowedRoles && !room.allowedRoles.includes('docente');
  const userPool = isStudent
    ? users.studenti
    : Math.random() < 0.5
      ? users.docenti
      : users.studenti;
  const user = pick(userPool);
  const role = user.role;

  // 1) Decide TIPO coerente con room.type e ruolo utente
  let type;
  if (room.type === 'aula_concerti') {
    type = Math.random() < 0.7 ? 'concerto' : role === 'docente' ? 'lezione' : 'prova';
  } else if (role === 'docente') {
    type = pick(BOOKING_TYPES_FOR_DOCENTE);
  } else {
    type = pick(BOOKING_TYPES_FOR_STUDENTE);
  }
  if (type === 'concerto' && role !== 'docente') type = 'prova';

  // 2) Decide DURATA in slot (1 slot = 30 min) in base al tipo.
  //    LEZIONE (docente): minimo 5h, max 8h → 10..16 slot.
  //    CONCERTO: minimo 3h, max 4h → 6..8 slot (incluso allestimento + show + coda).
  //    PROVA: 60-120 min.
  //    STUDIO INDIVIDUALE: 30-120 min con bias 1h.
  let durationSlots;
  if (type === 'lezione' && role === 'docente') {
    durationSlots = randInt(10, 16); // 5h-8h
  } else if (type === 'concerto') {
    durationSlots = randInt(6, 8); // 3h-4h
  } else if (type === 'prova') {
    durationSlots = pick([2, 2, 3, 4]); // 60-120
  } else {
    durationSlots = pick([1, 2, 2, 3, 4]); // 30-120 min, bias 1h
  }

  // 3) Decide slot di partenza con vincolo durationSlots ≤ 24-slotIdx
  //    (giornata di 24 slot in [08:00, 20:00)).
  const maxStart = 24 - durationSlots;
  if (maxStart < 0) return null;
  const slotIdx = randInt(0, maxStart);

  const start = day.startOf('day').add(8 * 60 + slotIdx * 30, 'minute');
  const end = start.add(durationSlots * 30, 'minute');

  // 4) Verifica overlap nel giorno per la stanza
  const occKey = `${room.id}:${day.format('YYYY-MM-DD')}`;
  const taken = occupancyMap.get(occKey) || [];
  for (const [a, b] of taken) {
    if (start.isBefore(b) && end.isAfter(a)) return null;
  }

  const purpose =
    type === 'concerto'
      ? `Concerto · ${user.firstName} ${user.lastName}`
      : type === 'lezione'
        ? `Lezione di ${pick(['pianoforte', 'violino', 'canto', 'composizione', 'teoria', 'armonia'])} · Prof. ${user.lastName}`
        : pick(PURPOSES);

  taken.push([start, end]);
  occupancyMap.set(occKey, taken);

  return {
    userId: user.id,
    roomId: room.id,
    startTime: start.toDate(),
    endTime: end.toDate(),
    type,
    purpose,
    status: 'confirmed',
    user,
  };
}

async function generateRandomBookings(users) {
  console.log('\n📅 Generazione prenotazioni random...');
  // Query diretta su Room: garantisce che TUTTE le aule prenotabili siano
  // candidate, indipendentemente dalla relazione building (evita quirk del
  // LEFT JOIN con where:isBookable che escludeva alcune righe).
  const allRooms = await Room.findAll({
    where: { isBookable: true },
    attributes: ['id', 'name', 'type', 'allowedRoles', 'buildingId'],
    order: [
      ['buildingId', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  const buildings = await Building.count();
  console.log(`  · ${buildings} edifici, ${allRooms.length} aule prenotabili`);

  if (allRooms.length === 0) {
    console.warn('  ⚠ Nessuna aula prenotabile: niente bookings da generare');
    return [];
  }

  const today = dayjs().startOf('day');
  // Orizzonte: 14 giorni Lun-Sab (saltiamo le domeniche)
  const days = [];
  for (let d = 0; d < 14; d++) {
    const day = today.add(d, 'day');
    if (day.isoWeekday() <= 6) days.push(day);
  }

  const occupancyMap = new Map(); // key roomId:date → [[start,end], ...]
  const bookings = [];

  for (const room of allRooms) {
    // 4-10 prenotazioni a stanza distribuite nei 14 gg
    const targetCount = randInt(4, 10);
    let attempts = 0;
    let made = 0;
    while (made < targetCount && attempts < targetCount * 5) {
      attempts++;
      const day = pick(days);
      const b = await tryRandomBookingForRoom(room, day, occupancyMap, users);
      if (b) {
        bookings.push(b);
        made++;
      }
    }
  }
  console.log(`  · Pianificate ${bookings.length} prenotazioni (in memoria, no overlap)`);

  // Bulk-insert con transazione
  const startedAt = Date.now();
  let inserted = 0;
  await sequelize.transaction(async (t) => {
    // Creiamo a chunk di 200 per evitare query troppo grandi
    const chunkSize = 200;
    for (let i = 0; i < bookings.length; i += chunkSize) {
      const chunk = bookings.slice(i, i + chunkSize).map(({ user, ...b }) => b);
      const created = await Booking.bulkCreate(chunk, {
        transaction: t,
        validate: false, // bypass validator quote/regole
        ignoreDuplicates: false,
      });
      inserted += created.length;
    }
  });

  // Concert info per ~30% dei concerti
  const concertBookings = bookings.filter((b) => b.type === 'concerto');
  let concertInfoCreated = 0;
  for (const cb of concertBookings) {
    if (Math.random() > 0.5) continue;
    const persisted = await Booking.findOne({
      where: { userId: cb.userId, startTime: cb.startTime, roomId: cb.roomId },
    });
    if (!persisted) continue;
    await ConcertInfo.create({
      bookingId: persisted.id,
      title: `Concerto · ${cb.purpose.replace(/^Concerto · /, '')}`,
      performers: `${cb.user.firstName} ${cb.user.lastName}`,
      program: pick([
        'Bach: Suite n.1 BWV 1007',
        'Mozart: Sonata K. 545',
        'Beethoven: Sonata Op. 27 n.2 "Al Chiaro di Luna"',
        'Chopin: Notturno Op. 9 n.2',
        'Debussy: Clair de Lune',
      ]),
    });
    concertInfoCreated++;
  }

  console.log(`  · Inserite ${inserted} prenotazioni in ${Date.now() - startedAt}ms`);
  console.log(`  · ConcertInfo create: ${concertInfoCreated}`);

  return bookings;
}

async function summary() {
  const stats = {
    bookingsTotal: await Booking.count(),
    docenti: await User.count({
      where: { role: 'docente', email: { [require('sequelize').Op.like]: '%@test.cadenza.it' } },
    }),
    studenti: await User.count({
      where: { role: 'studente', email: { [require('sequelize').Op.like]: '%@test.cadenza.it' } },
    }),
    rooms: await Room.count({ where: { isBookable: true } }),
    buildings: await Building.count(),
  };
  console.log('\n📊 Riepilogo finale:');
  console.log(`  · Edifici: ${stats.buildings}`);
  console.log(`  · Aule prenotabili: ${stats.rooms}`);
  console.log(`  · Docenti di test: ${stats.docenti}`);
  console.log(`  · Studenti di test: ${stats.studenti}`);
  console.log(`  · Prenotazioni nel DB: ${stats.bookingsTotal}`);
  console.log('\n💡 Login utenti di test:');
  console.log('   Email: docente1@test.cadenza.it … docente10@test.cadenza.it');
  console.log('   Email: studente1@test.cadenza.it … studente18@test.cadenza.it');
  console.log('   Password (tutti): Test1234!');
}

(async () => {
  try {
    console.log('🌱 Cadenza — Seed dati di test');
    await sequelize.authenticate();
    console.log('  · DB connection OK');

    await deleteAllBookings();
    const users = await ensureTestUsers();
    await generateRandomBookings(users);
    await summary();

    console.log('\n✅ Completato.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Errore:', err);
    process.exit(1);
  }
})();
