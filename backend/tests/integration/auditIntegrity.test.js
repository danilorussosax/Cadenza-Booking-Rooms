'use strict';

/**
 * Integrazione: hash-chain di integrità di AuditLog.
 *
 * Verifica che:
 *  - ogni AuditLog.create() popoli rowHash + prevHash;
 *  - il prevHash punti correttamente al rowHash della riga precedente;
 *  - verifyAuditIntegrity ritorni ok=true su catena pulita;
 *  - tampering rilevato: una UPDATE diretta sui campi audit invalida la
 *    catena (hash_mismatch);
 *  - cancellazione rilevata: DELETE di una riga "in mezzo" rompe il link
 *    della successiva (chain_gap).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { AuditLog } = require('../../models');
const { flushPendingAuditWrites } = require('../../middleware/audit');
const { verifyAuditIntegrity } = require('../../services/auditIntegrity');
const { createAdmin } = require('../factories');

const app = buildApp({ serveFrontend: false });

async function seedAuditEntries(count = 3) {
  // Creiamo audit "via API" usando un endpoint audit-coperto, così
  // esercitiamo anche il middleware (ipotesi end-to-end).
  const { authHeader } = await createAdmin();
  for (let i = 0; i < count; i++) {
    const res = await request(app)
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send({ code: `HASH${i}`, name: `HashTest${i}` });
    expect(res.status).toBe(201);
  }
  // Attendi che l'audit middleware completi le write asincrone (il hook
  // beforeCreate hash-chain aggiunge una findOne, quindi il timing non è
  // più ~istantaneo come in SQLite pre-v1.11).
  await flushPendingAuditWrites();
}

describe('AuditLog hash-chain', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('popola rowHash e prevHash su ogni AuditLog.create', async () => {
    await seedAuditEntries(3);
    const rows = await AuditLog.findAll({
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);

    for (const row of rows) {
      expect(row.rowHash).toMatch(/^[a-f0-9]{64}$/);
    }
    // La prima riga non ha precedente.
    expect(rows[0].prevHash).toBeNull();
    // Le successive hanno prevHash = rowHash della precedente.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].prevHash).toBe(rows[i - 1].rowHash);
    }
  });

  it('verifyAuditIntegrity ritorna ok=true su catena pulita', async () => {
    await seedAuditEntries(3);
    const result = await verifyAuditIntegrity({ AuditLog });
    expect(result.ok).toBe(true);
    expect(result.tamperingCount).toBe(0);
  });

  it('rileva hash_mismatch se i campi vengono manomessi', async () => {
    await seedAuditEntries(3);
    const target = await AuditLog.findOne({ order: [['createdAt', 'ASC']] });
    // Bypass dei hook: UPDATE diretto via queryInterface — simula una
    // manipolazione DB out-of-band.
    await AuditLog.sequelize.query('UPDATE audit_log SET payload = :p WHERE id = :id', {
      replacements: { p: JSON.stringify({ tampered: true }), id: target.id },
    });

    const result = await verifyAuditIntegrity({ AuditLog });
    expect(result.ok).toBe(false);
    expect(result.tamperingCount).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.type === 'hash_mismatch' && i.id === target.id)).toBe(true);
  });

  it('rileva chain_gap se una riga viene cancellata in mezzo', async () => {
    await seedAuditEntries(3);
    const rows = await AuditLog.findAll({
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    // Cancelliamo la riga di mezzo: la successiva avrà ora un prevHash
    // che non punta più al suo predecessore effettivo.
    const middle = rows[Math.floor(rows.length / 2)];
    await AuditLog.sequelize.query('DELETE FROM audit_log WHERE id = :id', {
      replacements: { id: middle.id },
    });

    const result = await verifyAuditIntegrity({ AuditLog });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.type === 'chain_gap')).toBe(true);
  });

  it('GET /api/admin/audit-log/verify-integrity (admin) ritorna lo stato', async () => {
    const { authHeader } = await createAdmin();
    await seedAuditEntries(2);

    const res = await request(app)
      .get('/api/admin/audit-log/verify-integrity')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.scanned).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('verify-integrity richiede ruolo admin', async () => {
    const { authHeader } = await createAdmin(); // baseline ok
    expect(authHeader).toBeTruthy();

    // Studente: 403 (testato globalmente via RBAC, qui smoke specifico).
    const { createAuthedUser } = require('../factories');
    const student = await createAuthedUser({ role: 'studente' });

    const res = await request(app)
      .get('/api/admin/audit-log/verify-integrity')
      .set('Authorization', student.authHeader);
    expect(res.status).toBe(403);
  });
});
