'use strict';

/**
 * Regressione: GET /api/instruments segna «in prestito ora» ogni strumento
 * con un prestito che lo occupa (requested/active/overdue), scaduto incluso.
 */

const dayjs = require('dayjs');
const request = require('supertest');
const { buildApp } = require('../../app');
const { InstrumentLoan } = require('../../models');
const { createAuthedUser, createInstrument } = require('../factories');

const app = buildApp({ serveFrontend: false });
const fmt = (d) => dayjs().add(d, 'day').format('YYYY-MM-DD');

describe('GET /api/instruments — stato «in prestito»', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('occupano lo strumento: overdue, active scaduto (derivato), active, requested; returned/rejected no', async () => {
    const { authHeader, user } = await createAuthedUser({ role: 'studente' });
    const cases = {
      overdue: { status: 'overdue', from: -10, to: -3 },
      activePast: { status: 'active', from: -10, to: -3 },
      active: { status: 'active', from: -1, to: 5 },
      requested: { status: 'requested', from: 1, to: 5 },
      returned: { status: 'returned', from: -10, to: -3 },
      rejected: { status: 'rejected', from: 1, to: 5 },
    };
    const ids = {};
    for (const [key, c] of Object.entries(cases)) {
      const inst = await createInstrument({ name: `Strumento ${key}`, family: 'archi' });
      ids[key] = inst.id;
      await InstrumentLoan.create({
        instrumentId: inst.id,
        userId: user.id,
        fromDate: fmt(c.from),
        toDate: fmt(c.to),
        status: c.status,
      });
    }

    const res = await request(app).get('/api/instruments').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.instruments.map((i) => [i.id, i]));

    expect(byId.get(ids.overdue).currentLoanStatus).toBe('overdue');
    expect(byId.get(ids.activePast).currentLoanStatus).toBe('active');
    expect(byId.get(ids.active).currentLoanStatus).toBe('active');
    expect(byId.get(ids.requested).currentLoanStatus).toBe('requested');
    expect(byId.get(ids.returned).currentLoanStatus).toBeNull();
    expect(byId.get(ids.rejected).currentLoanStatus).toBeNull();
  });
});
