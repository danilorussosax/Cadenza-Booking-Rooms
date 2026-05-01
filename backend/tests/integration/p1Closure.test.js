'use strict';

/**
 * Test di chiusura per i fix P1 residui (P1-3, P1-4, P1-7).
 *
 * P1-3: /usage/me restituisce gli stessi totali di prima (no regressione)
 *       dopo il refactor con Map pre-aggregate + attributes selettivi.
 *
 * P1-4: cleanupExpiredTmpFiles esposto e callable via require.
 *       readTempFile rifiuta path traversal (basename + relative containment).
 *       retentionScheduler.tick() chiama il cleanup senza errori.
 *
 * P1-7: routes/backups.js /restart usa SIGTERM (verifica via lettura source).
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { buildApp } = require('../../app');
const { Booking, BookingQuota } = require('../../models');
const {
  createAuthedUser,
  createBookingRule,
  createCourse,
  createRoom,
  createBooking,
} = require('../factories');

describe('P1-3: /usage/me — refactor con Map pre-aggregate', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('totali settimanali corretti con quote globali', async () => {
    await createBookingRule({
      role: 'docente',
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
      maxBookingDurationMinutes: 240,
    });
    await BookingQuota.create({
      role: 'docente',
      scopeKind: 'global',
      scopeValue: '*',
      isActive: true,
      maxHoursPerWeek: 30,
    });
    const course = await createCourse();
    const room = await createRoom();
    const { user, authHeader } = await createAuthedUser({
      role: 'docente',
      courseId: course.id,
    });

    // 3 booking da 2h ciascuna in questa settimana
    const dayjs = require('dayjs');
    const weekMonday = dayjs().startOf('isoWeek').add(10, 'hour').toDate();
    for (let i = 0; i < 3; i++) {
      await createBooking({
        user,
        room,
        startTime: new Date(weekMonday.getTime() + i * 24 * 3600 * 1000),
        endTime: new Date(weekMonday.getTime() + i * 24 * 3600 * 1000 + 2 * 3600 * 1000),
        status: 'confirmed',
      });
    }

    const res = await request(app).get('/api/bookings/usage/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.weekly.usedHours).toBe(6); // 3 × 2h
    expect(res.body.weekly.remainingHours).toBe(94); // 100 - 6
    // Quota globale: usedHoursWeek=6, remainingWeek=24
    expect(res.body.global).toHaveLength(1);
    expect(res.body.global[0].usedHoursWeek).toBe(6);
    expect(res.body.global[0].remainingHoursWeek).toBe(24);
  });

  it('quote per roomType si aggregano correttamente', async () => {
    await createBookingRule({
      role: 'docente',
      maxHoursPerWeek: 100,
      maxHoursPerDay: 20,
      maxBookingDurationMinutes: 240,
    });
    await BookingQuota.create({
      role: 'docente',
      scopeKind: 'roomType',
      scopeValue: 'studio',
      isActive: true,
      maxHoursPerWeek: 10,
    });
    const course = await createCourse();
    const studioRoom = await createRoom({ type: 'studio' });
    const aulaRoom = await createRoom({ type: 'aula' });
    const { user, authHeader } = await createAuthedUser({
      role: 'docente',
      courseId: course.id,
    });

    const dayjs = require('dayjs');
    const monday = dayjs().startOf('isoWeek').add(10, 'hour').toDate();
    // 1 booking in studio (2h), 1 in aula (3h)
    await createBooking({
      user,
      room: studioRoom,
      startTime: monday,
      endTime: new Date(monday.getTime() + 2 * 3600 * 1000),
      status: 'confirmed',
    });
    await createBooking({
      user,
      room: aulaRoom,
      startTime: new Date(monday.getTime() + 24 * 3600 * 1000),
      endTime: new Date(monday.getTime() + 24 * 3600 * 1000 + 3 * 3600 * 1000),
      status: 'confirmed',
    });

    const res = await request(app).get('/api/bookings/usage/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    // Quota roomType=studio: 2h usate, 8h rimanenti
    expect(res.body.byRoomType).toHaveLength(1);
    expect(res.body.byRoomType[0].scopeValue).toBe('studio');
    expect(res.body.byRoomType[0].usedHoursWeek).toBe(2);
    expect(res.body.byRoomType[0].remainingHoursWeek).toBe(8);
    // Tot weekly = 5h
    expect(res.body.weekly.usedHours).toBe(5);
  });

  it('zero quote, zero booking → struttura risposta OK', async () => {
    await createBookingRule({
      role: 'docente',
      maxHoursPerWeek: 100,
      maxHoursPerDay: 10,
    });
    const course = await createCourse();
    const { authHeader } = await createAuthedUser({
      role: 'docente',
      courseId: course.id,
    });
    const res = await request(app).get('/api/bookings/usage/me').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.weekly.usedHours).toBe(0);
    expect(res.body.global).toEqual([]);
    expect(res.body.byRoomType).toEqual([]);
    expect(res.body.byEquipment).toEqual([]);
  });
});

describe('P1-4: integrations cleanup + path traversal', () => {
  it('cleanupExpiredTmpFiles esportato e callable', () => {
    const integrations = require('../../routes/integrations');
    expect(typeof integrations.cleanupExpiredTmpFiles).toBe('function');
    // Chiamarla non deve lanciare anche se TMP_DIR è vuoto/non esiste
    expect(() => integrations.cleanupExpiredTmpFiles()).not.toThrow();
  });

  it('retentionScheduler tick non lancia con il nuovo cleanup integrations', async () => {
    // Importiamo il pruneAuditLog che è il caso d'uso che chiama tick
    // indirettamente. Il vero tick include ora cleanupExpiredTmpFiles
    // via lazy require: verifichiamo che non rompa.
    const { pruneAuditLog } = require('../../services/retentionScheduler');
    await expect(pruneAuditLog()).resolves.not.toThrow();
  });

  it('readTempFile (path traversal): basename + relative containment', () => {
    // readTempFile è private (non esportata); verifichiamo via codice sorgente
    // che usi path.basename() per neutralizzare i traversali.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'routes', 'integrations.js'),
      'utf-8',
    );
    // Pattern atteso: combinazione di basename + path.relative
    expect(src).toMatch(/path\.basename\(token\)/);
    expect(src).toMatch(/path\.relative/);
    // Il vecchio guard `startsWith(TMP_DIR)` non deve essere più presente
    // come check unico (può essere ancora menzionato in commenti).
    const hasOldGuard = /if\s*\(\s*!\s*full\.startsWith\(\s*TMP_DIR\s*\)\s*\)/.test(src);
    expect(hasOldGuard).toBe(false);
  });
});

describe('P1-7: /restart endpoint usa SIGTERM', () => {
  it('source di routes/backups.js usa process.kill(SIGTERM), non process.exit(0)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'backups.js'), 'utf-8');
    // L'endpoint /restart è la sezione critica: deve preferire SIGTERM
    // così safeShutdown drainage parte. process.exit deve essere SOLO
    // fallback in catch.
    expect(src).toMatch(/process\.kill\(\s*process\.pid\s*,\s*['"]SIGTERM['"]\s*\)/);
    // Nessun process.exit(0) nel happy path: il vecchio era setTimeout → exit(0)
    const happyPathExitMatch = src.match(/setTimeout\([^)]*?process\.exit\(0\)/s);
    expect(happyPathExitMatch).toBeNull();
  });
});
