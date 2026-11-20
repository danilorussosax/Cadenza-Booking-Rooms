'use strict';

/**
 * Fotografia di default / massimo / clamp dei parametri limit/page/pageSize
 * degli endpoint che li parsano tramite lib/pagination.js. Le forme di
 * risposta non cambiano: qui si verifica solo quanto viene applicato.
 *
 * Differenza voluta rispetto a prima: i decimali sono floorati
 * (?limit=2.7 → 2) invece di passare come numeri non interi.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createAuthedUser } = require('../factories');
const { Announcement, IntegrationSyncRun, AuditLog } = require('../../models');
const slowQueryRecorder = require('../../lib/slowQueryRecorder');

const app = buildApp({ serveFrontend: false });

describe('limit/page parsing sugli endpoint', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    slowQueryRecorder.clear();
  });

  describe('ops /slow-queries (default 50, max 500)', () => {
    it.each([
      ['', 50],
      ['?limit=abc', 50],
      ['?limit=0', 50],
      ['?limit=-5', 1],
      ['?limit=2.7', 2],
      ['?limit=999999', 500],
    ])('%s → %i item', async (qs, expected) => {
      for (let i = 0; i < 520; i++) {
        slowQueryRecorder.record({ sql: `SELECT ${i}`, durationMs: 800 });
      }
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/admin/ops/slow-queries${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(expected);
    });
  });

  describe('ops /slow-queries/aggregate (default 20, max 100)', () => {
    it.each([
      ['', 20],
      ['&limit=abc', 20],
      ['&limit=-5', 1],
      ['&limit=999999', 100],
    ])('%s → %i gruppi', async (qs, expected) => {
      for (let i = 0; i < 150; i++) {
        slowQueryRecorder.record({
          sql: `SELECT * FROM t_${String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26))}`,
          durationMs: 800,
        });
      }
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/admin/ops/slow-queries/aggregate?by=pattern${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.aggregate).toHaveLength(expected);
    });
  });

  describe('announcements (default 50, max 100)', () => {
    it.each([
      ['', 50],
      ['?limit=abc', 50],
      ['?limit=0', 50],
      ['?limit=-5', 1],
      ['?limit=2.7', 2],
      ['?limit=999999', 100],
    ])('%s → %i annunci', async (qs, expected) => {
      const now = new Date(Date.now() - 1000);
      await Announcement.bulkCreate(
        Array.from({ length: 120 }, (_, i) => ({
          title: `A${i}`,
          body: 'x',
          publishedAt: now,
          audience: { kind: 'all' },
          isPinned: false,
          isActive: true,
        })),
      );
      const { authHeader } = await createAuthedUser({ role: 'studente' });
      const res = await request(app)
        .get(`/api/announcements${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.announcements).toHaveLength(expected);
    });
  });

  describe('integrations /runs (default 50, max 200)', () => {
    it.each([
      ['', 50],
      ['?limit=abc', 50],
      ['?limit=0', 50],
      ['?limit=-5', 1],
      ['?limit=2.7', 2],
      ['?limit=999999', 200],
    ])('%s → %i run', async (qs, expected) => {
      await IntegrationSyncRun.bulkCreate(
        Array.from({ length: 230 }, () => ({ provider: 'isidata', status: 'success' })),
      );
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/admin/integrations/runs${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.runs).toHaveLength(expected);
    });
  });

  describe('audit-log (page, pageSize default 50, max 200; verify-integrity)', () => {
    beforeEach(async () => {
      for (let i = 0; i < 210; i++) {
        await AuditLog.create({
          actorId: null,
          action: 'POST',
          targetType: 'test',
          targetId: i + 1,
          path: `/api/test/${i}`,
          statusCode: 200,
        });
      }
    });

    it.each([
      ['', 50, 1],
      ['?pageSize=abc', 50, 1],
      ['?pageSize=0', 50, 1],
      ['?pageSize=-5', 1, 1],
      ['?pageSize=999999', 200, 1],
      ['?pageSize=10&page=0', 10, 1],
      ['?pageSize=10&page=-3', 10, 1],
      ['?pageSize=10&page=abc', 10, 1],
      ['?pageSize=10&page=2', 10, 2],
      ['?pageSize=10&page=2.9', 10, 2],
    ])('%s → pageSize %i page %i', async (qs, pageSize, page) => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/admin/audit-log${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(pageSize);
      expect(res.body.page).toBe(page);
      expect(res.body.entries).toHaveLength(pageSize);
    });

    it.each([
      ['', 210],
      ['?limit=abc', 210],
      ['?limit=5', 5],
      ['?limit=-5', 1],
      ['?limit=2.7', 2],
      ['?limit=999999', 210],
    ])('verify-integrity %s → scanned %i', async (qs, scanned) => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get(`/api/admin/audit-log/verify-integrity${qs}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.scanned).toBe(scanned);
    });
  });
});
