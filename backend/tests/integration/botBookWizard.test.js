'use strict';

/**
 * Integration test: wizard `/book` del bot Telegram (5 step).
 *
 *   step 1: sede        → book_room.building (skip se 1 sola sede)
 *   step 2: aula        → book_room.room
 *   step 3: quando      → book_room.when
 *   step 4: tipo        → book_room.type (skip se 1 solo tipo)
 *   step 5: conferma    → book_room.confirm
 *
 * Mock: stub di telegram.send() per intercettare le reply senza rete.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createUser, createBuilding, createRoom, createInstitute } = require('../factories');
const {
  MessagingSettings,
  BotBinding,
  Booking,
  BookingRule,
  BookingTypeCatalog,
  Building,
} = require('../../models');
const { encrypt } = require('../../lib/crypto');
const rateLimit = require('../../services/messaging/rateLimit');

const app = buildApp({ serveFrontend: false });

const TG_SECRET = 'a'.repeat(64);
const TG_TOKEN = 'TEST_TOKEN_NOT_USED';

// Patch telegram.send → cattura le reply
let lastSent = null;
beforeAll(() => {
  const adapter = require('../../services/messaging/adapters/telegram');

  adapter.send = async (externalId, text, _config) => {
    lastSent = { externalId, text };
  };
});

async function configureTelegram() {
  await MessagingSettings.destroy({ where: { channel: 'telegram' } });
  return MessagingSettings.create({
    channel: 'telegram',
    isEnabled: true,
    settings: {},
    credentialsEncrypted: encrypt(JSON.stringify({ botToken: TG_TOKEN, webhookSecret: TG_SECRET })),
  });
}

async function bindUser(user, externalId) {
  return BotBinding.create({
    userId: user.id,
    channel: 'telegram',
    externalId,
    boundAt: new Date(),
  });
}

function tgPayload(chatId, text) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text,
    },
  };
}

async function sendMsg(chatId, text) {
  lastSent = null;
  await request(app)
    .post('/api/messaging/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', TG_SECRET)
    .send(tgPayload(chatId, text));
  // L'invio è async (200 immediato), aspetta il flush
  await new Promise((r) => setTimeout(r, 250));
  return lastSent;
}

async function ensureBookingTypes() {
  await BookingTypeCatalog.findOrCreate({
    where: { code: 'studio_individuale' },
    defaults: { label: 'Studio individuale', sortOrder: 0, isActive: true, isSystem: true },
  });
  await BookingTypeCatalog.findOrCreate({
    where: { code: 'lezione' },
    defaults: { label: 'Lezione', sortOrder: 1, isActive: true, isSystem: true },
  });
  await BookingTypeCatalog.findOrCreate({
    where: { code: 'concerto' },
    defaults: { label: 'Concerto', sortOrder: 2, isActive: true, isSystem: true },
  });
}

async function ensureRules() {
  // BookingRule permissivo per il ruolo studente
  await BookingRule.findOrCreate({
    where: { role: 'studente' },
    defaults: {
      role: 'studente',
      maxActiveBookings: 100,
      maxHoursPerWeek: 100,
      maxHoursPerDay: 24,
      maxBookingDurationMinutes: 600,
      minBookingDurationMinutes: 15,
      maxAdvanceDays: 365,
      minAdvanceMinutes: 0,
      cancellationDeadlineHours: 0,
      allowSameDay: true,
      openingTime: '00:00',
      closingTime: '23:59',
      requireApproval: false,
    },
  });
}

describe('Bot /book — wizard 5 step (sede → aula → quando → tipo → conferma)', () => {
  let user;
  const CHAT_ID = 999001;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    rateLimit.reset();
    await configureTelegram();
    await ensureRules();
    await ensureBookingTypes();
    user = await createUser({ email: 'studente.bot@test.invalid', role: 'studente' });
    await bindUser(user, String(CHAT_ID));
  });

  // ── Caso A: 1 sola sede + 1 solo tipo → wizard saltato a 3 step ──────────
  it('1 sola sede + 1 tipo attivo → wizard come prima (chiede aula → quando → conferma)', async () => {
    // Disattiva tutti i tipi tranne uno
    await BookingTypeCatalog.update({ isActive: false }, { where: {} });
    await BookingTypeCatalog.update({ isActive: true }, { where: { code: 'studio_individuale' } });
    const building = await createBuilding({ name: 'Sede Storica' });
    await createRoom({ name: 'Aula 12', code: 'A12', building });

    let r = await sendMsg(CHAT_ID, '/book');
    expect(r.text).toMatch(/quale aula/i);
    // Lo skip della sede non deve far apparire la parola "sede" nella prima domanda
    expect(r.text).not.toMatch(/quale sede/i);

    r = await sendMsg(CHAT_ID, 'Aula 12');
    expect(r.text).toMatch(/quando/i);

    r = await sendMsg(CHAT_ID, 'domani 14-15');
    // Skip del tipo (1 solo attivo) → si va direttamente alla conferma
    expect(r.text).toMatch(/confermi la prenotazione/i);
    expect(r.text).toMatch(/Studio individuale/i);

    r = await sendMsg(CHAT_ID, 'si');
    expect(r.text).toMatch(/✅ Prenotazione confermata/);

    const created = await Booking.findOne({ where: { userId: user.id } });
    expect(created).toBeTruthy();
    expect(created.type).toBe('studio_individuale');
  });

  // ── Caso B: 2 sedi + 3 tipi → wizard pieno a 5 step ─────────────────────
  it('2 sedi + 3 tipi → chiede sede, poi aula, poi quando, poi tipo, poi conferma', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Sede Centrale', institute: inst });
    const sede2 = await createBuilding({ name: 'Succursale Verdi', institute: inst });
    await createRoom({ name: 'Aula 12', code: 'A12-S1', building: sede1 });
    await createRoom({ name: 'Aula 12', code: 'A12-S2', building: sede2 }); // stesso nome!
    const aulaUnique = await createRoom({ name: 'Studio 5', code: 'S5', building: sede2 });

    // Step 1: sede
    let r = await sendMsg(CHAT_ID, '/book');
    expect(r.text).toMatch(/quale sede/i);
    expect(r.text).toContain('Sede Centrale');
    expect(r.text).toContain('Succursale Verdi');

    // Risposta con il numero (2 = "Succursale Verdi" se ordinate alfabeticamente:
    // "Sede Centrale" → 1, "Succursale Verdi" → 2)
    r = await sendMsg(CHAT_ID, '2');
    expect(r.text).toMatch(/quale aula/i);
    expect(r.text).toContain('Succursale Verdi');

    // Step 2: aula scoped sulla sede 2 — "Aula 12" qui esiste con code A12-S2
    r = await sendMsg(CHAT_ID, 'Studio 5');
    expect(r.text).toMatch(/quando/i);

    // Step 3: data + ora
    r = await sendMsg(CHAT_ID, 'domani 10-11');
    expect(r.text).toMatch(/tipo di attività/i);
    expect(r.text).toContain('Studio individuale');
    expect(r.text).toContain('Lezione');
    expect(r.text).toContain('Concerto');

    // Step 4: tipo (per code)
    r = await sendMsg(CHAT_ID, 'lezione');
    expect(r.text).toMatch(/confermi la prenotazione/i);
    expect(r.text).toContain('Succursale Verdi');
    expect(r.text).toContain('Studio 5');
    expect(r.text).toContain('Lezione');

    // Step 5: conferma
    r = await sendMsg(CHAT_ID, 'si');
    expect(r.text).toMatch(/✅ Prenotazione confermata/);

    const created = await Booking.findOne({ where: { userId: user.id } });
    expect(created).toBeTruthy();
    expect(created.roomId).toBe(aulaUnique.id);
    expect(created.type).toBe('lezione');
  });

  // ── Caso C: aula in sede1 con stesso codice di sede2 → no collisioni ────
  it('selezione aula scoped: aule omonime in sedi diverse non si confondono', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Storica', institute: inst });
    const sede2 = await createBuilding({ name: 'Verdi', institute: inst });
    const aulaSede1 = await createRoom({ name: 'Aula 5', code: 'A5-S1', building: sede1 });
    const aulaSede2 = await createRoom({ name: 'Aula 5', code: 'A5-S2', building: sede2 });

    let r = await sendMsg(CHAT_ID, '/book');
    expect(r.text).toMatch(/quale sede/i);

    r = await sendMsg(CHAT_ID, 'Verdi'); // nome parziale
    expect(r.text).toMatch(/quale aula/i);

    r = await sendMsg(CHAT_ID, 'Aula 5'); // sarebbe ambiguo senza scope!
    expect(r.text).toMatch(/quando/i);

    r = await sendMsg(CHAT_ID, 'domani 9-10');
    r = await sendMsg(CHAT_ID, '1'); // primo tipo (studio_individuale)
    r = await sendMsg(CHAT_ID, 'si');
    expect(r.text).toMatch(/✅ Prenotazione confermata/);

    const created = await Booking.findOne({ where: { userId: user.id } });
    expect(created.roomId).toBe(aulaSede2.id); // confermato lo scope
    expect(created.roomId).not.toBe(aulaSede1.id);
  });

  // ── Caso D: shortcut "/book A101 ven 14-15 lezione" ──────────────────────
  it('shortcut 4-token: aula + giorno + ora + tipo → solo conferma', async () => {
    const sede = await createBuilding({ name: 'Sede Storica' });
    await createRoom({ name: 'Studio A', code: 'A101', building: sede });

    let r = await sendMsg(CHAT_ID, '/book A101 domani 15-16 lezione');
    // Sede unica + tutti gli slot già passati → vai direttamente alla conferma
    expect(r.text).toMatch(/confermi la prenotazione/i);
    expect(r.text).toContain('Lezione');

    r = await sendMsg(CHAT_ID, 'si');
    expect(r.text).toMatch(/✅ Prenotazione confermata/);

    const created = await Booking.findOne({ where: { userId: user.id } });
    expect(created.type).toBe('lezione');
  });

  // ── Caso E: input invalido → ritorna allo stesso step ───────────────────
  it('sede non riconosciuta → richiede ancora la sede', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Sede Storica', institute: inst });
    const sede2 = await createBuilding({ name: 'Sede Verdi', institute: inst });
    await createRoom({ name: 'A1', building: sede1 });
    await createRoom({ name: 'A1', building: sede2 });

    let r = await sendMsg(CHAT_ID, '/book');
    expect(r.text).toMatch(/quale sede/i);

    r = await sendMsg(CHAT_ID, 'XYZ-non-esiste');
    expect(r.text).toMatch(/non riconosciuta/i);
    expect(r.text).toMatch(/quale sede|sede/i);

    // Recovery: input valido funziona
    r = await sendMsg(CHAT_ID, 'Storica');
    expect(r.text).toMatch(/quale aula/i);
  });

  // ── Caso F: tipo non riconosciuto → richiede ancora il tipo ─────────────
  it('tipo non riconosciuto → richiede ancora il tipo', async () => {
    const sede = await createBuilding({ name: 'Sede Storica' });
    await createRoom({ name: 'Studio Cinque', code: 'AX', building: sede });

    await sendMsg(CHAT_ID, '/book AX domani 10-11');
    // Ora siamo allo step type (sede unica → skip)
    let r = await sendMsg(CHAT_ID, 'NON_ESISTE');
    expect(r.text).toMatch(/non riconosciuto/i);

    r = await sendMsg(CHAT_ID, '2'); // 2 = lezione
    expect(r.text).toMatch(/confermi la prenotazione/i);
  });

  // ── Caso G: /annulla durante il wizard resetta lo stato ─────────────────
  it('/annulla durante il wizard resetta lo stato', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'Aula 1', building: sede });

    await sendMsg(CHAT_ID, '/book');
    await sendMsg(CHAT_ID, 'Aula 1');
    let r = await sendMsg(CHAT_ID, '/annulla');
    expect(r.text).toMatch(/annullata/i);

    // Dopo l'annulla, /help deve rispondere normalmente (no in-wizard)
    r = await sendMsg(CHAT_ID, '/help');
    expect(r.text).toMatch(/Cadenza — Bot/);
  });

  // ── Caso H: orfano (Building soft-deleted) NON appare ──────────────────
  it('aule di edifici soft-deleted non compaiono nella lista sedi', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sedeAttiva = await createBuilding({ name: 'Attiva', institute: inst });
    const sedeCancellata = await createBuilding({ name: 'Cancellata', institute: inst });
    await createRoom({ name: 'A', building: sedeAttiva });
    await createRoom({ name: 'B', building: sedeCancellata });
    // Soft-delete dell'edificio
    await Building.destroy({ where: { id: sedeCancellata.id } });

    const r = await sendMsg(CHAT_ID, '/book');
    // 1 sola sede attiva → SKIP del prompt sede, va direttamente all'aula
    expect(r.text).toMatch(/quale aula/i);
    expect(r.text).not.toContain('Cancellata');
  });
});

describe('Bot /aule e /agenda — vista d’insieme', () => {
  let user;
  const CHAT_ID = 999002;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    rateLimit.reset();
    await configureTelegram();
    await ensureRules();
    await ensureBookingTypes();
    user = await createUser({ email: 'agenda.bot@test.invalid', role: 'studente' });
    await bindUser(user, String(CHAT_ID));
  });

  // ── /aule ────────────────────────────────────────────────────────────────
  it('/aule mostra lista aule raggruppate per sede con nome + codice', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Sede Storica', institute: inst });
    const sede2 = await createBuilding({ name: 'Succursale', institute: inst });
    await createRoom({
      name: 'Aula 12',
      code: 'A12',
      type: 'studio',
      capacity: 4,
      building: sede1,
    });
    await createRoom({ name: 'Aula 14', code: 'A14', type: 'aula', capacity: 8, building: sede1 });
    await createRoom({
      name: 'Studio Yamaha',
      code: 'SY1',
      type: 'studio',
      capacity: 2,
      building: sede2,
    });

    const r = await sendMsg(CHAT_ID, '/aule');
    expect(r.text).toMatch(/aule prenotabili/i);
    expect(r.text).toContain('Sede Storica');
    expect(r.text).toContain('Succursale');
    expect(r.text).toContain('Aula 12');
    expect(r.text).toContain('A12');
    expect(r.text).toContain('Studio Yamaha');
    expect(r.text).toContain('SY1');
    // Tipo + capienza visibili
    expect(r.text).toMatch(/4 posti/);
    expect(r.text).toContain('studio');
    // Counter finale
    expect(r.text).toMatch(/3.*aule.*2.*sedi/i);
  });

  it('/rooms è alias di /aule', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/rooms');
    expect(r.text).toMatch(/aule prenotabili/i);
    expect(r.text).toContain('A1');
  });

  it('/aule senza aule configurate → messaggio informativo', async () => {
    // Nessuna aula creata
    const r = await sendMsg(CHAT_ID, '/aule');
    expect(r.text).toMatch(/nessuna aula/i);
  });

  it('/aule esclude aule con isBookable=false', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'Aperta', code: 'OPEN', building: sede });
    await createRoom({ name: 'Chiusa', code: 'CLOSED', building: sede, isBookable: false });
    const r = await sendMsg(CHAT_ID, '/aule');
    expect(r.text).toContain('OPEN');
    expect(r.text).not.toContain('CLOSED');
  });

  // ── /agenda ─────────────────────────────────────────────────────────────
  it('/agenda senza data mostra oggi e segna le aule libere come 🟢', async () => {
    const sede = await createBuilding({ name: 'Sede Unica' });
    await createRoom({ name: 'Aula 1', code: 'A1', building: sede });
    await createRoom({ name: 'Aula 2', code: 'A2', building: sede });

    const r = await sendMsg(CHAT_ID, '/agenda');
    expect(r.text).toMatch(/agenda/i);
    expect(r.text).toContain('Sede Unica');
    expect(r.text).toContain('🟢'); // libere
    expect(r.text).toContain('Aula 1');
    expect(r.text).toContain('Aula 2');
    expect(r.text).toMatch(/Libere:.*\*?2\/2\*?/);
  });

  it('/agenda mostra prenotazioni del giorno con range orario per aula occupata', async () => {
    const sede = await createBuilding({ name: 'Sede A' });
    const room = await createRoom({ name: 'Sala Prove', code: 'SP', building: sede });

    // Crea una prenotazione confermata per oggi 10:00-11:00
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const end = new Date(today);
    end.setHours(11, 0, 0, 0);
    await Booking.create({
      userId: user.id,
      roomId: room.id,
      startTime: today,
      endTime: end,
      type: 'lezione',
      status: 'confirmed',
      purpose: 'test',
    });

    const r = await sendMsg(CHAT_ID, '/agenda oggi');
    expect(r.text).toMatch(/agenda/i);
    expect(r.text).toContain('🟡'); // occupata
    expect(r.text).toContain('Sala Prove');
    expect(r.text).toContain('10:00');
    expect(r.text).toContain('11:00');
    expect(r.text).toContain('lezione');
  });

  it('/oggi è alias di /agenda', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/oggi');
    expect(r.text).toMatch(/agenda/i);
    expect(r.text).toContain('A1');
  });

  it('/domani è alias di /agenda con data domani', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/domani');
    expect(r.text).toMatch(/agenda/i);
    // Il testo del giorno deve essere quello di domani, non oggi
    const dayjs = require('dayjs');
    require('dayjs/locale/it');
    dayjs.locale('it');
    const tomorrow = dayjs().add(1, 'day');
    expect(r.text.toLowerCase()).toContain(tomorrow.format('dddd').toLowerCase());
  });

  it('/agenda con data futura mostra solo le prenotazioni di quel giorno', async () => {
    const sede = await createBuilding({ name: 'S' });
    const room = await createRoom({ name: 'Aula X', code: 'AX', building: sede });

    // Prenotazione domani 14-15
    const dayjs = require('dayjs');
    const tomorrow = dayjs().add(1, 'day').hour(14).minute(0).second(0).millisecond(0);
    await Booking.create({
      userId: user.id,
      roomId: room.id,
      startTime: tomorrow.toDate(),
      endTime: tomorrow.add(1, 'hour').toDate(),
      type: 'studio_individuale',
      status: 'confirmed',
      purpose: 'test',
    });

    // /agenda oggi → aula libera
    let r = await sendMsg(CHAT_ID, '/agenda oggi');
    expect(r.text).toMatch(/Aula X.*libera/i);

    // /agenda domani → aula con prenotazione 14-15
    r = await sendMsg(CHAT_ID, '/agenda domani');
    expect(r.text).toContain('14:00');
    expect(r.text).toContain('15:00');
  });

  it('/agenda con data invalida → messaggio di errore', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/agenda XYZ-non-data');
    expect(r.text).toMatch(/non valida/i);
  });

  it('/agenda esclude aule con isBookable=false', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'Aperta', code: 'OPEN', building: sede });
    await createRoom({ name: 'Chiusa', code: 'CLOSED', building: sede, isBookable: false });
    const r = await sendMsg(CHAT_ID, '/agenda');
    expect(r.text).toContain('OPEN');
    expect(r.text).not.toContain('CLOSED');
  });
});

describe('Bot /libere — ricerca aule libere mirata', () => {
  let user;
  const CHAT_ID = 999003;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    rateLimit.reset();
    await configureTelegram();
    await ensureRules();
    await ensureBookingTypes();
    user = await createUser({ email: 'libere.bot@test.invalid', role: 'studente' });
    await bindUser(user, String(CHAT_ID));
  });

  it('/libere ven 14-15 mostra solo le aule libere nella fascia, escludendo quelle prenotate', async () => {
    const sede = await createBuilding({ name: 'Sede Unica' });
    const libera = await createRoom({ name: 'Libera', code: 'LIB', building: sede });
    const occupata = await createRoom({ name: 'Occupata', code: 'OCC', building: sede });

    const dayjs = require('dayjs');
    require('dayjs/plugin/isoWeek');
    require('dayjs/locale/it');
    dayjs.locale('it');
    // Prossimo venerdì 14-15
    let venerdi = dayjs().startOf('day');
    while (venerdi.day() !== 5) venerdi = venerdi.add(1, 'day');
    const start = venerdi.hour(14).minute(0).second(0).millisecond(0);
    const end = venerdi.hour(15).minute(0).second(0).millisecond(0);
    await Booking.create({
      userId: user.id,
      roomId: occupata.id,
      startTime: start.toDate(),
      endTime: end.toDate(),
      type: 'lezione',
      status: 'confirmed',
      purpose: 'test',
    });
    void libera;

    const r = await sendMsg(CHAT_ID, '/libere ven 14-15');
    expect(r.text).toMatch(/aule libere/i);
    expect(r.text).toContain('LIB');
    expect(r.text).not.toContain('OCC');
    // Header con la fascia oraria
    expect(r.text).toContain('14:00');
    expect(r.text).toContain('15:00');
  });

  it('/libere @sede filtra le aule sulla sede indicata', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Storica', institute: inst });
    const sede2 = await createBuilding({ name: 'Verdi', institute: inst });
    await createRoom({ name: 'Solo Storica', code: 'STO1', building: sede1 });
    await createRoom({ name: 'Solo Verdi', code: 'VER1', building: sede2 });

    let r = await sendMsg(CHAT_ID, '/libere @Storica');
    expect(r.text).toContain('STO1');
    expect(r.text).not.toContain('VER1');
    expect(r.text).toContain('Storica');

    r = await sendMsg(CHAT_ID, '/libere @Verdi');
    expect(r.text).toContain('VER1');
    expect(r.text).not.toContain('STO1');
  });

  it('/libere senza argomenti = tutte le aule libere oggi', async () => {
    const sede = await createBuilding({ name: 'Sede A' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    await createRoom({ name: 'B', code: 'A2', building: sede });

    const r = await sendMsg(CHAT_ID, '/libere');
    expect(r.text).toMatch(/aule libere/i);
    expect(r.text).toContain('A1');
    expect(r.text).toContain('A2');
    // Header con etichetta giorno
    expect(r.text.toLowerCase()).toMatch(/tutto il giorno/);
  });

  it('/libere sede + giorno + ora — ordine token libero', async () => {
    const sede = await createBuilding({ name: 'Storica' });
    await createRoom({ name: 'Aula Z', code: 'Z1', building: sede });

    // Verifichiamo che il parser non si rompa con ordini diversi
    const r1 = await sendMsg(CHAT_ID, '/libere @Storica ven 14-15');
    const r2 = await sendMsg(CHAT_ID, '/libere ven @Storica 14-15');
    const r3 = await sendMsg(CHAT_ID, '/libere ven 14-15 @Storica');
    expect(r1.text).toContain('Z1');
    expect(r2.text).toContain('Z1');
    expect(r3.text).toContain('Z1');
  });

  it('/libere con sede inesistente → errore con lista sedi disponibili', async () => {
    const sede = await createBuilding({ name: 'Storica' });
    await createRoom({ name: 'A', code: 'A1', building: sede });

    const r = await sendMsg(CHAT_ID, '/libere @SedeFantasma');
    expect(r.text).toMatch(/non trovata/i);
    expect(r.text).toContain('Storica');
  });

  it('/libere con orario invalido → errore', async () => {
    const sede = await createBuilding({ name: 'S' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/libere ven 25-30');
    expect(r.text).toMatch(/non valido/i);
  });

  it('/libere con tutte le aule occupate nella fascia → messaggio dedicato', async () => {
    const sede = await createBuilding({ name: 'S' });
    const room = await createRoom({ name: 'Unica', code: 'U1', building: sede });

    const dayjs = require('dayjs');
    let venerdi = dayjs().startOf('day');
    while (venerdi.day() !== 5) venerdi = venerdi.add(1, 'day');
    await Booking.create({
      userId: user.id,
      roomId: room.id,
      startTime: venerdi.hour(14).toDate(),
      endTime: venerdi.hour(15).toDate(),
      type: 'lezione',
      status: 'confirmed',
      purpose: 'test',
    });

    const r = await sendMsg(CHAT_ID, '/libere ven 14-15');
    expect(r.text).toMatch(/nessuna aula libera/i);
    expect(r.text).toMatch(/agenda/i);
  });
});

describe('Bot /check — sintassi aula@sede per disambiguare', () => {
  let user;
  const CHAT_ID = 999004;

  beforeEach(async () => {
    await globalThis.resetDatabase();
    rateLimit.reset();
    await configureTelegram();
    await ensureRules();
    await ensureBookingTypes();
    user = await createUser({ email: 'check.bot@test.invalid', role: 'studente' });
    await bindUser(user, String(CHAT_ID));
  });

  it('/check <aula>@<sede> filtra l’aula sulla sede indicata', async () => {
    const inst = await createInstitute({ name: 'Conservatorio Test' });
    const sede1 = await createBuilding({ name: 'Storica', institute: inst });
    const sede2 = await createBuilding({ name: 'Verdi', institute: inst });
    // Stesso nome aula in due sedi diverse
    const aulaStorica = await createRoom({ name: 'Aula 5', code: 'A5-S', building: sede1 });
    const aulaVerdi = await createRoom({ name: 'Aula 5', code: 'A5-V', building: sede2 });

    // Prenoto solo la "Aula 5" della sede Verdi
    const dayjs = require('dayjs');
    let venerdi = dayjs().startOf('day');
    while (venerdi.day() !== 5) venerdi = venerdi.add(1, 'day');
    await Booking.create({
      userId: user.id,
      roomId: aulaVerdi.id,
      startTime: venerdi.hour(10).toDate(),
      endTime: venerdi.hour(11).toDate(),
      type: 'lezione',
      status: 'confirmed',
      purpose: 'test',
    });
    void aulaStorica;

    // Senza scope: ambiguità → match al primo (test informativo)
    // Con scope: deve risolversi correttamente
    const rStorica = await sendMsg(CHAT_ID, '/check Aula 5@Storica venerdì');
    expect(rStorica.text).toMatch(/completamente libera/i);

    const rVerdi = await sendMsg(CHAT_ID, '/check Aula 5@Verdi venerdì');
    expect(rVerdi.text).toMatch(/Occupata/);
    expect(rVerdi.text).toContain('10:00');
  });

  it('/check con sede inesistente → errore informativo', async () => {
    const sede = await createBuilding({ name: 'Storica' });
    await createRoom({ name: 'A', code: 'A1', building: sede });
    const r = await sendMsg(CHAT_ID, '/check A1@SedeFantasma venerdì');
    expect(r.text).toMatch(/non trovata/i);
    expect(r.text).toContain('Storica');
  });
});
