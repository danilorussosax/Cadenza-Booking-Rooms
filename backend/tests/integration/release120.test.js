'use strict';

const request = require('supertest');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildApp } = require('../../app');
const {
  Booking,
  BookingWaitlist,
  InstrumentLoan,
  InstrumentLoanQuota,
  User,
  PasswordResetToken,
} = require('../../models');
const {
  createAuthedUser,
  createCourse,
  createRoom,
  createBookingRule,
  createBooking,
  createInstrument,
  createUser,
} = require('../factories');
const twoFa = require('../../services/twoFa');
const security = require('../../services/authSecurity');
const { notifyNextOnSlot, closeEntry } = require('../../services/waitlistService');
const app = buildApp({ serveFrontend: false });
const start = () => new Date(Date.now() + 86400000);
const end = (time) => new Date(time.getTime() + 3600000);

beforeEach(() => globalThis.resetDatabase());

async function student() {
  const course = await createCourse();
  await createBookingRule();
  return createAuthedUser({ courseId: course.id });
}

it('moving a booking to an approval room returns pending_approval', async () => {
  const { user, authHeader } = await student();
  const room = await createRoom();
  const protectedRoom = await createRoom({ requiresApproval: true });
  const time = start();
  const booking = await createBooking({
    user,
    room,
    startTime: time,
    endTime: end(time),
    type: 'studio_individuale',
  });
  const res = await request(app)
    .put(`/api/bookings/${booking.id}`)
    .set('Authorization', authHeader)
    .send({ roomId: protectedRoom.id });
  expect(res.status).toBe(200);
  expect(res.body.booking.status).toBe('pending_approval');
});

it('claiming an approval room cannot bypass approval', async () => {
  const { user, authHeader } = await student();
  const room = await createRoom({ requiresApproval: true });
  const time = start();
  const entry = await BookingWaitlist.create({
    userId: user.id,
    roomId: room.id,
    startTime: time,
    endTime: end(time),
    notifiedAt: new Date(),
    expiresAt: end(new Date()),
  });
  const res = await request(app)
    .post(`/api/bookings/waitlist/${entry.id}/claim`)
    .set('Authorization', authHeader);
  expect(res.status).toBe(201);
  expect(res.body.booking.status).toBe('pending_approval');
});

it('waitlist cancellation promotes once and repeated deletion does not shift positions', async () => {
  const user = await createUser();
  const room = await createRoom();
  const time = start();
  const attrs = { userId: user.id, roomId: room.id, startTime: time, endTime: end(time) };
  const first = await BookingWaitlist.create({
    ...attrs,
    position: 0,
    notifiedAt: new Date(),
    expiresAt: end(new Date()),
  });
  const second = await BookingWaitlist.create({ ...attrs, position: 1 });
  const third = await BookingWaitlist.create({ ...attrs, position: 2 });
  await closeEntry(first.id, 'manual');
  await closeEntry(first.id, 'manual');
  await second.reload();
  await third.reload();
  expect(second.notifiedAt).not.toBeNull();
  expect(second.position).toBe(0);
  expect(third.position).toBe(1);
  expect(third.notifiedAt).toBeNull();
});

