'use strict';

/**
 * Integrazione: /api/admin/instrument-loan-quotas + flow di applicazione
 * runtime in routes/instrumentLoans.js POST.
 *
 * Cosa testiamo:
 *   - CRUD endpoint admin (auth + validation)
 *   - validatore checkLoanQuotas: rifiuta se maxConcurrent / maxDaysPerYear
 *     superati per la famiglia richiesta
 *   - admin bypass (gli admin non sono soggetti alle quote)
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { InstrumentLoan } = require('../../models');
const { createAdmin, createAuthedUser, createCourse, createInstrument } = require('../factories');

const app = buildApp({ serveFrontend: false });

async function studentWithProfile() {
  const course = await createCourse();
  return createAuthedUser({
    role: 'studente',
    courseId: course.id,
    matricola: 'LQ-MAT',
  });
}

describe('CRUD /api/admin/instrument-loan-quotas', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('admin può creare una quota family', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', authHeader)
      .send({
        role: 'studente',
        scopeKind: 'family',
        scopeValue: 'archi',
        maxConcurrent: 1,
        maxDaysPerYear: 60,
        isActive: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.quota.scopeValue).toBe('archi');
  });

  it('400 se nessun cap > 0', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', authHeader)
      .send({
        role: 'studente',
        scopeKind: 'global',
        maxConcurrent: 0,
        maxDaysPerYear: 0,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('403 senza ruolo admin', async () => {
    const { authHeader } = await studentWithProfile();
    const res = await request(app)
      .get('/api/admin/instrument-loan-quotas')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('rifiuta scopeKind=instrument se id inesistente', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', authHeader)
      .send({
        role: 'studente',
        scopeKind: 'instrument',
        scopeValue: '99999',
        maxConcurrent: 1,
        maxDaysPerYear: 0,
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('INSTRUMENT_NOT_FOUND');
  });
});

describe('Applicazione quote in POST /api/loans', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('blocca un secondo prestito sulla stessa famiglia se maxConcurrent=1', async () => {
    const { user, authHeader } = await studentWithProfile();
    const { authHeader: adminAuth } = await createAdmin();
    const v1 = await createInstrument({ name: 'Violino A', family: 'archi' });
    const v2 = await createInstrument({ name: 'Violino B', family: 'archi' });

    // Quota: studenti, family=archi, max 1 contemporaneo
    await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', adminAuth)
      .send({
        role: 'studente',
        scopeKind: 'family',
        scopeValue: 'archi',
        maxConcurrent: 1,
        maxDaysPerYear: 0,
      })
      .expect(201);

    // Prestito attivo pre-esistente per lo studente sul v1
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const futureEnd = dayjs().add(7, 'day').format('YYYY-MM-DD');
    await InstrumentLoan.create({
      instrumentId: v1.id,
      userId: user.id,
      fromDate: yesterday,
      toDate: futureEnd,
      status: 'active',
    });

    // Tentativo di prendere v2 → DEVE essere bloccato dalla quota
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const after = dayjs().add(10, 'day').format('YYYY-MM-DD');
    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({ instrumentId: v2.id, fromDate: tomorrow, toDate: after });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOAN_QUOTA_EXCEEDED_FAMILY');
  });

  it('blocca quando maxDaysPerYear sarebbe superato', async () => {
    const { user, authHeader } = await studentWithProfile();
    const { authHeader: adminAuth } = await createAdmin();
    const i1 = await createInstrument({ name: 'Pianoforte X', family: 'tastiere' });
    const i2 = await createInstrument({ name: 'Pianoforte Y', family: 'tastiere' });

    // Quota globale: max 30gg/anno
    await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', adminAuth)
      .send({
        role: 'studente',
        scopeKind: 'global',
        maxConcurrent: 0,
        maxDaysPerYear: 30,
      })
      .expect(201);

    // 25 giorni già usati (recenti)
    await InstrumentLoan.create({
      instrumentId: i1.id,
      userId: user.id,
      fromDate: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
      toDate: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
      status: 'returned',
    });

    // Richiesta di altri 10gg → 35 totali > 30 → blocco
    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', authHeader)
      .send({
        instrumentId: i2.id,
        fromDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        toDate: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOAN_QUOTA_EXCEEDED_GLOBAL');
  });

  it('admin bypass: nessuna quota viene applicata', async () => {
    const { authHeader: adminAuth } = await createAdmin();
    const i = await createInstrument({ name: 'Cello', family: 'archi' });

    // Quota molto restrittiva sulla famiglia archi
    await request(app)
      .post('/api/admin/instrument-loan-quotas')
      .set('Authorization', adminAuth)
      .send({
        role: 'admin',
        scopeKind: 'family',
        scopeValue: 'archi',
        maxConcurrent: 0,
        maxDaysPerYear: 1,
      })
      .expect(201);

    // L'admin richiede comunque per sé → non si applica (admin bypass)
    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', adminAuth)
      .send({
        instrumentId: i.id,
        fromDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        toDate: dayjs().add(60, 'day').format('YYYY-MM-DD'),
      });
    expect(res.status).toBe(201);
  });
});
