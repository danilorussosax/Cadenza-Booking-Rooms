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
const { MailOutbox, User, MailSettings } = require('../../models');
const { createUser } = require('../factories');

// Vitest 4: senza restoreMocks=true in config, gli spy persistono tra test.
// Restore globale in afterEach per evitare contaminazioni tra describe block.
afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('NON accoda ghost_cancellation se la room ha requireCheckIn=false', async () => {
    // Hard guard: la template ghost_cancellation parla di "scansiona il QR".
    // Anche se uno scheduler/router invocasse sendBookingEmail per errore,
    // l'email non deve mai arrivare a un utente la cui aula non richiede
    // check-in (era il sintomo riportato).
    const u = await createUser();
    await emailService.sendBookingEmail({
      user: u,
      booking: {
        id: 1,
        type: 'studio_individuale',
        startTime: new Date(),
        endTime: new Date(),
        room: { id: 1, name: 'Aula libera', requireCheckIn: false },
      },
      kind: 'ghost_cancellation',
    });
    expect(await MailOutbox.count()).toBe(0);
  });

  it('accoda ghost_cancellation se requireCheckIn=true', async () => {
    const u = await createUser();
    await emailService.sendBookingEmail({
      user: u,
      booking: {
        id: 2,
        type: 'studio_individuale',
        startTime: new Date(),
        endTime: new Date(),
        room: { id: 1, name: 'Aula QR', requireCheckIn: true },
      },
      kind: 'ghost_cancellation',
    });
    expect(await MailOutbox.count()).toBe(1);
  });
});

describe('retentionScheduler.pruneMailOutbox', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cancella le righe sent più vecchie di 30gg', async () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'old@example.com',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      status: 'sent',
      sentAt: oldDate,
    });
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'recent@example.com',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      status: 'sent',
      sentAt: recentDate,
    });
    const retention = require('../../services/retentionScheduler');
    await retention.pruneMailOutbox();

    const rows = await MailOutbox.findAll();
    expect(rows.length).toBe(1);
    expect(rows[0].to).toBe('recent@example.com');
  });

  it('NON tocca righe dead (anche se vecchie)', async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'dead@example.com',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      status: 'dead',
      attempts: 5,
      lastError: 'forever down',
      // Per sentAt usiamo updatedAt come proxy: ma il filtro è su status+sentAt.
      // Le dead hanno sentAt=NULL → il WHERE non le matcha comunque.
    });
    const retention = require('../../services/retentionScheduler');
    await retention.pruneMailOutbox();
    expect(await MailOutbox.count()).toBe(1);
  });

  it('NON tocca righe pending', async () => {
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'pending@example.com',
      subject: 'S',
      bodyHtml: '<p>x</p>',
      status: 'pending',
    });
    const retention = require('../../services/retentionScheduler');
    await retention.pruneMailOutbox();
    expect(await MailOutbox.count()).toBe(1);
  });
});

describe('Fase 3a — Throttle per destinatario', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function setThrottle(n) {
    await MailSettings.upsert({ id: 1, throttlePerRecipientPerHour: n });
    emailService.invalidateCache();
  }

  it('skip enqueue se conta sent+pending sopra soglia', async () => {
    await setThrottle(2);
    // Pre-fill: 2 email a stesso destinatario
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'a',
      bodyHtml: '<p>a</p>',
      status: 'sent',
      sentAt: new Date(),
    });
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'b',
      bodyHtml: '<p>b</p>',
      status: 'pending',
    });
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'c',
      html: '<p>c</p>',
      priority: 5,
    });
    expect(r.queued).toBe(false);
    expect(r.skipped).toBe('throttled');
    expect(await MailOutbox.count()).toBe(2); // non aggiunta
  });

  it('NON skippa altri destinatari sotto soglia', async () => {
    await setThrottle(2);
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'a',
      bodyHtml: '<p>a</p>',
      status: 'sent',
      sentAt: new Date(),
    });
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'b',
      bodyHtml: '<p>b</p>',
      status: 'sent',
      sentAt: new Date(),
    });
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'other@example.com',
      subject: 'c',
      html: '<p>c</p>',
      priority: 5,
    });
    expect(r.queued).toBe(true);
  });

  it('email security/2FA (priority=0) bypassa il throttle', async () => {
    await setThrottle(1);
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'busy@example.com',
      subject: 'a',
      bodyHtml: '<p>a</p>',
      status: 'sent',
      sentAt: new Date(),
    });
    const r = await emailService.enqueueMail({
      kind: 'security',
      to: 'busy@example.com',
      subject: 'OTP',
      html: '<p>123</p>',
      priority: 0,
    });
    expect(r.queued).toBe(true);
  });

  it('NON conta sent vecchie (>1h)', async () => {
    await setThrottle(2);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'old1',
      bodyHtml: '<p>x</p>',
      status: 'sent',
      sentAt: twoHoursAgo,
    });
    await MailOutbox.create({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'old2',
      bodyHtml: '<p>x</p>',
      status: 'sent',
      sentAt: twoHoursAgo,
    });
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'new',
      html: '<p>x</p>',
      priority: 5,
    });
    expect(r.queued).toBe(true);
  });

  it('throttle=0 (default) → no rate limit', async () => {
    await setThrottle(0);
    for (let i = 0; i < 5; i++) {
      await MailOutbox.create({
        kind: 'confirmation',
        to: 'a@example.com',
        subject: `s${i}`,
        bodyHtml: '<p>x</p>',
        status: 'sent',
        sentAt: new Date(),
      });
    }
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'a@example.com',
      subject: 'new',
      html: '<p>x</p>',
      priority: 5,
    });
    expect(r.queued).toBe(true);
  });
});

