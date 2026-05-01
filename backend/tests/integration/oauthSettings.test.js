'use strict';

/**
 * P2-2 — Smoke test su /api/admin/oauth-settings.
 *
 * Verifica:
 *   - 401 senza auth
 *   - 403 con role !== admin
 *   - GET ritorna settings (con secret mascherato)
 *   - PUT con SECRET_PLACEHOLDER NON sovrascrive il secret esistente
 *   - PUT con stringa vuota cancella il secret
 *   - PUT con nuova stringa cifra e salva il secret (non plain in DB)
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { OAuthSettings } = require('../../models');
const { createAuthedUser, createAdmin } = require('../factories');

const SECRET_PLACEHOLDER = '__unchanged__';

describe('GET/PUT /api/admin/oauth-settings', () => {
  let app;
  beforeAll(async () => {
    app = await buildApp({ serveFrontend: false });
  });
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('401 senza auth', async () => {
    const res = await request(app).get('/api/admin/oauth-settings');
    expect(res.status).toBe(401);
  });

  it('403 se non admin', async () => {
    const { authHeader } = await createAuthedUser({ role: 'studente' });
    const res = await request(app)
      .get('/api/admin/oauth-settings')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
  });

  it('GET admin: ritorna settings senza esporre il secret in chiaro', async () => {
    const { authHeader } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/oauth-settings')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
    const s = res.body.settings;
    // Il safe dto espone *Set: bool, NON il secret stesso
    expect(typeof s.googleClientSecretSet).toBe('boolean');
    expect(typeof s.microsoftClientSecretSet).toBe('boolean');
    expect(s.googleClientSecret).toBeUndefined();
    expect(s.microsoftClientSecret).toBeUndefined();
  });

  it('PUT: imposta clientId + secret nuovo, GET successivo non espone il secret', async () => {
    const { authHeader } = await createAdmin();
    const put = await request(app)
      .put('/api/admin/oauth-settings')
      .set('Authorization', authHeader)
      .send({
        googleEnabled: true,
        googleClientId: 'my-google-id.apps.googleusercontent.com',
        googleClientSecret: 'super-secret-from-google',
      });
    expect(put.status).toBe(200);
    expect(put.body.restartRequired).toBe(true);

    // Verifica DB diretto: il secret cifrato NON deve essere "super-secret-from-google" plain
    const persisted = await OAuthSettings.findOne();
    expect(persisted).toBeTruthy();
    expect(persisted.googleClientSecretEncrypted).toBeTruthy();
    expect(persisted.googleClientSecretEncrypted).not.toContain('super-secret-from-google');

    // GET successivo: client id visibile, secretSet=true
    const get = await request(app)
      .get('/api/admin/oauth-settings')
      .set('Authorization', authHeader);
    expect(get.body.settings.googleClientId).toBe('my-google-id.apps.googleusercontent.com');
    expect(get.body.settings.googleClientSecretSet).toBe(true);
    expect(get.body.settings.googleClientSecret).toBeUndefined();
  });

  it('PUT con SECRET_PLACEHOLDER preserva il secret esistente', async () => {
    const { authHeader } = await createAdmin();
    // Setup: imposta un secret
    await request(app).put('/api/admin/oauth-settings').set('Authorization', authHeader).send({
      googleEnabled: true,
      googleClientId: 'id-1',
      googleClientSecret: 'first-secret-value',
    });
    const beforeRow = await OAuthSettings.findOne();
    const beforeEnc = beforeRow.googleClientSecretEncrypted;
    expect(beforeEnc).toBeTruthy();

    // Update SOLO clientId, mantenendo secret invariato (placeholder)
    await request(app).put('/api/admin/oauth-settings').set('Authorization', authHeader).send({
      googleClientId: 'id-2',
      googleClientSecret: SECRET_PLACEHOLDER,
    });

    const afterRow = await OAuthSettings.findOne();
    expect(afterRow.googleClientId).toBe('id-2');
    // Il secret cifrato deve essere identico (non rigenerato)
    expect(afterRow.googleClientSecretEncrypted).toBe(beforeEnc);
  });

  it('PUT con stringa vuota cancella il secret', async () => {
    const { authHeader } = await createAdmin();
    await request(app)
      .put('/api/admin/oauth-settings')
      .set('Authorization', authHeader)
      .send({ googleClientSecret: 'a-secret-to-be-removed' });
    expect((await OAuthSettings.findOne()).googleClientSecretEncrypted).toBeTruthy();

    await request(app)
      .put('/api/admin/oauth-settings')
      .set('Authorization', authHeader)
      .send({ googleClientSecret: '' });
    expect((await OAuthSettings.findOne()).googleClientSecretEncrypted).toBeNull();
  });
});
