'use strict';

/**
 * Test del servizio importWorkflow senza HTTP: preview/apply chiamati
 * direttamente con (source, input, actor).
 */

const { User, IntegrationSyncRun } = require('../../models');
const importWorkflow = require('../../services/integrations/importWorkflow');
const profiles = require('../../services/integrations/profiles');
const { createAdmin, createUser } = require('../factories');

const csv = (rows) =>
  Buffer.from(
    ['Matricola,Cognome,Nome,Email,Ruolo', ...rows.map((r) => r.join(','))].join('\n') + '\n',
    'utf8',
  );

async function previewOf(admin, buffer, extra = {}) {
  return importWorkflow.preview(
    'isidata',
    { buffer, originalName: 'isidata.csv', mimetype: 'text/csv', ...extra },
    admin,
  );
}

const applyInput = (p, extra = {}) => ({ token: p.token, confirmedDiffHash: p.hash, ...extra });

async function expectDomainError(promise, code, status) {
  await expect(promise).rejects.toMatchObject({ code, status });
}

describe('importWorkflow service', () => {
  let admin;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    ({ user: admin } = await createAdmin());
  });
  afterEach(() => vi.restoreAllMocks());

  describe('preview', () => {
    it('senza file → FILE_REQUIRED', async () => {
      await expectDomainError(importWorkflow.preview('isidata', {}, admin), 'FILE_REQUIRED', 400);
    });

    it('overrides non JSON → VALIDATION_FAILED', async () => {
      await expectDomainError(
        previewOf(admin, csv([['1', 'R', 'M', 'm@x.test', 'studente']]), {
          mappingOverrides: '{not json',
        }),
        'VALIDATION_FAILED',
        400,
      );
    });

    it('restituisce token con prefisso admin e hash sha256, senza toccare il DB', async () => {
      const p = await previewOf(admin, csv([['1', 'Rossi', 'Mario', 'm@x.test', 'studente']]));
      expect(p.token.split('-')[0]).toBe(String(admin.id));
      expect(p.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(p.summary.toCreate).toBe(1);
      expect(await User.count({ where: { matricola: '1' } })).toBe(0);
    });
  });

  describe('apply: validazione token/hash', () => {
    let p;
    beforeEach(async () => {
      p = await previewOf(admin, csv([['1', 'Rossi', 'Mario', 'm@x.test', 'studente']]));
    });

    it('campi mancanti → VALIDATION_FAILED', async () => {
      await expectDomainError(
        importWorkflow.apply('isidata', { token: p.token }, admin),
        'VALIDATION_FAILED',
        400,
      );
    });

    it('token malformato (path traversal) → TOKEN_INVALID', async () => {
      await expectDomainError(
        importWorkflow.apply(
          'isidata',
          { token: '../../etc/passwd', confirmedDiffHash: p.hash },
          admin,
        ),
        'TOKEN_INVALID',
        400,
      );
    });

    it('hash non esadecimale → VALIDATION_FAILED', async () => {
      await expectDomainError(
        importWorkflow.apply('isidata', { token: p.token, confirmedDiffHash: 'zz' }, admin),
        'VALIDATION_FAILED',
        400,
      );
    });

    it('token di un altro admin → TOKEN_FOREIGN (403)', async () => {
      const { user: other } = await createAdmin();
      await expectDomainError(
        importWorkflow.apply('isidata', applyInput(p), other),
        'TOKEN_FOREIGN',
        403,
      );
    });

    it('token ben formato ma inesistente → TOKEN_EXPIRED (410)', async () => {
      const token = `${admin.id}-${Date.now()}-${'a'.repeat(16)}.csv`;
      await expectDomainError(
        importWorkflow.apply('isidata', { token, confirmedDiffHash: p.hash }, admin),
        'TOKEN_EXPIRED',
        410,
      );
    });

    it('hash diverso → HASH_MISMATCH (409) e nessun run creato', async () => {
      await expectDomainError(
        importWorkflow.apply(
          'isidata',
          { token: p.token, confirmedDiffHash: 'f'.repeat(64) },
          admin,
        ),
        'HASH_MISMATCH',
        409,
      );
      expect(await IntegrationSyncRun.count()).toBe(0);
    });
  });

  describe('apply: warning critici', () => {
    async function seedProviderUsers(n) {
      for (let i = 0; i < n; i++) {
        await createUser({
          email: `old${i}@x.test`,
          role: 'studente',
          matricola: `O${i}`,
          externalSource: 'isidata',
          externalId: `O${i}`,
        });
      }
    }

    it('disattivazione di massa senza conferma → CRITICAL_WARNINGS_PRESENT, nessuna modifica', async () => {
      await seedProviderUsers(5);
      const p = await previewOf(admin, csv([['N1', 'Rossi', 'Mario', 'n1@x.test', 'studente']]));
      await expect(importWorkflow.apply('isidata', applyInput(p), admin)).rejects.toMatchObject({
        code: 'CRITICAL_WARNINGS_PRESENT',
        status: 409,
        extra: { criticalCodes: expect.any(Array) },
      });
      expect(await User.count({ where: { isActive: false, externalSource: 'isidata' } })).toBe(0);
      expect(await User.count({ where: { matricola: 'N1' } })).toBe(0);
      expect(await IntegrationSyncRun.count()).toBe(0);
    });

    it('con confirmCriticalWarnings=true procede e disattiva gli orfani', async () => {
      await seedProviderUsers(5);
      const p = await previewOf(admin, csv([['N1', 'Rossi', 'Mario', 'n1@x.test', 'studente']]));
      const out = await importWorkflow.apply(
        'isidata',
        applyInput(p, { confirmCriticalWarnings: true }),
        admin,
      );
      expect(out.status).toBe('success');
      expect(out.summary).toMatchObject({ created: 1, orphaned: 5 });
      expect(await User.count({ where: { isActive: false, externalSource: 'isidata' } })).toBe(5);
    });
  });

  describe('apply: creazione e aggiornamento', () => {
    it('crea e aggiorna utenti, registra il run e consuma il token', async () => {
      const existing = await createUser({
        email: 'mario@x.test',
        firstName: 'Mario',
        lastName: 'Vecchio',
        role: 'studente',
        matricola: 'A1',
        externalSource: 'isidata',
        externalId: 'A1',
      });
      const p = await previewOf(
        admin,
        csv([
          ['A1', 'Nuovo', 'Mario', 'mario@x.test', 'studente'],
          ['A2', 'Bianchi', 'Anna', 'anna@x.test', 'studente'],
        ]),
      );
      const out = await importWorkflow.apply('isidata', applyInput(p), admin);

      expect(out.status).toBe('success');
      expect(out.summary).toMatchObject({ fetched: 2, created: 1, updated: 1, orphaned: 0 });
      expect(out.createdUserIds).toHaveLength(1);

      expect((await User.findByPk(existing.id)).lastName).toBe('Nuovo');
      const created = await User.findByPk(out.createdUserIds[0]);
      expect(created).toMatchObject({
        matricola: 'A2',
        status: 'pending',
        externalSource: 'isidata',
      });

      const run = await IntegrationSyncRun.findByPk(out.runId);
      expect(run).toMatchObject({ status: 'success', created: 1, updated: 1, actorId: admin.id });

      // File temporaneo eliminato: secondo apply → TOKEN_EXPIRED.
      await expectDomainError(
        importWorkflow.apply('isidata', applyInput(p), admin),
        'TOKEN_EXPIRED',
        410,
      );
    });

    it('errore su un record → status partial, gli altri record restano', async () => {
      const p = await previewOf(
        admin,
        csv([
          ['B1', 'Rossi', 'Mario', 'b1@x.test', 'studente'],
          ['B2', 'Verdi', 'Luca', 'b2@x.test', 'studente'],
        ]),
      );
      const realCreate = User.create.bind(User);
      vi.spyOn(User, 'create').mockImplementation((data, opts) => {
        if (data.matricola === 'B2') return Promise.reject(new Error('boom'));
        return realCreate(data, opts);
      });
      const out = await importWorkflow.apply('isidata', applyInput(p), admin);
      expect(out.status).toBe('partial');
      expect(out.summary).toMatchObject({ created: 1, errors: 1 });
      expect(await User.count({ where: { matricola: 'B1' } })).toBe(1);
      expect(await User.count({ where: { matricola: 'B2' } })).toBe(0);
    });
  });

  describe('apply: atomicità', () => {
    it('errore fatale a metà transazione → rollback di create/update, run failed', async () => {
      const existing = await createUser({
        email: 'mario@x.test',
        firstName: 'Mario',
        lastName: 'Vecchio',
        role: 'studente',
        matricola: 'A1',
        externalSource: 'isidata',
        externalId: 'A1',
      });
      const p = await previewOf(
        admin,
        csv([
          ['A1', 'Nuovo', 'Mario', 'mario@x.test', 'studente'],
          ['A2', 'Bianchi', 'Anna', 'anna@x.test', 'studente'],
        ]),
      );
      // getProfile è invocato dopo create e update, prima degli orphan.
      vi.spyOn(profiles, 'getProfile').mockImplementation(() => {
        throw new Error('fatal');
      });

      await expect(importWorkflow.apply('isidata', applyInput(p), admin)).rejects.toThrow('fatal');

      expect(await User.count({ where: { matricola: 'A2' } })).toBe(0);
      expect((await User.findByPk(existing.id)).lastName).toBe('Vecchio');
      const run = await IntegrationSyncRun.findOne();
      expect(run.status).toBe('failed');
      expect(run.errorPayload[0]).toMatchObject({ kind: 'fatal', msg: 'fatal' });
    });
  });
});
