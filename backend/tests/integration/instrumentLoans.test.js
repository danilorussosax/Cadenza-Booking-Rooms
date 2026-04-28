'use strict';

/**
 * Integrazione: /api/loans (richiesta, approve/reject, return, cancel).
 *
 * NOTA: la copertura specifica delle quote vive in `loanQuotas.test.js`;
 * qui ci concentriamo sul ciclo di vita base del prestito + edge cases
 * di validazione che non dipendono dalle quote.
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { InstrumentLoan } = require('../../models');
const { createAdmin, createAuthedUser, createInstrument } = require('../factories');

const app = buildApp({ serveFrontend: false });

const FROM = dayjs().add(1, 'day').format('YYYY-MM-DD');
const TO = dayjs().add(7, 'day').format('YYYY-MM-DD');

describe('POST /api/loans — richiesta prestito', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('crea una richiesta con status="requested"', async () => {
    const { authHeader, user } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Violino', family: 'archi' });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({ instrumentId: inst.id, fromDate: FROM, toDate: TO, notes: 'Per saggio' });

    expect(res.status).toBe(201);
    expect(res.body.loan).toMatchObject({
      instrumentId: inst.id,
      userId: user.id,
      status: 'requested',
      notes: 'Per saggio',
    });
  });

  it('400 con LOAN_INVALID_DATE se fromDate è nel passato', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Flauto', family: 'fiati_legni' });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({
        instrumentId: inst.id,
        fromDate: dayjs().subtract(2, 'day').format('YYYY-MM-DD'),
        toDate: TO,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOAN_INVALID_DATE');
  });

  it('400 con LOAN_INVALID_DATE se toDate < fromDate', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Tromba', family: 'fiati_ottoni' });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({
        instrumentId: inst.id,
        fromDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        toDate: dayjs().add(3, 'day').format('YYYY-MM-DD'),
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOAN_INVALID_DATE');
  });

  it('409 con LOAN_CONFLICT se intervallo sovrapposto a un loan active esistente', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const otherUser = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Cello', family: 'archi' });

    // Loan pre-esistente di un altro utente che copre tutto il range richiesto.
    await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: otherUser.user.id,
      fromDate: dayjs().add(2, 'day').format('YYYY-MM-DD'),
      toDate: dayjs().add(5, 'day').format('YYYY-MM-DD'),
      status: 'active',
    });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({ instrumentId: inst.id, fromDate: FROM, toDate: TO });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOAN_CONFLICT');
  });

  it('400 con INSTRUMENT_NOT_LOANABLE se isLoanable=false', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({
      name: 'Pianoforte da concerto',
      family: 'tastiere',
      isLoanable: false,
    });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({ instrumentId: inst.id, fromDate: FROM, toDate: TO });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSTRUMENT_NOT_LOANABLE');
  });

  it('400 con INSTRUMENT_NOT_LOANABLE se condition è "fuori_uso"', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({
      name: 'Vecchio violino',
      family: 'archi',
      condition: 'fuori_uso',
    });

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({ instrumentId: inst.id, fromDate: FROM, toDate: TO });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSTRUMENT_NOT_LOANABLE');
  });
});

describe('POST /api/loans/:id/approve & /reject', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setup() {
    const student = await createAuthedUser({ role: 'studente' });
    const admin = await createAdmin();
    const inst = await createInstrument({ name: 'Sax', family: 'fiati_legni' });
    const create = await request(app)
      .post('/api/loans')
      .set('Authorization', student.authHeader)
      .send({ instrumentId: inst.id, fromDate: FROM, toDate: TO });
    expect(create.status).toBe(201);
    return { student, admin, loanId: create.body.loan.id };
  }

  it('approve cambia status in "active" e valorizza approver/approvedAt', async () => {
    const { admin, loanId } = await setup();

    const res = await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.loan.status).toBe('active');
    expect(res.body.loan.approvedBy).toBe(admin.user.id);
    expect(res.body.loan.approvedAt).toBeTruthy();
  });

  it('approve secondo tentativo restituisce 400 LOAN_INVALID_STATE', async () => {
    const { admin, loanId } = await setup();
    await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set('Authorization', admin.authHeader)
      .expect(200);

    const res = await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOAN_INVALID_STATE');
  });

  it('reject cambia status in "rejected"', async () => {
    const { admin, loanId } = await setup();

    const res = await request(app)
      .post(`/api/loans/${loanId}/reject`)
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.loan.status).toBe('rejected');
  });

  it('non-admin non può approvare (403)', async () => {
    const { student, loanId } = await setup();

    const res = await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set('Authorization', student.authHeader);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/loans/:id/return', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('proprietario può restituire un loan active → status="returned"', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Clavicembalo', family: 'tastiere' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'active',
    });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/return`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.loan.status).toBe('returned');
    expect(res.body.loan.returnedAt).toBeTruthy();
  });

  it('un secondo return su loan già restituito → 400 LOAN_ALREADY_RETURNED', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Tamburo', family: 'percussioni' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'returned',
      returnedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/return`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOAN_ALREADY_RETURNED');
  });

  it('utente diverso non può restituire un loan altrui (403)', async () => {
    const owner = await createAuthedUser({ role: 'studente' });
    const intruder = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Arpa', family: 'corde' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: owner.user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'active',
    });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/return`)
      .set('Authorization', intruder.authHeader);

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/loans/:id', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('utente cancella la propria richiesta in attesa → 200', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Marimba', family: 'percussioni' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'requested',
    });

    const res = await request(app).delete(`/api/loans/${loan.id}`).set('Authorization', authHeader);

    expect(res.status).toBe(200);
    const after = await InstrumentLoan.findByPk(loan.id);
    expect(after).toBeNull();
  });

  it('utente non può cancellare un proprio loan attivo (LOAN_INVALID_STATE)', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Sintetizzatore', family: 'elettronica' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'active',
    });

    const res = await request(app).delete(`/api/loans/${loan.id}`).set('Authorization', authHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOAN_INVALID_STATE');
  });

  it('utente non può cancellare loan altrui (403)', async () => {
    const owner = await createAuthedUser({ role: 'studente' });
    const intruder = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Mandolino', family: 'corde' });
    const loan = await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: owner.user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'requested',
    });

    const res = await request(app)
      .delete(`/api/loans/${loan.id}`)
      .set('Authorization', intruder.authHeader);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/loans/mine', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("ritorna solo i loan dell'utente loggato", async () => {
    const me = await createAuthedUser({ role: 'studente' });
    const other = await createAuthedUser({ role: 'studente' });
    const inst = await createInstrument({ name: 'Banjo', family: 'corde' });

    await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: me.user.id,
      fromDate: FROM,
      toDate: TO,
      status: 'requested',
    });
    await InstrumentLoan.create({
      instrumentId: inst.id,
      userId: other.user.id,
      fromDate: dayjs().add(20, 'day').format('YYYY-MM-DD'),
      toDate: dayjs().add(25, 'day').format('YYYY-MM-DD'),
      status: 'requested',
    });

    const res = await request(app).get('/api/loans/mine').set('Authorization', me.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.loans).toHaveLength(1);
    expect(res.body.loans[0].userId).toBe(me.user.id);
  });
});
