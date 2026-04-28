'use strict';

/**
 * Integrazione: /api/bookings/templates (CRUD + quick-book).
 *
 * Pre-condizioni:
 *   - utente studente con courseId + matricola (requireCompleteProfile)
 *   - una BookingRule per il ruolo (requireApproved + bookingValidator)
 *   - una Room bookable
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { createAuthedUser, createCourse, createRoom, createBookingRule } = require('../factories');

const app = buildApp({ serveFrontend: false });

let matSeq = 0;
async function makeStudent() {
  const course = await createCourse();
  const auth = await createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: `TEST-MAT-${++matSeq}`,
  });
  // BookingRule è UNIQUE per ruolo: creala solo se manca
  const { BookingRule } = require('../../models');
  const existing = await BookingRule.findOne({ where: { role: 'studente' } });
  if (!existing) await createBookingRule({ role: 'studente' });
  return auth;
}

function basePayload(roomId, overrides = {}) {
  // dayOfWeek = domani (così la prossima occorrenza è sicura nel futuro vicino)
  const tomorrow = dayjs().add(1, 'day').day();
  return {
    name: 'Studio violino lun mattina',
    roomId,
    dayOfWeek: tomorrow,
    startMinutes: 9 * 60, // 09:00
    durationMinutes: 60,
    type: 'studio_individuale',
    purpose: 'Esercizi tecnici',
    isFavorite: false,
    ...overrides,
  };
}

describe('Booking templates', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  describe('POST /api/bookings/templates', () => {
    it('crea un template (201)', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      const res = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id));
      expect(res.status).toBe(201);
      expect(res.body.template.name).toBe('Studio violino lun mattina');
      expect(res.body.template.room.id).toBe(room.id);
    });

    it('409 TEMPLATE_NAME_DUPLICATE se nome già esistente per lo stesso utente', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id));
      const dup = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id));
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('TEMPLATE_NAME_DUPLICATE');
    });

    it('409 FAVORITE_LIMIT_REACHED al 4° favorito', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/bookings/templates')
          .set('Authorization', authHeader)
          .send(basePayload(room.id, { name: `Fav ${i}`, isFavorite: true }));
        expect(res.status).toBe(201);
      }
      const fourth = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id, { name: 'Fav 4', isFavorite: true }));
      expect(fourth.status).toBe(409);
      expect(fourth.body.code).toBe('FAVORITE_LIMIT_REACHED');
    });
  });

  describe('GET /api/bookings/templates', () => {
    it("lista solo i template dell'utente (favoriti prima)", async () => {
      const a = await makeStudent();
      const b = await makeStudent();
      const room = await createRoom();
      await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', a.authHeader)
        .send(basePayload(room.id, { name: 'A1', isFavorite: false }));
      await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', a.authHeader)
        .send(basePayload(room.id, { name: 'A2', isFavorite: true }));
      await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', b.authHeader)
        .send(basePayload(room.id, { name: 'B1' }));
      const res = await request(app)
        .get('/api/bookings/templates')
        .set('Authorization', a.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.templates).toHaveLength(2);
      expect(res.body.templates[0].name).toBe('A2'); // favorito → primo
      expect(res.body.templates[1].name).toBe('A1');
    });
  });

  describe('PUT /api/bookings/templates/:id', () => {
    it('403 se il template non è proprio', async () => {
      const a = await makeStudent();
      const b = await makeStudent();
      const room = await createRoom();
      const created = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', a.authHeader)
        .send(basePayload(room.id));
      const tplId = created.body.template.id;
      const res = await request(app)
        .put(`/api/bookings/templates/${tplId}`)
        .set('Authorization', b.authHeader)
        .send(basePayload(room.id, { name: 'Hijack' }));
      expect(res.status).toBe(403);
    });

    it('aggiorna i campi e segna come favorito', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      const created = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id));
      const tplId = created.body.template.id;
      const res = await request(app)
        .put(`/api/bookings/templates/${tplId}`)
        .set('Authorization', authHeader)
        .send(basePayload(room.id, { name: 'Aggiornato', durationMinutes: 90, isFavorite: true }));
      expect(res.status).toBe(200);
      expect(res.body.template.name).toBe('Aggiornato');
      expect(res.body.template.durationMinutes).toBe(90);
      expect(res.body.template.isFavorite).toBe(true);
    });
  });

  describe('DELETE /api/bookings/templates/:id', () => {
    it('cancella il template (200) e poi 404', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      const created = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(basePayload(room.id));
      const tplId = created.body.template.id;
      const del = await request(app)
        .delete(`/api/bookings/templates/${tplId}`)
        .set('Authorization', authHeader);
      expect(del.status).toBe(200);
      const again = await request(app)
        .delete(`/api/bookings/templates/${tplId}`)
        .set('Authorization', authHeader);
      expect(again.status).toBe(404);
    });
  });

  describe('POST /api/bookings/templates/:id/quick-book', () => {
    it('crea la booking sulla prossima occorrenza del dayOfWeek', async () => {
      const { authHeader } = await makeStudent();
      const room = await createRoom();
      const tomorrow = dayjs().add(1, 'day');
      const created = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', authHeader)
        .send(
          basePayload(room.id, {
            dayOfWeek: tomorrow.day(),
            startMinutes: 10 * 60, // 10:00 locale
            durationMinutes: 60,
          }),
        );
      const tplId = created.body.template.id;

      const res = await request(app)
        .post(`/api/bookings/templates/${tplId}/quick-book`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(201);
      const start = dayjs(res.body.booking.startTime);
      expect(start.day()).toBe(tomorrow.day());
      expect(start.hour()).toBe(10);
      expect(start.minute()).toBe(0);
      expect(res.body.booking.room.id).toBe(room.id);
      expect(res.body.booking.status).toBe('confirmed');
      expect(res.body.booking.purpose).toBe('Esercizi tecnici');
    });

    it('400 BOOKING_INVALID se la rule del ruolo non lo permette (durata > max)', async () => {
      const course = await createCourse();
      const auth = await createAuthedUser({
        role: 'studente',
        courseId: course.id,
        matricola: 'X',
      });
      // Rule restrittiva: max 30 min
      await createBookingRule({ role: 'studente', maxBookingDurationMinutes: 30 });
      const room = await createRoom();
      const tomorrow = dayjs().add(1, 'day').day();
      const created = await request(app)
        .post('/api/bookings/templates')
        .set('Authorization', auth.authHeader)
        .send(
          basePayload(room.id, {
            dayOfWeek: tomorrow,
            durationMinutes: 120, // > rule max
          }),
        );
      const tplId = created.body.template.id;
      const res = await request(app)
        .post(`/api/bookings/templates/${tplId}/quick-book`)
        .set('Authorization', auth.authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BOOKING_INVALID');
    });
  });

  it('endpoint richiedono auth', async () => {
    const r1 = await request(app).get('/api/bookings/templates');
    const r2 = await request(app).post('/api/bookings/templates').send({});
    const r3 = await request(app).post('/api/bookings/templates/1/quick-book');
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(401);
  });
});
