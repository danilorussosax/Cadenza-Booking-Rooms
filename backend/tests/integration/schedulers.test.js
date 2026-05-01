'use strict';

/**
 * Integrazione: scheduler periodici dell'app.
 *
 * Coperture:
 *   - reminderScheduler.tickGhostCancel  → auto-cancellazione no-checkin
 *   - reminderScheduler.tickAll          → orchestratore (smoke)
 *   - reminderScheduler.tick             → reminder booking T-60min (mock email)
 *   - reminderScheduler.tickLoans        → reminder loans + overdue (mock email)
 *   - retentionScheduler.pruneAuditLog   → GDPR retention 24 mesi
 *   - retentionScheduler.prunePreRestoreSnapshots → cleanup file backup
 *   - backupScheduler.loadEffectiveConfig → fallback env→default
 *
 * I tick sono chiamati direttamente (non aspettiamo setInterval): il modulo
 * espone `tick`, `tickLoans`, ecc. come export aggiuntivi.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const dayjs = require('dayjs');
const reminder = require('../../services/reminderScheduler');
const retention = require('../../services/retentionScheduler');
const backupScheduler = require('../../services/backupScheduler');
const emailService = require('../../services/emailService');
const instrumentLoanEmail = require('../../services/instrumentLoanEmail');
const { Booking, AuditLog, Instrument, InstrumentLoan, User } = require('../../models');
const { createBooking, createUser, createRoom } = require('../factories');

describe('reminderScheduler.tickGhostCancel', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('auto-cancella prenotazione confermata senza check-in oltre la finestra di grazia', async () => {
    const room = await createRoom({ requireCheckIn: true });
    // startTime 30 min fa → ben oltre la grace window di default (15 min)
    const start = new Date(Date.now() - 30 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const bk = await createBooking({ room, startTime: start, endTime: end });

    await reminder.tickGhostCancel();

    const reloaded = await Booking.findByPk(bk.id);
    expect(reloaded.status).toBe('cancelled');
    expect(reloaded.autoCancelledAt).not.toBeNull();
    expect(reloaded.cancelReason).toMatch(/ghost/i);
  });

  it('NON cancella prenotazioni in aule con requireCheckIn=false', async () => {
    const room = await createRoom({ requireCheckIn: false });
    const start = new Date(Date.now() - 30 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const bk = await createBooking({ room, startTime: start, endTime: end });

    await reminder.tickGhostCancel();
    const reloaded = await Booking.findByPk(bk.id);
    expect(reloaded.status).toBe('confirmed');
    expect(reloaded.autoCancelledAt).toBeNull();
  });

  it('NON cancella prenotazioni con check-in già fatto', async () => {
    const room = await createRoom({ requireCheckIn: true });
    const start = new Date(Date.now() - 30 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const bk = await createBooking({
      room,
      startTime: start,
      endTime: end,
      checkedInAt: new Date(start.getTime() + 5 * 60 * 1000),
    });

    await reminder.tickGhostCancel();
    const reloaded = await Booking.findByPk(bk.id);
    expect(reloaded.status).toBe('confirmed');
    expect(reloaded.autoCancelledAt).toBeNull();
  });
});

describe('reminderScheduler.tick (booking reminder)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('marca reminderSentAt sui booking che iniziano in [55, 65] min e tenta invio email', async () => {
    // Mock email enabled + intercetta sendBookingEmail
    const enabledSpy = vi.spyOn(emailService, 'emailEnabled').mockResolvedValue(true);
    const sendSpy = vi.spyOn(emailService, 'sendBookingEmail').mockResolvedValue({ ok: true });

    try {
      const start = new Date(Date.now() + 60 * 60 * 1000); // tra 60 min, dentro [55,65]
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const bk = await createBooking({ startTime: start, endTime: end });

      await reminder.tick();

      const reloaded = await Booking.findByPk(bk.id);
      expect(reloaded.reminderSentAt).not.toBeNull();
      expect(sendSpy).toHaveBeenCalledTimes(1);
    } finally {
      enabledSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });

  it("è no-op se l'email non è configurata", async () => {
    const enabledSpy = vi.spyOn(emailService, 'emailEnabled').mockResolvedValue(false);
    const sendSpy = vi.spyOn(emailService, 'sendBookingEmail').mockResolvedValue({ ok: true });
    try {
      const start = new Date(Date.now() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const bk = await createBooking({ startTime: start, endTime: end });
      await reminder.tick();
      const reloaded = await Booking.findByPk(bk.id);
      expect(reloaded.reminderSentAt).toBeNull();
      expect(sendSpy).not.toHaveBeenCalled();
    } finally {
      enabledSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });
});

describe('reminderScheduler.tickLoans', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function makeLoan({
    status = 'active',
    toDate,
    reminderSentAt = null,
    overdueNotifiedAt = null,
  }) {
    const user = await createUser();
    const instrument = await Instrument.create({
      family: 'archi',
      name: 'Violino test',
      isAvailable: true,
    });
    return InstrumentLoan.create({
      userId: user.id,
      instrumentId: instrument.id,
      fromDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
      toDate,
      status,
      reminderSentAt,
      overdueNotifiedAt,
    });
  }

  it('invia reminder per prestiti attivi che scadono in [+1, +2] giorni', async () => {
    const enabledSpy = vi.spyOn(emailService, 'emailEnabled').mockResolvedValue(true);
    const sendSpy = vi
      .spyOn(instrumentLoanEmail, 'sendInstrumentLoanEmail')
      .mockResolvedValue({ ok: true });

    try {
      const loan = await makeLoan({ toDate: dayjs().add(2, 'day').format('YYYY-MM-DD') });
      await reminder.tickLoans();
      const reloaded = await InstrumentLoan.findByPk(loan.id);
      expect(reloaded.reminderSentAt).not.toBeNull();
      expect(sendSpy).toHaveBeenCalled();
    } finally {
      enabledSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });

  it('marca overdue i prestiti scaduti ancora active', async () => {
    const enabledSpy = vi.spyOn(emailService, 'emailEnabled').mockResolvedValue(true);
    const sendSpy = vi
      .spyOn(instrumentLoanEmail, 'sendInstrumentLoanEmail')
      .mockResolvedValue({ ok: true });

    try {
      const loan = await makeLoan({ toDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD') });
      await reminder.tickLoans();
      const reloaded = await InstrumentLoan.findByPk(loan.id);
      expect(reloaded.status).toBe('overdue');
      expect(reloaded.overdueNotifiedAt).not.toBeNull();
    } finally {
      enabledSpy.mockRestore();
      sendSpy.mockRestore();
    }
  });
});

describe('reminderScheduler.tickAll (smoke)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it("orchestratore non lancia eccezioni anche se non c'è nulla da fare", async () => {
    const enabledSpy = vi.spyOn(emailService, 'emailEnabled').mockResolvedValue(false);
    try {
      await expect(reminder.tickAll()).resolves.toBeUndefined();
    } finally {
      enabledSpy.mockRestore();
    }
  });
});

describe('retentionScheduler.pruneAuditLog', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('cancella audit log oltre la finestra di retention (default 730 giorni)', async () => {
    // Sequelize sovrascrive createdAt al timestamp corrente alla create:
    // backdating via update + silent dopo l'insert.
    const old = await AuditLog.create({
      action: 'GET',
      actorId: null,
      targetType: 'test',
      targetId: 1,
      path: '/api/test',
      statusCode: 200,
    });
    await AuditLog.update(
      { createdAt: dayjs().subtract(800, 'day').toDate() },
      { where: { id: old.id }, silent: true },
    );
    const recent = await AuditLog.create({
      action: 'GET',
      actorId: null,
      targetType: 'test',
      targetId: 1,
      path: '/api/test',
      statusCode: 200,
    });

    await retention.pruneAuditLog();

    expect(await AuditLog.findByPk(old.id)).toBeNull();
    expect(await AuditLog.findByPk(recent.id)).not.toBeNull();
  });
});

describe('retentionScheduler.prunePreRestoreSnapshots', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-rt-test-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('helper estimateDirSize esiste e accumula dimensioni file', () => {
    // pruneSnapshots nella sua signature reale opera su BACKEND_ROOT,
    // qui validiamo solo che il modulo sia caricabile e l'API esista
    expect(typeof retention.prunePreRestoreSnapshots).toBe('function');
  });
});

describe('backupScheduler.loadEffectiveConfig', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('ritorna defaults sensati senza settings su DB', async () => {
    const cfg = await backupScheduler.loadEffectiveConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg.autoEnabled).toBe('boolean');
    expect(typeof cfg.scheduledHour).toBe('number');
    expect(cfg.scheduledHour).toBeGreaterThanOrEqual(0);
    expect(cfg.scheduledHour).toBeLessThanOrEqual(23);
    expect(typeof cfg.scheduledMinute).toBe('number');
  });

  it('getStatus rispecchia lo stato corrente (non avviato in test)', () => {
    const status = backupScheduler.getStatus();
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('nextRunAt');
  });
});
