'use strict';

/**
 * Modulo services/loanLifecycle senza HTTP: transizioni, atomicita',
 * conflitto/quote, overdue derivato vs persistito, mail.
 */

const dayjs = require('dayjs');
const { InstrumentLoan, InstrumentLoanQuota } = require('../../models');
const { createUser, createInstrument, createCourse } = require('../factories');
const lifecycle = require('../../services/loanLifecycle');
const instrumentLoanEmail = require('../../services/instrumentLoanEmail');

const FROM = dayjs().add(1, 'day').format('YYYY-MM-DD');
const TO = dayjs().add(3, 'day').format('YYYY-MM-DD');

let mailSpy;
beforeEach(async () => {
  await globalThis.resetDatabase();
  mailSpy = vi.spyOn(instrumentLoanEmail, 'sendInstrumentLoanEmail').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const user = await createUser({ role: 'studente' });
  const admin = await createUser({ role: 'admin' });
  const instrument = await createInstrument({ isLoanable: true });
  return { user, admin, instrument };
}
const req = (user, instrument, extra = {}) =>
  lifecycle.request({
    user,
    instrumentId: instrument.id,
    fromDate: FROM,
    toDate: TO,
    ...extra,
  });
const kinds = () => mailSpy.mock.calls.map((c) => c[0].kind);

describe('stati', () => {
  it('isOccupying / OCCUPYING_STATUSES', () => {
    expect(lifecycle.OCCUPYING_STATUSES).toEqual(['requested', 'active', 'overdue']);
    expect(lifecycle.isOccupying('active')).toBe(true);
    expect(lifecycle.isOccupying('returned')).toBe(false);
    expect(lifecycle.isOccupying('rejected')).toBe(false);
  });

  it('overdue derivato e persistito condividono la definizione', () => {
    const past = { status: 'active', toDate: dayjs().subtract(2, 'day').format('YYYY-MM-DD') };
    const future = { status: 'active', toDate: dayjs().add(2, 'day').format('YYYY-MM-DD') };
    expect(lifecycle.isOverdue(past)).toBe(true);
    expect(lifecycle.isOverdue(future)).toBe(false);
    expect(lifecycle.isOverdue({ ...past, status: 'requested' })).toBe(false);
    expect(lifecycle.annotateStatus(past).status).toBe('overdue');
    expect(lifecycle.annotateStatus(future).status).toBe('active');
    // Una riga gia' persistita come overdue resta overdue.
    expect(lifecycle.annotateStatus({ status: 'overdue', toDate: past.toDate }).status).toBe(
      'overdue',
    );
  });
});

describe('request', () => {
  it('crea requested e accoda loan_requested', async () => {
    const { user, instrument } = await setup();
    const loan = await req(user, instrument);
    expect(loan.status).toBe('requested');
    expect(kinds()).toEqual(['loan_requested']);
  });

  it('rifiuta date invalide, passato, strumento non prestabile, condizione', async () => {
    const { user, instrument } = await setup();
    await expect(req(user, instrument, { toDate: 'xx' })).rejects.toMatchObject({
      code: 'LOAN_INVALID_DATE',
    });
    await expect(req(user, instrument, { fromDate: TO, toDate: FROM })).rejects.toMatchObject({
      code: 'LOAN_INVALID_DATE',
    });
    await expect(
      req(user, instrument, { fromDate: dayjs().subtract(3, 'day').format('YYYY-MM-DD') }),
    ).rejects.toMatchObject({ code: 'LOAN_INVALID_DATE' });
    const bad = await createInstrument({ isLoanable: true, condition: 'fuori_uso' });
    await expect(req(user, bad)).rejects.toMatchObject({ code: 'INSTRUMENT_NOT_LOANABLE' });
    const nl = await createInstrument({ isLoanable: false });
    await expect(req(user, nl)).rejects.toMatchObject({ code: 'INSTRUMENT_NOT_LOANABLE' });
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it('corso non abilitato -> 403', async () => {
    const { user } = await setup();
    const course = await createCourse();
    const inst = await createInstrument({ isLoanable: true, allowedCourseIds: [course.id] });
    await expect(req(user, inst)).rejects.toMatchObject({
      code: 'INSTRUMENT_NOT_ALLOWED_FOR_COURSE',
      status: 403,
    });
  });

  it('conflitto con prestito che occupa (409), non con rejected', async () => {
    const { user, admin, instrument } = await setup();
    const first = await req(user, instrument);
    await expect(req(admin, instrument)).rejects.toMatchObject({
      code: 'LOAN_CONFLICT',
      status: 409,
    });
    await lifecycle.reject({ id: first.id, actor: admin });
    await expect(req(admin, instrument)).resolves.toBeTruthy();
  });

  it('quote: maxConcurrent superato -> 409 con codice di scope', async () => {
    const { user, instrument } = await setup();
    await InstrumentLoanQuota.create({
      role: 'studente',
      scopeKind: 'global',
      maxConcurrent: 1,
      maxDaysPerYear: 0,
      isActive: true,
    });
    await req(user, instrument);
    const other = await createInstrument({ isLoanable: true });
    await expect(req(user, other)).rejects.toMatchObject({
      code: 'LOAN_QUOTA_EXCEEDED_GLOBAL',
      status: 409,
    });
  });
});

describe('transizioni', () => {
  it('approve: requested -> active, mail; seconda approve invalida', async () => {
    const { user, admin, instrument } = await setup();
    const loan = await req(user, instrument);
    const done = await lifecycle.approve({ id: loan.id, actor: admin });
    expect(done.status).toBe('active');
    expect(done.approvedBy).toBe(admin.id);
    await expect(lifecycle.approve({ id: loan.id, actor: admin })).rejects.toMatchObject({
      code: 'LOAN_INVALID_STATE',
    });
    expect(kinds()).toEqual(['loan_requested', 'loan_approved']);
  });

  it('approve/reject su id inesistente -> NOT_FOUND 404', async () => {
    const { admin } = await setup();
    await expect(lifecycle.approve({ id: 9999, actor: admin })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(lifecycle.reject({ id: 9999, actor: admin })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('doppia approvazione concorrente: una sola vince, una sola mail', async () => {
    const { user, admin, instrument } = await setup();
    const loan = await req(user, instrument);
    mailSpy.mockClear();
    const res = await Promise.allSettled([
      lifecycle.approve({ id: loan.id, actor: admin }),
      lifecycle.approve({ id: loan.id, actor: admin }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.find((r) => r.status === 'rejected').reason.code).toBe('LOAN_INVALID_STATE');
    expect(kinds()).toEqual(['loan_approved']);
  });

  it('reject: requested -> rejected; non da active', async () => {
    const { user, admin, instrument } = await setup();
    const a = await req(user, instrument);
    expect((await lifecycle.reject({ id: a.id, actor: admin })).status).toBe('rejected');
    const b = await req(user, instrument);
    await lifecycle.approve({ id: b.id, actor: admin });
    await expect(lifecycle.reject({ id: b.id, actor: admin })).rejects.toMatchObject({
      code: 'LOAN_INVALID_STATE',
    });
    expect(kinds()).toContain('loan_rejected');
  });

  it('returnLoan: da active/overdue; poi ALREADY_RETURNED; da requested invalido', async () => {
    const { user, admin, instrument } = await setup();
    const a = await req(user, instrument);
    await expect(lifecycle.returnLoan({ id: a.id })).rejects.toMatchObject({
      code: 'LOAN_INVALID_STATE',
    });
    await lifecycle.approve({ id: a.id, actor: admin });
    await InstrumentLoan.update({ status: 'overdue' }, { where: { id: a.id } });
    const done = await lifecycle.returnLoan({ id: a.id });
    expect(done.status).toBe('returned');
    expect(done.returnedAt).toBeTruthy();
    await expect(lifecycle.returnLoan({ id: a.id })).rejects.toMatchObject({
      code: 'LOAN_ALREADY_RETURNED',
    });
    expect(kinds()).toContain('loan_returned');
  });

  it('cancel: utente solo requested propria; admin sempre', async () => {
    const { user, admin, instrument } = await setup();
    const a = await req(user, instrument);
    await lifecycle.approve({ id: a.id, actor: admin });
    const active = await InstrumentLoan.findByPk(a.id);
    await expect(lifecycle.cancel({ loan: active, actor: user })).rejects.toMatchObject({
      code: 'LOAN_INVALID_STATE',
    });
    await lifecycle.cancel({ loan: active, actor: admin });
    expect(await InstrumentLoan.findByPk(a.id)).toBeNull();

    const b = await req(user, instrument);
    await lifecycle.cancel({ loan: b, actor: user });
    expect(await InstrumentLoan.findByPk(b.id)).toBeNull();
    await expect(lifecycle.cancel({ loan: b, actor: user })).rejects.toMatchObject({
      code: 'LOAN_INVALID_STATE',
      status: 409,
    });
  });
});
