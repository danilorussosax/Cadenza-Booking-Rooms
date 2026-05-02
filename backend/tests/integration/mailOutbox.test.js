'use strict';

/**
 * Integrazione: outbox email + worker scheduler.
 *
 * Coperture:
 *   - enqueueMail crea riga pending con priority/idempotency
 *   - enqueueMail con idempotencyKey duplicato → deduped (no doppia riga)
 *   - tick: success → status='sent', sentAt valorizzato
 *   - tick: fail → attempts++, nextAttemptAt nel futuro (backoff)
 *   - tick: superato maxAttempts → status='dead'
 *   - tick: priority 0 (security) processata prima di priority 9 (announcement)
 *   - backoffMs cresce esponenzialmente con cap a 1h
 *   - sendBookingEmail rispetta toggle utente (notifyOnConfirmation=false)
 *   - sendSecurityEmail: tentativo sync, fallback a outbox su errore
 */

const emailService = require('../../services/emailService');
const outbox = require('../../services/mailOutboxScheduler');
const { MailOutbox, User } = require('../../models');
const { createUser } = require('../factories');

function fakeCfg(sendMail) {
  return {
    transporter: { sendMail, verify: vi.fn().mockResolvedValue(true) },
    from: 'Test <test@cadenza.local>',
    replyTo: null,
  };
}

describe('emailService.enqueueMail', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('inserisce una riga pending con i campi previsti', async () => {
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      priority: 5,
      idempotencyKey: 'booking:1:confirmation',
    });
    expect(r.queued).toBe(true);
    expect(r.deduped).toBe(false);

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('pending');
    expect(row.kind).toBe('confirmation');
    expect(row.to).toBe('a@example.com');
    expect(row.priority).toBe(5);
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
  });

  it('idempotencyKey duplicato → deduped (no riga in più)', async () => {
    const opts = {
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'booking:42:confirmation',
    };
    const r1 = await emailService.enqueueMail(opts);
    const r2 = await emailService.enqueueMail(opts);
    expect(r1.queued).toBe(true);
    expect(r2.queued).toBe(false);
    expect(r2.deduped).toBe(true);
    const count = await MailOutbox.count();
    expect(count).toBe(1);
  });

  it('senza idempotencyKey ammette duplicati', async () => {
    const base = {
      kind: 'announcement',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
    };
    await emailService.enqueueMail(base);
    await emailService.enqueueMail(base);
    expect(await MailOutbox.count()).toBe(2);
  });
});

describe('mailOutboxScheduler.tick', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    outbox.stop(); // assicura verified=false
  });

  it('processa una pending con successo → status=sent', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'ok' });
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'k1',
    });
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    expect(row.lastError).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('a@example.com');
  });

  it('su errore SMTP: attempts++, nextAttemptAt nel futuro, status=pending', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('SMTP down'));
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'k2',
    });
    const before = Date.now();
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/SMTP down/);
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(before);
  });

  it('superato maxAttempts → status=dead', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('forever down'));
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'k3',
    });
    // imposta maxAttempts=1 per arrivare subito a dead
    await MailOutbox.update({ maxAttempts: 1 }, { where: {} });
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(1);
  });

  it('processa priority 0 (security) prima di priority 9 (announcement)', async () => {
    const order = [];
    const sendMail = vi.fn().mockImplementation(({ to }) => {
      order.push(to);
      return Promise.resolve();
    });
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    await emailService.enqueueMail({
      kind: 'announcement',
      to: 'low@example.com',
      subject: 'S',
      html: '<p>x</p>',
      priority: 9,
    });
    await emailService.enqueueMail({
      kind: 'security',
      to: 'high@example.com',
      subject: 'S',
      html: '<p>x</p>',
      priority: 0,
    });
    await outbox.tick();

    expect(order).toEqual(['high@example.com', 'low@example.com']);
  });

  it('skip totale se SMTP non configurato', async () => {
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({ transporter: null, from: null });
    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'k-noop',
    });
    await outbox.tick();
    const row = await MailOutbox.findOne();
    expect(row.status).toBe('pending'); // non toccata
    expect(row.attempts).toBe(0);
  });
});

describe('mailOutboxScheduler.backoffMs', () => {
  it('cresce esponenzialmente, cap a 1h', () => {
    expect(outbox.backoffMs(1)).toBe(60_000); // 60s
    expect(outbox.backoffMs(2)).toBe(120_000); // 2min
    expect(outbox.backoffMs(3)).toBe(240_000); // 4min
    expect(outbox.backoffMs(4)).toBe(480_000); // 8min
    expect(outbox.backoffMs(10)).toBe(60 * 60 * 1000); // cap 1h
    expect(outbox.backoffMs(20)).toBe(60 * 60 * 1000); // cap 1h
  });
});

describe('emailService.sendBookingEmail (rispetto preferenze utente)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('NON accoda se emailNotifications=false sull utente', async () => {
    const u = await createUser({ emailNotifications: false });
    await emailService.sendBookingEmail({
      user: u,
      booking: { id: 1, type: 'studio_individuale', startTime: new Date(), endTime: new Date() },
      kind: 'confirmation',
    });
    expect(await MailOutbox.count()).toBe(0);
  });

  it('NON accoda se notifyOnConfirmation=false', async () => {
    const u = await createUser({ notifyOnConfirmation: false });
    await emailService.sendBookingEmail({
      user: u,
      booking: { id: 1, type: 'studio_individuale', startTime: new Date(), endTime: new Date() },
      kind: 'confirmation',
    });
    expect(await MailOutbox.count()).toBe(0);
  });
});

describe('emailService.sendSecurityEmail (try-sync-then-enqueue)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('tentativo sincrono OK → no riga in outbox', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'ok' });
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    const r = await emailService.sendSecurityEmail({
      to: 'a@example.com',
      subject: 'OTP',
      html: '<p>123456</p>',
    });
    expect(r.ok).toBe(true);
    expect(r.queued).toBeFalsy();
    expect(await MailOutbox.count()).toBe(0);
  });

  it('errore sincrono → fallback a outbox con priority=0', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('SMTP timeout'));
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue(fakeCfg(sendMail));

    const r = await emailService.sendSecurityEmail({
      to: 'a@example.com',
      subject: 'OTP',
      html: '<p>123456</p>',
    });
    expect(r.ok).toBe(true);
    expect(r.queued).toBe(true);

    const row = await MailOutbox.findOne();
    expect(row.kind).toBe('security');
    expect(row.priority).toBe(0);
    expect(row.to).toBe('a@example.com');
  });
});