it('waitlist checks the entire candidate interval and does not notify twice', async () => {
  const user = await createUser();
  const room = await createRoom();
  const time = start();
  const entry = await BookingWaitlist.create({
    userId: user.id,
    roomId: room.id,
    startTime: time,
    endTime: end(end(time)),
  });
  const booking = await createBooking({
    user,
    room,
    startTime: end(time),
    endTime: end(end(time)),
    type: 'studio_individuale',
  });
  expect(
    await notifyNextOnSlot({ roomId: room.id, startTime: time, endTime: end(time) }),
  ).toBeNull();
  await Booking.update({ status: 'cancelled' }, { where: { id: booking.id } });
  const results = await Promise.all([notifyNextOnSlot(entry), notifyNextOnSlot(entry)]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

it('export includes actual loan dates and deletion cancels pending bookings and removes photo', async () => {
  const { user, authHeader } = await student();
  const room = await createRoom();
  const instrument = await createInstrument();
  await InstrumentLoan.create({
    userId: user.id,
    instrumentId: instrument.id,
    fromDate: '2026-10-01',
    toDate: '2026-10-05',
  });
  const time = start();
  const booking = await createBooking({
    user,
    room,
    startTime: time,
    endTime: end(time),
    type: 'studio_individuale',
    status: 'pending_approval',
  });
  const filename = `user-${user.id}-release120-${process.pid}-test.png`;
  const photo = path.join(__dirname, '../../uploads', filename);
  await fs.writeFile(photo, 'synthetic fixture');
  try {
    await user.update({ profilePhotoUrl: `/storage/${filename}` });
    const exported = await request(app)
      .get('/api/users/me/gdpr/export')
      .set('Authorization', authHeader);
    expect(exported.status).toBe(200);
    expect(exported.body.instrumentLoans[0]).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-05',
    });
    const removed = await request(app)
      .post('/api/users/me/gdpr/delete-request')
      .set('Authorization', authHeader);
    expect(removed.status).toBe(200);
    expect((await booking.reload()).status).toBe('cancelled');
    expect(await User.findByPk(user.id)).toBeNull();
    await expect(fs.stat(photo)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fs.rm(photo, { force: true });
  }
});

it('concurrent loans on different instruments respect the global quota', async () => {
  const { user, authHeader } = await student();
  await InstrumentLoanQuota.create({
    role: user.role,
    scopeKind: 'global',
    maxConcurrent: 1,
    isActive: true,
  });
  const a = await createInstrument({ isLoanable: true });
  const b = await createInstrument({ isLoanable: true });
  const fromDate = start().toISOString().slice(0, 10);
  const responses = await Promise.all(
    [a, b].map((instrument) =>
      request(app)
        .post('/api/loans')
        .set('Authorization', authHeader)
        .send({ instrumentId: instrument.id, fromDate, toDate: fromDate }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await InstrumentLoan.count({ where: { userId: user.id } })).toBe(1);
});

it('pre-2FA tokens cannot survive session revocation', async () => {
  const user = await createUser({ twoFaEnabled: true });
  const { code, record } = await twoFa.createChallenge('login');
  await user.update({ twoFaChallenge: record });
  const payload = twoFa.verifyPre2faToken(twoFa.signPre2faToken(user.id, user.tokenVersion));
  await user.increment('tokenVersion');
  const result = await security.verifyLogin(payload, { code });
  expect(result.status).toBe(401);
  expect(result.body.code).toBe('TOKEN_REVOKED');
});

it('simultaneous OTP and recovery consumption allow only one success', async () => {
  const user = await createUser({ twoFaEnabled: true });
  const { code, record } = await twoFa.createChallenge('login');
  const recoveryCode = twoFa.generateRecoveryCodes()[0];
  await user.update({
    twoFaChallenge: record,
    twoFaRecoveryCodes: await twoFa.hashRecoveryCodes([recoveryCode]),
  });
  const payload = { id: user.id, tokenVersion: user.tokenVersion };
  for (const factor of [{ code }, { recoveryCode }]) {
    const results = await Promise.all([
      security.verifyLogin(payload, factor),
      security.verifyLogin(payload, factor),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  }
});

it('a password-reset token is consumed atomically', async () => {
  const user = await createUser();
  const tokenHash = 'b'.repeat(64);
  await PasswordResetToken.create({ userId: user.id, tokenHash, expiresAt: end(new Date()) });
  const results = await Promise.all([
    security.resetPassword(tokenHash, 'NewPassword123!'),
    security.resetPassword(tokenHash, 'OtherPassword123!'),
  ]);
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect((await user.reload()).tokenVersion).toBe(1);
});

it('annual loan quota clips loans crossing the rolling-year boundary', async () => {
  const { user } = await student();
  const instrument = await createInstrument();
  const dayjs = require('dayjs');
  const cutoff = dayjs().subtract(365, 'day');
  await InstrumentLoanQuota.create({ role: user.role, scopeKind: 'global', maxDaysPerYear: 5 });
  await InstrumentLoan.create({
    userId: user.id,
    instrumentId: instrument.id,
    fromDate: cutoff.subtract(10, 'day').format('YYYY-MM-DD'),
    toDate: cutoff.add(3, 'day').format('YYYY-MM-DD'),
    status: 'returned',
  });
  const check = require('../../services/loanQuotaValidator').checkLoanQuotas;
  const fromDate = dayjs().add(1, 'day').format('YYYY-MM-DD');
  expect(await check({ user, instrument, fromDate, toDate: fromDate })).toEqual([]);
  expect(
    await check({ user, instrument, fromDate, toDate: dayjs().add(2, 'day').format('YYYY-MM-DD') }),
  ).toHaveLength(1);
});

it('SMTP config refresh closes the expired pool and shares a concurrent refresh', async () => {
  const email = require('../../services/emailService');
  const nodemailer = require('nodemailer');
  const originalHost = process.env.SMTP_HOST;
  email.invalidateCache();
  process.env.SMTP_HOST = 'smtp.example.invalid';
  const close = vi.fn();
  const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ close });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await email.loadConfig();
    clock.mockReturnValue(now + 61000);
    await Promise.all([email.loadConfig(), email.loadConfig(), email.loadConfig()]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
    email.invalidateCache();
    transport.mockRestore();
    process.env.SMTP_HOST = originalHost;
  }
});

it('readiness remains bounded when SMTP verification never responds', async () => {
  const email = require('../../services/emailService');
  const enabled = vi.spyOn(email, 'emailEnabled').mockResolvedValue(true);
  const transport = vi
    .spyOn(email._internal, 'getTransporter')
    .mockResolvedValue({ verify: () => new Promise(() => {}) });
  const started = Date.now();
  try {
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.checks.database.ok).toBe(true);
    expect(response.body.checks.smtp.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3500);
  } finally {
    enabled.mockRestore();
    transport.mockRestore();
  }
});

it('bulk cancellation dispatches waitlist notifications', async () => {
  const { user } = await student();
  const admin = await require('../factories').createAdmin();
  const room = await createRoom();
  const time = start();
  const booking = await createBooking({
    user,
    room,
    startTime: time,
    endTime: end(time),
    type: 'studio_individuale',
  });
  const entry = await BookingWaitlist.create({
    userId: user.id,
    roomId: room.id,
    startTime: time,
    endTime: end(time),
  });
  const response = await request(app)
    .post('/api/bookings/bulk-cancel')
    .set('Authorization', admin.authHeader)
    .send({ ids: [booking.id] });
  expect(response.status).toBe(200);
  await vi.waitFor(async () => {
    expect((await entry.reload()).notifiedAt).not.toBeNull();
  });
});

it('concurrent approval and owner deletion cannot remove an approved loan', async () => {
  const { user, authHeader } = await student();
  const admin = await require('../factories').createAdmin();
  const instrument = await createInstrument();
  const loan = await InstrumentLoan.create({
    userId: user.id,
    instrumentId: instrument.id,
    fromDate: '2027-01-01',
    toDate: '2027-01-02',
  });
  const [approved, deleted] = await Promise.all([
    request(app).post(`/api/loans/${loan.id}/approve`).set('Authorization', admin.authHeader),
    request(app).delete(`/api/loans/${loan.id}`).set('Authorization', authHeader),
  ]);
  const final = await InstrumentLoan.findByPk(loan.id);
  if (approved.status === 200) {
    // 400 if approval preceded the initial read, 409 if it won during deletion.
    expect([400, 409]).toContain(deleted.status);
    expect(deleted.body.code).toBe('LOAN_INVALID_STATE');
    expect(final.status).toBe('active');
  } else {
    expect(deleted.status).toBe(200);
    expect(approved.status).toBe(404);
    expect(final).toBeNull();
  }
});
