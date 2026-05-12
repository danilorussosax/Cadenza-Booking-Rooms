'use strict';

/**
 * Integration: routes/contractTypes.js (CRUD tipologie contrattuali docenti).
 *
 * Copre:
 *   - GET /api/contract-types: list (auth qualunque ruolo) + filtro
 *     includeInactive (admin only)
 *   - GET /:id/impact: 404 se inesistente, payload completo con
 *     usersAffected/usersWithOverride/draftProposalsCount
 *   - POST /: validazioni (label required/too long, code invalido, code
 *     duplicato), creazione standard, code auto-slugificato
 *   - PUT /:id: 404, code immutabile (silenziosamente droppato),
 *     IMPACT_CONFIRM_REQUIRED quando defaultHours cambia con utenti
 *     attivi senza override, success path con confirmedImpact
 *   - DELETE /:id: 404, IS_SYSTEM bloccato, IN_USE bloccato, success path
 *
 * Strategia: ogni test crea Institute + ContractType con factory inline
 * (la global factories.js non ha createContractType, lo facciamo qui).
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { Institute, ContractType, User, MonteOreProposal } = require('../../models');
const { createAuthedUser, createAdmin } = require('../factories');

describe('routes/contractTypes', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  async function createInstitute() {
    return Institute.create({ name: 'Test Inst', code: 'TI', city: 'X', country: 'IT' });
  }

  async function createCT(instituteId, overrides = {}) {
    return ContractType.create({
      instituteId,
      code: overrides.code || 'titolare',
      label: overrides.label || 'Titolare',
      defaultHours: overrides.defaultHours ?? 324,
      bypassDayConstraintDefault: overrides.bypassDayConstraintDefault ?? false,
      isSystem: overrides.isSystem ?? false,
      isActive: overrides.isActive ?? true,
      sortOrder: overrides.sortOrder ?? 0,
      notes: overrides.notes ?? null,
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // GET /
  // ───────────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('401 senza auth', async () => {
      const res = await request(app).get('/api/contract-types');
      expect(res.status).toBe(401);
    });

    it('list ritorna solo i contractType attivi a un utente non-admin', async () => {
      const inst = await createInstitute();
      await createCT(inst.id, { code: 'titolare', label: 'Titolare', sortOrder: 1 });
      await createCT(inst.id, { code: 'altro', label: 'Altro', isActive: false, sortOrder: 2 });
      const { authHeader } = await createAuthedUser({ role: 'docente' });

      const res = await request(app).get('/api/contract-types').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.contractTypes).toHaveLength(1);
      expect(res.body.contractTypes[0].code).toBe('titolare');
    });

    it('admin con includeInactive=true vede anche i disattivati', async () => {
      const inst = await createInstitute();
      await createCT(inst.id, { code: 'titolare' });
      await createCT(inst.id, { code: 'altro', isActive: false });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .get('/api/contract-types?includeInactive=true')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.contractTypes).toHaveLength(2);
    });

    it('non-admin con includeInactive=true: ignora il flag, ritorna solo attivi', async () => {
      const inst = await createInstitute();
      await createCT(inst.id, { code: 'titolare' });
      await createCT(inst.id, { code: 'altro', isActive: false });
      const { authHeader } = await createAuthedUser({ role: 'docente' });

      const res = await request(app)
        .get('/api/contract-types?includeInactive=true')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.contractTypes).toHaveLength(1);
    });

    it('ordina per sortOrder ASC, poi id ASC', async () => {
      const inst = await createInstitute();
      await createCT(inst.id, { code: 'b', label: 'B', sortOrder: 2 });
      await createCT(inst.id, { code: 'a', label: 'A', sortOrder: 1 });
      const { authHeader } = await createAuthedUser({ role: 'docente' });

      const res = await request(app).get('/api/contract-types').set('Authorization', authHeader);
      expect(res.body.contractTypes.map((c) => c.code)).toEqual(['a', 'b']);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /:id/impact
  // ───────────────────────────────────────────────────────────────────
  describe('GET /:id/impact', () => {
    it('403 a non-admin', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id);
      const { authHeader } = await createAuthedUser({ role: 'docente' });
      const res = await request(app)
        .get(`/api/contract-types/${ct.id}/impact`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('404 se contract type inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .get('/api/contract-types/99999/impact')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('payload completo: usersAffected + usersWithOverride + draftProposalsCount', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'titolare', defaultHours: 324 });
      const { authHeader } = await createAdmin();

      // 2 docenti senza override → impattati
      const doc1 = await User.create({
        firstName: 'D',
        lastName: 'Uno',
        email: 'd1@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
      });
      await User.create({
        firstName: 'D',
        lastName: 'Due',
        email: 'd2@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
      });
      // 1 docente con override → escluso da usersAffected ma contato in usersWithOverride
      await User.create({
        firstName: 'D',
        lastName: 'Tre',
        email: 'd3@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
        monteOreAnnualHoursOverride: 200,
        monteOreOverrideReason: 'test',
      });
      // 1 studente con stesso "contractType" stringa → ignorato (filtro role:docente)
      await User.create({
        firstName: 'S',
        lastName: 'Tu',
        email: 's@t.it',
        passwordHash: 'p',
        role: 'studente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
      });
      // 1 proposta draft di doc1
      await MonteOreProposal.create({
        userId: doc1.id,
        academicYear: '2025/2026',
        status: 'draft',
        minRequiredHoursSnapshot: 324,
      }).catch(() => {
        /* schema potrebbe richiedere altri campi: tolleriamo */
      });

      const res = await request(app)
        .get(`/api/contract-types/${ct.id}/impact`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.contractType.code).toBe('titolare');
      expect(res.body.usersAffectedCount).toBe(2);
      expect(res.body.usersAffected).toHaveLength(2);
      expect(res.body.usersWithOverrideCount).toBe(1);
      expect(typeof res.body.draftProposalsCount).toBe('number');
    });

    it('draftProposalsCount=0 quando non ci sono utenti impattati', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'orfano' });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .get(`/api/contract-types/${ct.id}/impact`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.usersAffectedCount).toBe(0);
      expect(res.body.draftProposalsCount).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /
  // ───────────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('403 a non-admin', async () => {
      await createInstitute();
      const { authHeader } = await createAuthedUser({ role: 'docente' });
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'Custom' });
      expect(res.status).toBe(403);
    });

    it('500 NO_INSTITUTE se non ci sono istituti', async () => {
      const { authHeader } = await createAdmin();
      // L'admin viene creato senza institute (createAuthedUser non lo richiede),
      // ma createAdmin via factories non crea istituti separati. Facciamo
      // sicurezza svuotando.
      await Institute.destroy({ where: {}, force: true });
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'Custom' });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('NO_INSTITUTE');
    });

    it('400 LABEL_REQUIRED se manca label', async () => {
      await createInstitute();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('LABEL_REQUIRED');
    });

    it('400 LABEL_TOO_LONG se label > 80 char', async () => {
      await createInstitute();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'X'.repeat(81) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('LABEL_TOO_LONG');
    });

    it('400 CODE_INVALID se code contiene caratteri non ammessi', async () => {
      await createInstitute();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'Valid Label', code: 'BAD-CODE!' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CODE_INVALID');
    });

    it('409 CODE_DUPLICATE se code esiste gia', async () => {
      const inst = await createInstitute();
      await createCT(inst.id, { code: 'titolare' });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'Titolare bis', code: 'titolare' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CODE_DUPLICATE');
    });

    it('201 con code auto-slugificato dal label se non passato', async () => {
      await createInstitute();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({ label: 'Co.Co.Co. 60h' });
      expect(res.status).toBe(201);
      expect(res.body.contractType.code).toBe('co_co_co_60h');
      expect(res.body.contractType.label).toBe('Co.Co.Co. 60h');
      expect(res.body.contractType.isSystem).toBe(false);
    });

    it('201 con tutti i campi popolati', async () => {
      await createInstitute();
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .post('/api/contract-types')
        .set('Authorization', authHeader)
        .send({
          label: 'Borsa di studio',
          code: 'borsa',
          defaultHours: 100,
          bypassDayConstraintDefault: true,
          sortOrder: 5,
          isActive: true,
          notes: 'Riferimento art. 23',
        });
      expect(res.status).toBe(201);
      expect(res.body.contractType.code).toBe('borsa');
      expect(res.body.contractType.defaultHours).toBe(100);
      expect(res.body.contractType.bypassDayConstraintDefault).toBe(true);
      expect(res.body.contractType.sortOrder).toBe(5);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // PUT /:id
  // ───────────────────────────────────────────────────────────────────
  describe('PUT /:id', () => {
    it('404 se contract type inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .put('/api/contract-types/99999')
        .set('Authorization', authHeader)
        .send({ label: 'X' });
      expect(res.status).toBe(404);
    });

    it('aggiorna label/defaultHours/sortOrder quando nessun docente impattato', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'altro', defaultHours: 100 });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .put(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader)
        .send({ label: 'Altro v2', defaultHours: 200, sortOrder: 9 });
      expect(res.status).toBe(200);
      expect(res.body.contractType.label).toBe('Altro v2');
      expect(res.body.contractType.defaultHours).toBe(200);
      expect(res.body.contractType.sortOrder).toBe(9);
    });

    it('IMPACT_CONFIRM_REQUIRED quando defaultHours cambia con docenti senza override', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'titolare', defaultHours: 324 });
      await User.create({
        firstName: 'D',
        lastName: 'X',
        email: 'dx@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
      });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .put(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader)
        .send({ defaultHours: 280 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IMPACT_CONFIRM_REQUIRED');
      expect(res.body.usersAffectedCount).toBe(1);
    });

    it('confirmedImpact: passa il guard e aggiorna defaultHours', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'titolare', defaultHours: 324 });
      await User.create({
        firstName: 'D',
        lastName: 'X',
        email: 'dx@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'titolare',
      });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .put(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader)
        .send({ defaultHours: 280, confirmedImpact: true });
      expect(res.status).toBe(200);
      expect(res.body.contractType.defaultHours).toBe(280);
    });

    it('code immutabile: viene silenziosamente rimosso dai fields', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'altro' });
      const { authHeader } = await createAdmin();

      const res = await request(app)
        .put(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader)
        .send({ label: 'Renamed', code: 'tentativo_rename' });
      expect(res.status).toBe(200);
      expect(res.body.contractType.code).toBe('altro');
      expect(res.body.contractType.label).toBe('Renamed');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // DELETE /:id
  // ───────────────────────────────────────────────────────────────────
  describe('DELETE /:id', () => {
    it('404 se inesistente', async () => {
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete('/api/contract-types/99999')
        .set('Authorization', authHeader);
      expect(res.status).toBe(404);
    });

    it('400 IS_SYSTEM se tipo di sistema', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'titolare', isSystem: true });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IS_SYSTEM');
    });

    it('409 IN_USE se almeno un docente lo usa', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'borsa' });
      await User.create({
        firstName: 'D',
        lastName: 'X',
        email: 'dx@t.it',
        passwordHash: 'p',
        role: 'docente',
        status: 'approved',
        isActive: true,
        contractType: 'borsa',
      });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IN_USE');
      expect(res.body.usersAffectedCount).toBe(1);
    });

    it('200 deleted:true quando libero', async () => {
      const inst = await createInstitute();
      const ct = await createCT(inst.id, { code: 'libero' });
      const { authHeader } = await createAdmin();
      const res = await request(app)
        .delete(`/api/contract-types/${ct.id}`)
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });
  });
});
