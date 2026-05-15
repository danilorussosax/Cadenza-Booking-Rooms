'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const {
  User,
  Course,
  CourseLevel,
  BookingRule,
  Institute,
  Building,
  Room,
  Equipment,
  BookingTypeCatalog,
  ContractType,
} = require('../models');

async function seed() {
  console.log('--- Seed iniziale ---');

  // ==========================================
  // 0. Livelli di studio — solo al primo avvio (DB vuoto).
  // Se l'admin ne cancella alcuni, il seeder NON li ricrea ai riavvii.
  // ==========================================
  const levelCount = await CourseLevel.count();
  if (levelCount === 0) {
    const defaultLevels = [
      { code: 'propedeutico', name: 'Propedeutico', sortOrder: 10 },
      { code: 'triennio', name: 'Triennio', sortOrder: 20 },
      { code: 'biennio', name: 'Biennio', sortOrder: 30 },
      { code: 'master', name: 'Master', sortOrder: 40 },
      { code: 'altro', name: 'Altro', sortOrder: 99 },
    ];
    for (const lvl of defaultLevels) {
      await CourseLevel.create(lvl);
    }
    console.log(`  ✓ ${defaultLevels.length} livelli di studio creati (primo avvio)`);
  } else {
    console.log(`  → ${levelCount} livelli già presenti, seed saltato`);
  }

  // ==========================================
  // 1. Admin di default
  // ==========================================
  // Idempotenza: cerchiamo prima per email; se non trovato, fallback su
  // matricola='ADMIN-001' (matricola UNIQUE) — evita di creare un secondo
  // admin se l'email è stata cambiata a runtime ma la matricola è la stessa.
  const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@conservatorio.it').toLowerCase();
  let admin =
    (await User.findOne({ where: { email: adminEmail } })) ||
    (await User.findOne({ where: { matricola: 'ADMIN-001' } }));
  if (!admin) {
    await User.create({
      email: adminEmail,
      passwordHash: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!',
      firstName: process.env.DEFAULT_ADMIN_FIRSTNAME || 'Amministratore',
      lastName: process.env.DEFAULT_ADMIN_LASTNAME || 'Sistema',
      role: 'admin',
      status: 'approved',
      matricola: 'ADMIN-001',
    });
    console.log(`  ✓ Admin creato: ${adminEmail}`);
  } else {
    console.log(`  → Admin già presente: ${admin.email} (matricola ${admin.matricola})`);
  }

  // ==========================================
  // 2. Regole di prenotazione di default
  // ==========================================
  const defaultRules = [
    {
      role: 'admin',
      maxActiveBookings: 999,
      maxHoursPerWeek: 168,
      maxHoursPerDay: 24,
      maxBookingDurationMinutes: 1440,
      minBookingDurationMinutes: 15,
      maxAdvanceDays: 365,
      minAdvanceHours: 0,
      cancellationDeadlineHours: 0,
      allowRecurring: true,
      allowNightHours: true,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    },
    {
      role: 'docente',
      maxActiveBookings: 20,
      maxHoursPerWeek: 30,
      maxHoursPerDay: 8,
      maxBookingDurationMinutes: 240,
      minBookingDurationMinutes: 30,
      maxAdvanceDays: 60,
      minAdvanceHours: 1,
      cancellationDeadlineHours: 2,
      allowRecurring: true,
      allowNightHours: false,
      allowedStartTime: '07:00',
      allowedEndTime: '23:00',
    },
    {
      role: 'studente',
      maxActiveBookings: 5,
      maxHoursPerWeek: 12,
      maxHoursPerDay: 4,
      maxBookingDurationMinutes: 120,
      minBookingDurationMinutes: 30,
      maxAdvanceDays: 14,
      minAdvanceHours: 2,
      cancellationDeadlineHours: 4,
      allowRecurring: false,
      allowNightHours: false,
      allowedStartTime: '08:00',
      allowedEndTime: '22:00',
    },
  ];

  for (const r of defaultRules) {
    const [, created] = await BookingRule.findOrCreate({
      where: { role: r.role },
      defaults: r,
    });
    if (created) console.log(`  ✓ Regole create per ${r.role}`);
  }

  // ==========================================
  // 3. Corsi ufficiali AFAM (DM 128 Tabella A)
  //    Seedati SOLO al primo avvio (Course.count === 0).
  //    Se l'admin elimina/modifica corsi, il seeder NON li ripristina ai riavvii.
  // ==========================================
  const afamCourses = [
    { code: 'AFAM001', name: 'Arpa', levels: ['triennio', 'biennio'] },
    { code: 'AFAM002', name: 'Chitarra', levels: ['triennio', 'biennio'] },
    { code: 'AFAM003', name: 'Mandolino', levels: ['triennio', 'biennio'] },
    { code: 'AFAM004', name: 'Contrabbasso', levels: ['triennio', 'biennio'] },
    { code: 'AFAM005', name: 'Viola', levels: ['triennio', 'biennio'] },
    { code: 'AFAM006', name: 'Violino', levels: ['triennio', 'biennio'] },
    { code: 'AFAM007', name: 'Violoncello', levels: ['triennio', 'biennio'] },
    { code: 'AFAM008', name: 'Basso tuba', levels: ['triennio', 'biennio'] },
    { code: 'AFAM009', name: 'Clarinetto', levels: ['triennio', 'biennio'] },
    { code: 'AFAM010', name: 'Corno', levels: ['triennio', 'biennio'] },
    { code: 'AFAM011', name: 'Fagotto', levels: ['triennio', 'biennio'] },
    { code: 'AFAM012', name: 'Flauto', levels: ['triennio', 'biennio'] },
    { code: 'AFAM013', name: 'Oboe', levels: ['triennio', 'biennio'] },
    { code: 'AFAM014', name: 'Saxofono', levels: ['triennio', 'biennio'] },
    { code: 'AFAM015', name: 'Tromba', levels: ['triennio', 'biennio'] },
    { code: 'AFAM016', name: 'Trombone', levels: ['triennio', 'biennio'] },
    { code: 'AFAM017', name: 'Organo', levels: ['triennio', 'biennio'] },
    { code: 'AFAM018', name: 'Pianoforte', levels: ['triennio', 'biennio'] },
    { code: 'AFAM019', name: 'Strumenti a percussione', levels: ['triennio', 'biennio'] },
    { code: 'AFAM020', name: 'Canto', levels: ['triennio', 'biennio'] },
    { code: 'AFAM021', name: 'Accompagnamento pianistico', levels: ['triennio', 'biennio'] },
    { code: 'AFAM022', name: 'Strumenti ad ancia libera', levels: ['triennio', 'biennio'] },
    { code: 'AFAM023', name: 'Strumenti a pizzico storici', levels: ['triennio', 'biennio'] },
    { code: 'AFAM024', name: 'Strumenti ad arco storici', levels: ['triennio', 'biennio'] },
    { code: 'AFAM025', name: 'Strumenti a fiato storici', levels: ['triennio', 'biennio'] },
    { code: 'AFAM026', name: 'Strumenti a tastiera storici', levels: ['triennio', 'biennio'] },
    { code: 'AFAM027', name: 'Prepolifonia e canto storico', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM028',
      name: 'Strumenti a corde per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM029',
      name: 'Strumenti a fiato per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM030',
      name: 'Strumenti a tastiera per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM031',
      name: 'Strumenti a percussione per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM032',
      name: 'Canto per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM033', name: 'Musiche tradizionali', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM034',
      name: 'Musica da camera strumentale e vocale',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM035',
      name: "Musica d'insieme per strumenti a fiato",
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM036',
      name: "Musica d'insieme per strumenti ad arco",
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM037',
      name: "Pratiche d'insieme ed estemporanee per i nuovi linguaggi musicali",
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM038',
      name: "Musica d'insieme per voci e strumenti storici",
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM039', name: 'Musica liturgica', levels: ['triennio', 'biennio'] },
    { code: 'AFAM040', name: 'Musicologia e storia della musica', levels: ['triennio', 'biennio'] },
    { code: 'AFAM041', name: 'Composizione', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM042',
      name: 'Composizione, arrangiamento e concertazione per i nuovi linguaggi musicali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM043',
      name: 'Composizione, strumentazione e direzione per orchestra di fiati',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM044',
      name: 'Esecuzione della musica elettroacustica e applicazioni del suono per le arti interattive',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM045',
      name: 'Composizione musicale elettroacustica e multimediale',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM046', name: 'Scienze del suono per la musica', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM047',
      name: 'Tecnologie del suono e della multimedialità',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM048', name: 'Coro', levels: ['triennio', 'biennio'] },
    { code: 'AFAM049', name: 'Orchestra', levels: ['triennio', 'biennio'] },
    { code: 'AFAM050', name: 'Lettura della partitura', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM051',
      name: 'Pratica pianistica e della lettura vocale e pianistica',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM052',
      name: 'Teoria, ritmica e percezione musicale',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM053',
      name: 'Pedagogia musicale e psicologia della musica',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM054',
      name: 'Movimento espressivo e consapevolezza corporea per le arti performative',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM055',
      name: "Teoria e tecnica dell'interpretazione scenica",
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM056', name: 'Lingua e letteratura italiana', levels: ['triennio', 'biennio'] },
    { code: 'AFAM057', name: 'Lingua straniera', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM058',
      name: 'Diritto delle arti, del design, dello spettacolo e dei beni culturali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM059',
      name: 'Economia, management marketing delle imprese culturali creative e dello spettacolo',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM060', name: 'Musicoterapia', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM061',
      name: 'Tecnica e repertorio della danza classica',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM062',
      name: 'Tecnica e repertorio della danza moderna e contemporanea',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM063',
      name: 'Fisiodanza, anatomia e danza educativa',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM064',
      name: 'Composizione della danza, progettazione e realizzazione coreografica',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM065', name: 'Coreologia', levels: ['triennio', 'biennio'] },
    { code: 'AFAM066', name: 'Relazione Musica-Danza', levels: ['triennio', 'biennio'] },
    { code: 'AFAM067', name: 'Recitazione', levels: ['triennio', 'biennio'] },
    { code: 'AFAM068', name: 'Movimento', levels: ['triennio', 'biennio'] },
    { code: 'AFAM069', name: 'Voce', levels: ['triennio', 'biennio'] },
    { code: 'AFAM070', name: 'Regia', levels: ['triennio', 'biennio'] },
    { code: 'AFAM071', name: 'Scrittura', levels: ['triennio', 'biennio'] },
    { code: 'AFAM072', name: 'Scenografia', levels: ['triennio', 'biennio'] },
    { code: 'AFAM073', name: 'Costume', levels: ['triennio', 'biennio'] },
    { code: 'AFAM074', name: 'Lighting design', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM075',
      name: 'Anatomia artistica e rappresentazioni del corpo',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM076', name: "Grafica d'arte", levels: ['triennio', 'biennio'] },
    { code: 'AFAM077', name: 'Disegno e illustrazione', levels: ['triennio', 'biennio'] },
    { code: 'AFAM078', name: 'Metodologia della progettazione', levels: ['triennio', 'biennio'] },
    { code: 'AFAM079', name: 'Pittura', levels: ['triennio', 'biennio'] },
    { code: 'AFAM080', name: 'Tecniche per la pittura', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM081',
      name: 'Metodi e tecniche di produzione grafica per le arti visive e per il design',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM082',
      name: 'Tecniche artistiche della scultura',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM083',
      name: 'Metodi e strumenti per la rappresentazione del progetto',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM084',
      name: 'Linguaggi e pratiche artistiche della decorazione',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM085',
      name: 'Tecniche artistiche per la decorazione',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM086', name: 'Design della comunicazione', levels: ['triennio', 'biennio'] },
    { code: 'AFAM087', name: 'Design del prodotto', levels: ['triennio', 'biennio'] },
    { code: 'AFAM088', name: 'Design degli ambienti', levels: ['triennio', 'biennio'] },
    { code: 'AFAM089', name: 'Systemic design', levels: ['triennio', 'biennio'] },
    { code: 'AFAM090', name: 'Ergonomia', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM091',
      name: 'Ingegnerizzazione, matematica e fisica per il design',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM092',
      name: 'Processi di produzione e tecnologie dei materiali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM093',
      name: 'Tecniche e tecnologie del prodotto moda',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM094',
      name: 'Applicazioni digitali per le arti e il design',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM095', name: 'Teorie e tecniche computazionali', levels: ['triennio', 'biennio'] },
    { code: 'AFAM096', name: 'Arte del videogioco', levels: ['triennio', 'biennio'] },
    { code: 'AFAM097', name: 'Sistemi interattivi', levels: ['triennio', 'biennio'] },
    { code: 'AFAM098', name: 'Sound design', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM099',
      name: "Linguaggi e tecniche dell'audiovisivo",
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM100', name: 'Modellistica per il design', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM101',
      name: 'Scienze e tecniche della comunicazione',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM102', name: 'Storia delle arti visive', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM103',
      name: 'Storia delle arti applicate e del design',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM104',
      name: 'Fenomenologia delle arti contemporanee e teoria delle arti multimediali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM105',
      name: "Lineamenti e storia dell'architettura",
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM106', name: 'Estetica', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM107',
      name: "Pedagogia e didattica dell'arte e del design",
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM108', name: 'Tecnologie digitali per le arti', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM109',
      name: 'Antropologia e sociologia delle arti, del design e dello spettacolo',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM110', name: 'Progettazione grafica', levels: ['triennio', 'biennio'] },
    { code: 'AFAM111', name: 'Scultura', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM112',
      name: 'Linguaggi plastici per le arti visive',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM113', name: 'Fotografia', levels: ['triennio', 'biennio'] },
    { code: 'AFAM114', name: 'Design della moda', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM115',
      name: 'Storia delle arti performative, cinematografiche e mediali',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM116',
      name: 'Teorie e pratiche della conservazione, valorizzazione e comunicazione del patrimonio materiale e immateriale',
      levels: ['triennio', 'biennio'],
    },
    { code: 'AFAM117', name: 'Arteterapia', levels: ['triennio', 'biennio'] },
    { code: 'AFAM118', name: 'Arte del fumetto', levels: ['triennio', 'biennio'] },
    {
      code: 'AFAM119',
      name: 'Teoria, storia e metodo dei mass media',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM120',
      name: 'Scienze e diagnostica per il restauro',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM121',
      name: 'Teoria della percezione e psicologia della forma',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM122',
      name: "Restauro e tecniche dei materiali lapidei e derivati; superfici decorate dell'architettura",
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM123',
      name: 'Restauro dei manufatti dipinti su supporto ligneo e tessile. Manufatti scolpiti in legno e/o polimaterici, naturali o policromi, arredi e strutture lignee. Manufatti in materiali sintetici lavorati, assemblati e/o dipinti.',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM124',
      name: 'Restauro e tecniche dei materiali e manufatti tessili, organici e pelle',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM125',
      name: 'Restauro e tecniche dei materiali e manufatti ceramici, vitrei e organici — Materiali e manufatti in metallo e leghe',
      levels: ['triennio', 'biennio'],
    },
    {
      code: 'AFAM126',
      name: 'Restauro e tecniche del materiale librario e archivistico, manufatti cartacei e pergamenacei, materiale fotografico, cinematografico e digitale',
      levels: ['triennio', 'biennio'],
    },
  ];

  // Idempotente: findOrCreate per `code` con `paranoid:false` per non
  // creare duplicati su righe soft-deleted (lo unique constraint scatterebbe
  // comunque). I corsi eliminati esplicitamente dall'admin restano
  // soft-deleted: NON vengono ripristinati automaticamente al riavvio,
  // altrimenti l'admin non sarebbe mai libero di rimuovere voci dal
  // catalogo AFAM. Per riportarne uno indietro l'admin lo ricrea dalla UI.
  let createdCount = 0;
  let skippedDeleted = 0;
  for (const c of afamCourses) {
    const [course, created] = await Course.findOrCreate({
      where: { code: c.code },
      defaults: c,
      paranoid: false,
    });
    if (created) {
      createdCount += 1;
    } else if (course.deletedAt) {
      // Corso AFAM esistente ma eliminato dall'admin → rispetta la scelta.
      skippedDeleted += 1;
    }
  }
  if (createdCount > 0) {
    console.log(`  ✓ ${createdCount} corsi AFAM creati`);
  }
  if (skippedDeleted > 0) {
    console.log(`  ⓘ ${skippedDeleted} corsi AFAM soft-deleted dall'admin: lasciati eliminati`);
  }
  if (createdCount === 0 && skippedDeleted === 0) {
    const total = await Course.count();
    console.log(`  → ${total} corsi già presenti, seed AFAM saltato`);
  }

  // ==========================================
  // 4. Istituto/Edificio/Aula di esempio (solo se vuoto)
  // ==========================================
  const instCount = await Institute.count();
  if (instCount === 0) {
    const institute = await Institute.create({
      name: 'Conservatorio di Musica',
      code: 'CONS-01',
      city: 'Bari',
      country: 'Italia',
      timezone: 'Europe/Rome',
      description: 'Istituto principale',
    });
    const building = await Building.create({
      instituteId: institute.id,
      name: 'Edificio Storico',
      code: 'EDIF-A',
      floors: ['Piano Terra', 'Primo Piano', 'Secondo Piano'],
    });

    const sampleRooms = [
      {
        name: 'Studio 1',
        code: 'S01',
        floor: 'Primo Piano',
        type: 'studio',
        capacity: 2,
      },
      {
        name: 'Studio 2',
        code: 'S02',
        floor: 'Primo Piano',
        type: 'studio',
        capacity: 2,
      },
      {
        name: 'Sala Prove Grande',
        code: 'SP01',
        floor: 'Piano Terra',
        type: 'sala_prove',
        capacity: 30,
      },
      {
        name: 'Aula Concerti',
        code: 'AC01',
        floor: 'Piano Terra',
        type: 'aula_concerti',
        capacity: 200,
      },
      {
        name: 'Aula Didattica 201',
        code: 'A201',
        floor: 'Secondo Piano',
        type: 'aula_didattica',
        capacity: 15,
      },
    ];

    for (const r of sampleRooms) {
      const room = await Room.create({ ...r, buildingId: building.id });
      // Aggiungi un pianoforte agli studi/sale prove
      if (r.type === 'studio' || r.type === 'sala_prove' || r.type === 'aula_concerti') {
        await Equipment.create({
          roomId: room.id,
          name: r.type === 'aula_concerti' ? 'Pianoforte Steinway D' : 'Pianoforte verticale',
          type: r.type === 'aula_concerti' ? 'pianoforte_a_coda' : 'pianoforte',
          brand: r.type === 'aula_concerti' ? 'Steinway & Sons' : 'Yamaha',
          quantity: 1,
        });
      }
    }
    console.log(`  ✓ Istituto, edificio e ${sampleRooms.length} aule di esempio create`);
  }

  // ==========================================
  // 6. Booking type catalog (gap #7 EasyRoom parity).
  // Idempotente: findOrCreate per ogni code. I 5 system rows mirror dei
  // valori ENUM `Booking.type`; admin può poi personalizzare label/color/...
  // via /admin/booking-types ma non eliminarli (isSystem=true).
  // ==========================================
  const BOOKING_TYPE_SEED = [
    {
      code: 'lezione',
      label: 'Lezione',
      color: '#10b981',
      icon: 'GraduationCap',
      sortOrder: 0,
      defaultDurationMinutes: 60,
      description: 'Lezione individuale o di classe con docente.',
    },
    {
      code: 'studio_individuale',
      label: 'Studio individuale',
      color: '#3b82f6',
      icon: 'BookOpen',
      sortOrder: 1,
      defaultDurationMinutes: 60,
      description: 'Studio autonomo dello studente in aula.',
    },
    {
      code: 'prova',
      label: 'Prova',
      color: '#f59e0b',
      icon: 'Mic',
      sortOrder: 2,
      defaultDurationMinutes: 90,
      description: 'Prova di gruppo, ensemble, orchestra o coro.',
    },
    {
      code: 'concerto',
      label: 'Concerto',
      color: '#a855f7',
      icon: 'Music',
      sortOrder: 3,
      defaultDurationMinutes: 120,
      description: 'Concerto, saggio o esibizione pubblica.',
    },
    {
      code: 'altro',
      label: 'Altro',
      color: '#64748b',
      icon: 'Calendar',
      sortOrder: 4,
      defaultDurationMinutes: null,
      description: 'Altro impegno non riconducibile alle categorie standard.',
    },
  ];
  let typesAdded = 0;
  for (const row of BOOKING_TYPE_SEED) {
    const [, created] = await BookingTypeCatalog.findOrCreate({
      where: { code: row.code },
      defaults: { ...row, isSystem: true, isActive: true },
    });
    if (created) typesAdded += 1;
  }
  if (typesAdded > 0) {
    console.log(`  ✓ Catalog tipi prenotazione: seed ${typesAdded} tipi system`);
  } else {
    console.log('  → Catalog tipi prenotazione già presente (skip)');
  }

  // ============================================================
  // Seed Tipologie contrattuali docenti — i 4 valori storici diventano
  // record `isSystem: true` non cancellabili. Idempotente: se già presenti
  // skip. Per ogni Institute esistente. Bind to first institute by id.
  // ============================================================
  const institutes = await Institute.findAll({ attributes: ['id'], order: [['id', 'ASC']] });
  const CONTRACT_TYPE_SEED = [
    {
      code: 'titolare',
      label: 'Titolare di cattedra',
      defaultHours: 324,
      bypassDayConstraintDefault: false,
      sortOrder: 1,
    },
    {
      code: 'contratto_orario',
      label: 'Contratto orario',
      defaultHours: null, // soglia individuale, no default
      bypassDayConstraintDefault: true,
      sortOrder: 2,
    },
    {
      code: 'supplente',
      label: 'Supplente',
      defaultHours: null,
      bypassDayConstraintDefault: false,
      sortOrder: 3,
    },
    {
      code: 'altro',
      label: 'Altro',
      defaultHours: null,
      bypassDayConstraintDefault: false,
      sortOrder: 4,
    },
  ];
  let contractTypesAdded = 0;
  for (const inst of institutes) {
    for (const row of CONTRACT_TYPE_SEED) {
      const [, created] = await ContractType.findOrCreate({
        where: { instituteId: inst.id, code: row.code },
        defaults: { ...row, instituteId: inst.id, isSystem: true, isActive: true },
      });
      if (created) contractTypesAdded += 1;
    }
  }
  if (contractTypesAdded > 0) {
    console.log(`  ✓ Tipologie contrattuali docenti: seed ${contractTypesAdded} tipi system`);
  } else {
    console.log('  → Tipologie contrattuali docenti già presenti (skip)');
  }

  console.log('--- Seed completato ---\n');
}

// Permette sia il require che l'esecuzione standalone
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = seed;
