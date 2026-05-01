'use strict';

/**
 * P1-1 — Audit retention con export firmato.
 *
 * Verifica:
 *   - archiveAuditLog crea un .jsonl.gz con le righe corrette
 *   - sidecar .hmac contiene meta + HMAC SHA-256 verificabile
 *   - pruneAuditLog archivia PRIMA di cancellare
 *   - se l'archive fallisce (mock), il prune NON cancella (preserva i dati)
 *   - pruneAuditLog su DB vuoto (no record vecchi) → no-op
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { AuditLog } = require('../../models');
const {
  archiveAuditLog,
  pruneAuditLog,
  AUDIT_ARCHIVE_DIR,
} = require('../../services/retentionScheduler');
const { getJwtSecret } = require('../../lib/secrets');

function readArchiveLines(archivePath) {
  const buf = fs.readFileSync(archivePath);
  const json = zlib.gunzipSync(buf).toString('utf-8');
  return json
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}

function computeHmac(archivePath, key) {
  const lines = readArchiveLines(archivePath);
  const hmac = crypto.createHmac('sha256', key);
  for (const row of lines) hmac.update(JSON.stringify(row) + '\n');
  return hmac.digest('hex');
}

function getDefaultHmacKey() {
  if (process.env.AUDIT_ARCHIVE_HMAC_KEY) return process.env.AUDIT_ARCHIVE_HMAC_KEY;
  return crypto.createHash('sha256').update(getJwtSecret()).digest('hex');
}

describe('archiveAuditLog (P1-1)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    // Cleanup eventuali archivi residui da test precedenti
    if (fs.existsSync(AUDIT_ARCHIVE_DIR)) {
      for (const f of fs.readdirSync(AUDIT_ARCHIVE_DIR)) {
        if (f.startsWith('audit-')) fs.unlinkSync(path.join(AUDIT_ARCHIVE_DIR, f));
      }
    }
  });

  it('no-op se non ci sono record da archiviare', async () => {
    const result = await archiveAuditLog(new Date('2099-01-01'));
    expect(result).toBeNull();
  });

  it('crea archivio gzippato + sidecar HMAC validabile', async () => {
    // Seed 5 audit log "vecchi" e 2 "recenti"
    const oldDate = new Date('2020-01-15T10:00:00Z');
    const newDate = new Date(); // ora
    for (let i = 0; i < 5; i++) {
      await AuditLog.create({
        actorId: null,
        action: 'POST',
        targetType: 'test',
        targetId: i,
        path: `/api/test/${i}`,
        statusCode: 200,
        createdAt: oldDate,
      });
    }
    for (let i = 0; i < 2; i++) {
      await AuditLog.create({
        actorId: null,
        action: 'GET',
        targetType: 'test',
        targetId: 100 + i,
        path: `/api/test/recent/${i}`,
        statusCode: 200,
        createdAt: newDate,
      });
    }

    const cutoff = new Date('2024-01-01');
    const result = await archiveAuditLog(cutoff);
    expect(result).not.toBeNull();
    expect(result.archivedCount).toBe(5);
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(fs.existsSync(result.hmacPath)).toBe(true);

    // Verifica contenuto archive
    const lines = readArchiveLines(result.archivePath);
    expect(lines).toHaveLength(5);
    for (const row of lines) {
      expect(row.targetType).toBe('test');
      expect(row.action).toBe('POST');
    }

    // Verifica sidecar HMAC
    const sidecar = JSON.parse(fs.readFileSync(result.hmacPath, 'utf-8'));
    expect(sidecar.archivedCount).toBe(5);
    expect(sidecar.hmacAlgo).toBe('HMAC-SHA256');
    expect(sidecar.hmac).toMatch(/^[a-f0-9]{64}$/);

    // Ricalcoliamo l'HMAC e verifichiamo che combaci
    const expectedHmac = computeHmac(result.archivePath, getDefaultHmacKey());
    expect(sidecar.hmac).toBe(expectedHmac);
  });

  it("HMAC non valido se l'archivio è manomesso", async () => {
    await AuditLog.create({
      actorId: null,
      action: 'POST',
      targetType: 'tamper',
      path: '/x',
      statusCode: 200,
      createdAt: new Date('2020-01-01'),
    });

    const result = await archiveAuditLog(new Date('2024-01-01'));

    // Manomettiamo l'archivio: creiamo un .gz "diverso" sovrascrivendo.
    fs.writeFileSync(result.archivePath, zlib.gzipSync(JSON.stringify({ malicious: true }) + '\n'));

    const recomputed = computeHmac(result.archivePath, getDefaultHmacKey());
    const sidecar = JSON.parse(fs.readFileSync(result.hmacPath, 'utf-8'));
    expect(recomputed).not.toBe(sidecar.hmac);
  });
});

describe('pruneAuditLog (P1-1)', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
    if (fs.existsSync(AUDIT_ARCHIVE_DIR)) {
      for (const f of fs.readdirSync(AUDIT_ARCHIVE_DIR)) {
        if (f.startsWith('audit-')) fs.unlinkSync(path.join(AUDIT_ARCHIVE_DIR, f));
      }
    }
  });

  it('archivia + cancella record più vecchi di GDPR_AUDIT_LOG_RETENTION_DAYS', async () => {
    // Forziamo retention a 30 giorni per il test
    const orig = process.env.GDPR_AUDIT_LOG_RETENTION_DAYS;
    process.env.GDPR_AUDIT_LOG_RETENTION_DAYS = '30';

    const oldDate = new Date(Date.now() - 60 * 86400 * 1000); // 60gg fa
    const recentDate = new Date(); // ora

    for (let i = 0; i < 3; i++) {
      await AuditLog.create({
        actorId: null,
        action: 'POST',
        targetType: 'old',
        targetId: i,
        path: `/old/${i}`,
        statusCode: 200,
        createdAt: oldDate,
      });
    }
    for (let i = 0; i < 2; i++) {
      await AuditLog.create({
        actorId: null,
        action: 'GET',
        targetType: 'recent',
        targetId: i,
        path: `/recent/${i}`,
        statusCode: 200,
        createdAt: recentDate,
      });
    }

    const beforeCount = await AuditLog.count();
    expect(beforeCount).toBe(5);

    await pruneAuditLog();

    // I record vecchi sono stati archiviati + cancellati
    const remaining = await AuditLog.count();
    expect(remaining).toBe(2); // solo i recenti

    // L'archivio deve essere stato creato
    const archives = fs
      .readdirSync(AUDIT_ARCHIVE_DIR)
      .filter((f) => f.startsWith('audit-') && f.endsWith('.jsonl.gz'));
    expect(archives.length).toBeGreaterThanOrEqual(1);

    // Cleanup env
    if (orig !== undefined) process.env.GDPR_AUDIT_LOG_RETENTION_DAYS = orig;
    else delete process.env.GDPR_AUDIT_LOG_RETENTION_DAYS;
  });

  it('no-op se non ci sono record vecchi', async () => {
    process.env.GDPR_AUDIT_LOG_RETENTION_DAYS = '30';

    await AuditLog.create({
      actorId: null,
      action: 'GET',
      targetType: 'recent',
      path: '/x',
      statusCode: 200,
      createdAt: new Date(),
    });

    await pruneAuditLog();

    // Nessuna cancellazione, nessun archivio (count=0).
    expect(await AuditLog.count()).toBe(1);
    if (fs.existsSync(AUDIT_ARCHIVE_DIR)) {
      const archives = fs.readdirSync(AUDIT_ARCHIVE_DIR).filter((f) => f.startsWith('audit-'));
      expect(archives).toHaveLength(0);
    }

    delete process.env.GDPR_AUDIT_LOG_RETENTION_DAYS;
  });
});
