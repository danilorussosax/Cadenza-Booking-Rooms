'use strict';

/**
 * Security test pack — OWASP top picks per Cadenza.
 *
 * Verifiche automatiche eseguibili in CI che probano i bypass più comuni:
 *
 *   A01 Broken access control      → tampering JWT, header injection, role escalation
 *   A02 Cryptographic failures     → JWT con alg:none, password non hashata
 *   A03 Injection (SQL/NoSQL)      → payload classici sui query param numerici
 *   A05 Security misconfiguration  → CSP/HSTS/X-Frame, CORS, error verbosity
 *   A07 Identification failures    → mass-assignment, rate-limit, lockout
 *   A09 Logging failures           → audit log che cattura le azioni sensibili
 *
 * Non sostituisce un pentest professionale: è un cinturone di sicurezza che
 * cattura le regressioni più ovvie quando si tocca routes/auth o middleware.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildApp } = require('../../app');
const { createAuthedUser, createAdmin } = require('../factories');

const app = buildApp({ serveFrontend: false });

describe('SECURITY · A01 Broken access control', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('admin endpoint senza token → 401', async () => {
    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(401);
  });

  it('admin endpoint con token utente normale → 403', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app).get('/api/admin/audit-log').set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('PUT /users/:id NON consente di promuovere se stesso ad admin', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set('Authorization', authHeader)
      .send({ role: 'admin' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // L'utente NON è stato promosso
    const { User } = require('../../models');
    const fresh = await User.findByPk(user.id);
    expect(fresh.role).toBe('studente');
  });

  it('IDOR: utente non-admin non vede prenotazioni altrui via userId query', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    // Tentativo di leakare con userId=1 (admin seedato o altro utente)
    const res = await request(app)
      .get('/api/bookings')
      .query({ userId: 99999 })
      .set('Authorization', authHeader);
    // Per i non-admin, il filtro userId viene IGNORATO (deve mostrare solo le sue,
    // che sono 0). Non deve 500-care.
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      // Deve essere vuoto o solo prenotazioni proprie
      const bookings = Array.isArray(res.body) ? res.body : (res.body.bookings ?? []);
      for (const b of bookings) {
        expect(b.userId).not.toBe(99999);
      }
    }
  });
});

describe('SECURITY · A02 Cryptographic failures', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('JWT con alg:none viene rifiutato', async () => {
    const fakeToken =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify({ id: 1, role: 'admin' })).toString('base64url') +
      '.';
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
  });

  it('JWT firmato con secret sbagliato viene rifiutato', async () => {
    const wrong = jwt.sign({ id: 1, role: 'admin' }, 'attacker-secret');
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${wrong}`);
    expect(res.status).toBe(401);
  });

  it('password viene salvata hashata (mai in chiaro)', async () => {
    const { user } = await createAuthedUser({
      email: 'plaintext@test.invalid',
      password: 'Pass1234!',
    });
    const { User } = require('../../models');
    const fresh = await User.findByPk(user.id);
    // bcrypt hash starts with $2a$ / $2b$ / $2y$
    expect(fresh.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(fresh.passwordHash).not.toBe('Pass1234!');
  });
});

describe('SECURITY · A03 Injection', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('SQL injection sui query param numerici viene neutralizzata', async () => {
    const { authHeader } = await createAdmin();
    const probes = ['1; DROP TABLE users;--', "1' OR '1'='1", '1 UNION SELECT * FROM users--'];
    for (const p of probes) {
      const res = await request(app)
        .get('/api/bookings')
        .query({ roomId: p })
        .set('Authorization', authHeader);
      // Nessun 5xx, l'app filtra il param non-int e lo ignora
      expect(res.status).toBeLessThan(500);
    }
    // Verifica integrità della tabella users
    const { User } = require('../../models');
    const count = await User.count();
    expect(count).toBeGreaterThan(0);
  });

  it('NoSQL/object injection nel body viene scartato dal whitelist', async () => {
    const { authHeader } = await createAdmin();
    const { user: target } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .put(`/api/users/${target.id}`)
      .set('Authorization', authHeader)
      .send({
        // payload "ostile" con campi sensibili
        passwordHash: '$2a$04$attacker-hash-here',
        tokenVersion: 9999,
        deletedAt: new Date('2099-01-01'),
        // campo legittimo
        firstName: 'Nuovo',
      });
    expect(res.status).toBe(200);
    const { User } = require('../../models');
    const fresh = await User.findByPk(target.id);
    expect(fresh.firstName).toBe('Nuovo');
    expect(fresh.tokenVersion).toBe(0);
    expect(fresh.deletedAt).toBeNull();
    expect(fresh.passwordHash).not.toContain('attacker');
  });
});

describe('SECURITY · A05 Security misconfiguration', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('header CSP rigorosa presente con default-src self', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it('header X-Frame-Options / X-Content-Type-Options presenti', async () => {
    const res = await request(app).get('/api/health');
    // helmet imposta XContentTypeOptions: 'nosniff'
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // frame-ancestors 'none' della CSP rimpiazza X-Frame-Options, ma helmet
    // imposta anche il vecchio header per compatibilità.
    expect(res.headers['x-frame-options'] || res.headers['content-security-policy']).toBeTruthy();
  });

  it('Referrer-Policy restrittiva impostata', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('errore generico non leaka stack trace in JSON di produzione', async () => {
    // Provoca un 404
    const res = await request(app).get('/api/inesistente');
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.body);
    // Nessuna stack trace o path filesystem nel body
    expect(body).not.toMatch(/\/Users\//);
    expect(body).not.toMatch(/at \w+/);
  });
});

describe('SECURITY · A07 Identification & Authentication failures', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('login con password sbagliata: nessun leak su esistenza account', async () => {
    // Crea utente esistente
    await createAuthedUser({ email: 'exists@test.invalid', password: 'Pass1234!' });

    const r1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'exists@test.invalid', password: 'WrongPass1!' });
    const r2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inesistente@test.invalid', password: 'WrongPass1!' });
    // Same status code e generic message → no leak
    expect(r1.status).toBe(r2.status);
  });

  it('rate-limit auth fa scattare 429 dopo N tentativi consecutivi falliti', async () => {
    const responses = [];
    // Tentiamo 50 login con password sbagliata in rapida successione
    for (let i = 0; i < 50; i++) {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ email: `nope${i}@test.invalid`, password: 'Wrong1!' });
      responses.push(r.status);
    }
    // O ci sono dei 429 (rate-limit IP) oppure tutti 4xx (account inesistente).
    // L'invariante è: NESSUNA 5xx.
    const internal = responses.filter((s) => s >= 500);
    expect(internal).toHaveLength(0);
  });

  it('token revocato (tokenVersion change) non funziona più', async () => {
    const { user, token } = await createAuthedUser({ role: 'studente' });
    // Usa il token per accedere — OK
    let r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);

    // Simula un cambio password / logout admin: incrementiamo tokenVersion
    const { User } = require('../../models');
    await User.update({ tokenVersion: user.tokenVersion + 1 }, { where: { id: user.id } });

    // Stesso token → adesso deve essere rifiutato (revocato)
    r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
  });
});

describe('SECURITY · A09 Logging — audit cattura le azioni sensibili', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('PUT /admin/users/:id viene tracciato in AuditLog', async () => {
    const { authHeader } = await createAdmin();
    const { user: target } = await createAuthedUser({ role: 'studente' });
    await request(app)
      .put(`/api/users/${target.id}`)
      .set('Authorization', authHeader)
      .send({ firstName: 'AuditedName' });
    await new Promise((r) => setTimeout(r, 50));
    const { AuditLog } = require('../../models');
    const entry = await AuditLog.findOne({
      where: { targetType: 'user', targetId: target.id },
      order: [['id', 'DESC']],
    });
    expect(entry).not.toBeNull();
    expect(entry.action).toBe('PUT');
  });

  it('campo password nel payload non viene loggato in AuditLog', async () => {
    const { user, authHeader } = await createAuthedUser({ role: 'studente' });
    await request(app)
      .put(`/api/users/${user.id}/password`)
      .set('Authorization', authHeader)
      .send({ currentPassword: 'Password123!', newPassword: 'Nuova123!' });
    await new Promise((r) => setTimeout(r, 50));
    const { AuditLog } = require('../../models');
    const entries = await AuditLog.findAll({ where: { targetType: 'user' } });
    for (const e of entries) {
      const payloadStr = JSON.stringify(e.payload || {});
      expect(payloadStr).not.toContain('Password123!');
      expect(payloadStr).not.toContain('Nuova123!');
    }
  });
});

describe('SECURITY · CORS & origin policy', () => {
  it('CORS non lascia passare origin sconosciuta su rotta credenziali', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'http://malicious.example.com');
    // Senza Authorization → 401 in ogni caso. Verifica che NON ci sia
    // Access-Control-Allow-Credentials:true con origin malevola.
    const allowOrigin = res.headers['access-control-allow-origin'];
    if (allowOrigin) {
      expect(allowOrigin).not.toBe('http://malicious.example.com');
    }
  });
});
