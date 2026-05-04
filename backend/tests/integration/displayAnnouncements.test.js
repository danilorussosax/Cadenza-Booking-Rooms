'use strict';

/**
 * Verifica end-to-end che il flusso "admin pubblica annuncio →
 * /display lo riceve via /api/public/announcements" funzioni:
 *
 *   1. Un annuncio creato dall'admin compare nell'endpoint pubblico.
 *   2. ?pinned=true filtra solo i pinnati (rotazione kiosk in modalità pinned).
 *   3. isActive=false → escluso.
 *   4. expiresAt nel passato → escluso.
 *   5. publishedAt futuro → escluso (drafts).
 *   6. audience.kind='building' → mostrato solo al kiosk dell'edificio target.
 *   7. ordinamento: pinned prima, poi publishedAt DESC.
 */

const request = require('supertest');
const { buildApp } = require('../../app');
const { createAdmin, createBuilding } = require('../factories');
const { Announcement } = require('../../models');

const app = buildApp({ serveFrontend: false });

describe('display announcements pipeline', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('admin POST → GET /api/public/announcements lo restituisce', async () => {
    const { authHeader } = await createAdmin();
    const create = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', authHeader)
      .send({ title: 'Avviso istituzionale', body: 'Corpo dell’avviso' });
    expect([200, 201]).toContain(create.status);

    const pub = await request(app).get('/api/public/announcements');
    expect(pub.status).toBe(200);
    expect(pub.body.announcements).toHaveLength(1);
    expect(pub.body.announcements[0]).toMatchObject({
      title: 'Avviso istituzionale',
      body: 'Corpo dell’avviso',
      isPinned: false,
    });
  });

  it('?pinned=true → solo i pinnati', async () => {
    await Announcement.create({ title: 'Normale', body: 'x', isPinned: false });
    await Announcement.create({ title: 'In evidenza', body: 'y', isPinned: true });

    const all = await request(app).get('/api/public/announcements');
    expect(all.status).toBe(200);
    expect(all.body.announcements).toHaveLength(2);

    const onlyPinned = await request(app).get('/api/public/announcements?pinned=true');
    expect(onlyPinned.status).toBe(200);
    expect(onlyPinned.body.announcements).toHaveLength(1);
    expect(onlyPinned.body.announcements[0].title).toBe('In evidenza');
  });

  it('isActive=false → non viene pubblicato sul display', async () => {
    await Announcement.create({ title: 'Disattivato', body: 'x', isActive: false });
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.announcements).toHaveLength(0);
  });

  it('expiresAt nel passato → escluso', async () => {
    await Announcement.create({
      title: 'Scaduto',
      body: 'x',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.announcements).toHaveLength(0);
  });

  it('publishedAt futuro → escluso (draft schedulato)', async () => {
    await Announcement.create({
      title: 'Futuro',
      body: 'x',
      publishedAt: new Date(Date.now() + 60 * 60_000),
    });
    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.announcements).toHaveLength(0);
  });

  it('audience=building → visibile solo al kiosk del building target', async () => {
    const b1 = await createBuilding();
    const b2 = await createBuilding();
    await Announcement.create({
      title: 'Solo edificio 1',
      body: 'x',
      audience: { kind: 'building', value: b1.id },
    });
    await Announcement.create({
      title: 'Tutti',
      body: 'y',
      audience: { kind: 'all' },
    });

    const kioskB1 = await request(app).get(`/api/public/announcements?building=${b1.id}`);
    expect(kioskB1.status).toBe(200);
    const titlesB1 = kioskB1.body.announcements.map((a) => a.title).sort();
    expect(titlesB1).toEqual(['Solo edificio 1', 'Tutti']);

    const kioskB2 = await request(app).get(`/api/public/announcements?building=${b2.id}`);
    expect(kioskB2.status).toBe(200);
    const titlesB2 = kioskB2.body.announcements.map((a) => a.title).sort();
    expect(titlesB2).toEqual(['Tutti']);

    // Senza ?building → kiosk generico vede tutto, anche i building-targeted
    const generic = await request(app).get('/api/public/announcements');
    expect(generic.body.announcements.map((a) => a.title).sort()).toEqual([
      'Solo edificio 1',
      'Tutti',
    ]);
  });

  it('ordinamento: pinnati prima, poi publishedAt DESC', async () => {
    const now = Date.now();
    await Announcement.create({
      title: 'Vecchio normale',
      body: 'x',
      publishedAt: new Date(now - 3 * 86_400_000),
    });
    await Announcement.create({
      title: 'Recente normale',
      body: 'x',
      publishedAt: new Date(now - 86_400_000),
    });
    await Announcement.create({
      title: 'Pinnato vecchio',
      body: 'x',
      isPinned: true,
      publishedAt: new Date(now - 5 * 86_400_000),
    });

    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.announcements.map((a) => a.title)).toEqual([
      'Pinnato vecchio',
      'Recente normale',
      'Vecchio normale',
    ]);
  });
});
