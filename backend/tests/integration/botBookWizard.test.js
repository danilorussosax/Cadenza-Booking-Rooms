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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
