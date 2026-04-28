'use strict';

/**
 * Integrazione: Monte Ore — flusso end-to-end docente → coordinatore → genera prenotazioni.
 *
 * Pre-condizioni:
 *   - una BookingRule per il ruolo docente (lo userà generateBookingsForProposal
 *     attraverso validateBooking).
 *   - una Room bookable.
 *   - un docente approved+active e un admin.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Booking, MonteOreProposal } = require('../../models');
const { createAuthedUser, createAdmin, createRoom, createBookingRule } = require('../factories');

describe('Monte Ore — flusso completo', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('docente crea draft → aggiunge fasce → submit → admin approva → genera', async () => {
    // Setup
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    await createBookingRule({ role: 'admin' });
    const room = await createRoom();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // Step 1 — docente: GET /me crea automaticamente una proposta in draft
    const r1 = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    expect(r1.status).toBe(200);
    expect(r1.body.proposal.status).toBe('draft');
    expect(r1.body.proposal.userId).toBe(doc.id);
    const proposalId = r1.body.proposal.id;

    // Aggiorna validità su un range piccolo (5 settimane) per mantenere il
    // test veloce — il generator espanderà 5 occorrenze del lunedì.
    await request(app)
      .put('/api/monte-ore/me')
      .set('Authorization', docHeader)
      .send({ validFrom: '2030-09-02', validTo: '2030-10-06', notes: 'Pianoforte 3°' })
      .expect(200);

    // Step 2 — aggiunge una fascia: ogni LUNEDÌ 14:00–16:00 in Aula X
    const r2 = await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({
        roomId: room.id,
        dayOfWeek: 1, // lunedì
        startTime: '14:00',
        endTime: '16:00',
        bookingType: 'lezione',
        purpose: 'Pianoforte 3°',
      });
    expect(r2.status).toBe(201);
    const scheduleId = r2.body.schedule.id;

    // Step 3 — submit
    const r3 = await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({});
    expect(r3.status).toBe(200);
    expect(r3.body.proposal.status).toBe('submitted');

    // Step 4 — admin: lista proposte submitted include la nostra
    const r4 = await request(app)
      .get('/api/admin/monte-ore?status=submitted')
      .set('Authorization', adminHeader);
    expect(r4.status).toBe(200);
    expect(r4.body.proposals).toHaveLength(1);
    expect(r4.body.proposals[0].id).toBe(proposalId);

    // Step 5 — admin approva
    const r5 = await request(app)
      .post(`/api/admin/monte-ore/${proposalId}/approve`)
      .set('Authorization', adminHeader)
      .send({});
    expect(r5.status).toBe(200);
    expect(r5.body.proposal.status).toBe('approved');

    // Step 6 — genera prenotazioni
    const r6 = await request(app)
      .post(`/api/admin/monte-ore/${proposalId}/generate`)
      .set('Authorization', adminHeader)
      .send({});
    expect(r6.status).toBe(201);
    // 5 lunedì nel range 2 set 2030 → 6 ott 2030 (2/9, 9/9, 16/9, 23/9, 30/9)
    expect(r6.body.result.created).toBeGreaterThanOrEqual(4);
    expect(r6.body.proposal.status).toBe('generated');

    // Verifica che i Booking siano stati creati
    const bookings = await Booking.findAll({ where: { userId: doc.id, status: 'confirmed' } });
    expect(bookings.length).toBe(r6.body.result.created);
    bookings.forEach((b) => {
      expect(b.roomId).toBe(room.id);
      expect(b.type).toBe('lezione');
      // Lunedì → JS Date.getDay() = 1
      expect(new Date(b.startTime).getDay()).toBe(1);
    });
  });

  it('admin: rifiuta con motivo, docente vede il rifiuto e può reinviare', async () => {
    await createBookingRule({ role: 'docente' });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // GET → POST schedule → submit
    const get = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    const id = get.body.proposal.id;
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '14:00', endTime: '16:00' })
      .expect(201);
    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);

    // Reject
    const rej = await request(app)
      .post(`/api/admin/monte-ore/${id}/reject`)
      .set('Authorization', adminHeader)
      .send({ reason: 'Conflitto con altro docente' });
    expect(rej.status).toBe(200);
    expect(rej.body.proposal.status).toBe('rejected');
    expect(rej.body.proposal.rejectionReason).toBe('Conflitto con altro docente');

    // Docente: vede il motivo
    const view = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    expect(view.body.proposal.rejectionReason).toBe('Conflitto con altro docente');

    // Aggiunge una riga → torna in draft → reinvia
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 2, startTime: '10:00', endTime: '12:00' })
      .expect(201);
    const view2 = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    expect(view2.body.proposal.status).toBe('draft');

    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
  });

  it('admin: unlock annulla i booking generati e riporta a approved', async () => {
    await createBookingRule({ role: 'docente', maxHoursPerWeek: 100, maxHoursPerDay: 10 });
    await createBookingRule({ role: 'admin' });
    const room = await createRoom();
    const { user: doc, authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    // Setup proposta + schedule + submit + approve + generate
    const get = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    const id = get.body.proposal.id;
    await request(app)
      .put('/api/monte-ore/me')
      .set('Authorization', docHeader)
      .send({ validFrom: '2030-09-02', validTo: '2030-09-30' })
      .expect(200);
    await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '14:00', endTime: '16:00' })
      .expect(201);
    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/admin/monte-ore/${id}/approve`)
      .set('Authorization', adminHeader)
      .send({})
      .expect(200);
    const gen = await request(app)
      .post(`/api/admin/monte-ore/${id}/generate`)
      .set('Authorization', adminHeader)
      .send({});
    const created = gen.body.result.created;
    expect(created).toBeGreaterThan(0);

    // Booking confirmed = `created`
    const before = await Booking.count({ where: { userId: doc.id, status: 'confirmed' } });
    expect(before).toBe(created);

    // Unlock
    const unl = await request(app)
      .post(`/api/admin/monte-ore/${id}/unlock`)
      .set('Authorization', adminHeader)
      .send({});
    expect(unl.status).toBe(200);
    expect(unl.body.proposal.status).toBe('approved');
    expect(unl.body.cleared.cleared).toBe(created);

    // Booking confirmed = 0 (tutti cancelled)
    const after = await Booking.count({ where: { userId: doc.id, status: 'confirmed' } });
    expect(after).toBe(0);
  });

  it('rifiuta accesso a /admin/monte-ore per non-admin (403)', async () => {
    const { authHeader } = await createAuthedUser({ role: 'docente' });
    const r = await request(app).get('/api/admin/monte-ore').set('Authorization', authHeader);
    expect(r.status).toBe(403);
  });

  it('proposal in stato approved/generated NON è modificabile dal docente', async () => {
    await createBookingRule({ role: 'docente' });
    const room = await createRoom();
    const { authHeader: docHeader } = await createAuthedUser({ role: 'docente' });
    const { authHeader: adminHeader } = await createAdmin();

    const get = await request(app).get('/api/monte-ore/me').set('Authorization', docHeader);
    const id = get.body.proposal.id;
    const created = await request(app)
      .post('/api/monte-ore/me/schedules')
      .set('Authorization', docHeader)
      .send({ roomId: room.id, dayOfWeek: 1, startTime: '14:00', endTime: '16:00' });
    const sid = created.body.schedule.id;
    await request(app)
      .post('/api/monte-ore/me/submit')
      .set('Authorization', docHeader)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/admin/monte-ore/${id}/approve`)
      .set('Authorization', adminHeader)
      .send({})
      .expect(200);

    // Approved: tentativo di edit dal docente → 400
    const tryEdit = await request(app)
      .patch(`/api/monte-ore/me/schedules/${sid}`)
      .set('Authorization', docHeader)
      .send({ startTime: '15:00' });
    expect(tryEdit.status).toBe(400);
  });
});