describe('Fase 3b — Hard-bounce detection', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    outbox.stop();
  });

  it('SMTP 550 → riga dead immediato + utente segnato bounced', async () => {
    const u = await createUser({ email: 'bounced@example.com' });
    const err = new Error('550 5.1.1 user not found');
    err.responseCode = 550;
    const sendMail = vi.fn().mockRejectedValue(err);
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({
      transporter: { sendMail, verify: vi.fn().mockResolvedValue(true) },
      from: 'x',
      replyTo: null,
      throttlePerRecipientPerHour: 0,
    });

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'bounced@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'b1',
      priority: 5,
    });
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(1); // dead immediato, non max_attempts
    expect(row.lastError).toMatch(/SMTP 550/);

    const fresh = await User.findByPk(u.id);
    expect(fresh.emailBouncedAt).not.toBeNull();
    expect(fresh.emailBouncedReason).toMatch(/SMTP 550/);
  });

  it('SMTP 421 (transient) NON marca utente come bounced', async () => {
    const u = await createUser({ email: 'transient@example.com' });
    const err = new Error('421 4.7.0 service temporarily unavailable');
    err.responseCode = 421;
    const sendMail = vi.fn().mockRejectedValue(err);
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({
      transporter: { sendMail, verify: vi.fn().mockResolvedValue(true) },
      from: 'x',
      replyTo: null,
      throttlePerRecipientPerHour: 0,
    });

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'transient@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'b2',
      priority: 5,
    });
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('pending'); // retry, non dead
    expect(row.attempts).toBe(1);

    const fresh = await User.findByPk(u.id);
    expect(fresh.emailBouncedAt).toBeNull();
  });

  it('codice estratto dal response testuale (no responseCode field)', async () => {
    const u = await createUser({ email: 'msg@example.com' });
    // Caso tipico Postfix: nodemailer con err.response = "551 5.7.1 ..."
    // ma SENZA responseCode numerico esplicito.
    const err = new Error('Recipient address rejected');
    err.response = '551 5.7.1 user not local';
    const sendMail = vi.fn().mockRejectedValue(err);
    vi.spyOn(emailService, 'loadConfig').mockResolvedValue({
      transporter: { sendMail, verify: vi.fn().mockResolvedValue(true) },
      from: 'x',
      replyTo: null,
      throttlePerRecipientPerHour: 0,
    });

    await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'msg@example.com',
      subject: 'S',
      html: '<p>x</p>',
      idempotencyKey: 'b3',
      priority: 5,
    });
    await outbox.tick();

    const row = await MailOutbox.findOne();
    expect(row.status).toBe('dead');
    const fresh = await User.findByPk(u.id);
    expect(fresh.emailBouncedAt).not.toBeNull();
  });

  it('enqueueMail skippa destinatario già bounced', async () => {
    await createUser({
      email: 'dead@example.com',
      emailBouncedAt: new Date(),
      emailBouncedReason: 'SMTP 550',
    });
    const r = await emailService.enqueueMail({
      kind: 'confirmation',
      to: 'dead@example.com',
      subject: 'S',
      html: '<p>x</p>',
      priority: 5,
    });
    expect(r.queued).toBe(false);
    expect(r.skipped).toBe('bounced');
    expect(await MailOutbox.count()).toBe(0);
  });

  it('email security (priority=0) bypassa il bounce gate', async () => {
    await createUser({
      email: 'dead@example.com',
      emailBouncedAt: new Date(),
      emailBouncedReason: 'SMTP 550',
    });
    const r = await emailService.enqueueMail({
      kind: 'security',
      to: 'dead@example.com',
      subject: 'OTP',
      html: '<p>123</p>',
      priority: 0,
    });
    expect(r.queued).toBe(true);
  });

  it('hook beforeUpdate: cambiare email resetta bounce flag', async () => {
    const u = await createUser({
      email: 'old@example.com',
      emailBouncedAt: new Date(),
      emailBouncedReason: 'SMTP 550',
    });
    await u.update({ email: 'new@example.com' });
    const fresh = await User.findByPk(u.id);
    expect(fresh.email).toBe('new@example.com');
    expect(fresh.emailBouncedAt).toBeNull();
    expect(fresh.emailBouncedReason).toBeNull();
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
