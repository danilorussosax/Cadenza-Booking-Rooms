'use strict';

/**
 * Integration: POST /api/csp-report — riceve CSP violation reports dal
 * browser (legacy `application/csp-report` + moderna Reporting API).
 *
 * Verifica:
 *   - 204 sempre, anche su payload vuoto/malformato (no info leak)
 *   - Parse di entrambe le sintassi (legacy `{csp-report: {...}}` +
 *     Reporting API array `[{type, body}]`)
 *   - Header `Reporting-Endpoints` presente su tutte le response
 */

const request = require('supertest');
const { buildApp } = require('../../app');

const app = buildApp({ serveFrontend: false });

describe('POST /api/csp-report', () => {
  it('204 su payload legacy csp-report', async () => {
    // Content-Type `application/csp-report` non è registrato in superagent
    // come JSON serializer → passiamo la stringa JSON manualmente.
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.it/page',
        'violated-directive': "script-src 'self'",
        'blocked-uri': 'https://evil.example.com/x.js',
        'source-file': 'https://example.it/app.js',
        'line-number': 42,
        disposition: 'enforce',
      },
    });
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(body);
    expect(res.status).toBe(204);
  });

  it('204 su Reporting API moderna (array)', async () => {
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send([
        {
          type: 'csp-violation',
          age: 0,
          body: {
            documentURL: 'https://example.it/page',
            effectiveDirective: 'img-src',
            blockedURL: 'https://malicious.cdn/img.png',
            disposition: 'enforce',
          },
        },
      ]);
    expect(res.status).toBe(204);
  });

  it('204 su array misto (alcuni report non-CSP vengono ignorati)', async () => {
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send([
        { type: 'deprecation', body: { id: 'X' } },
        { type: 'csp-violation', body: { effectiveDirective: 'frame-src' } },
      ]);
    expect(res.status).toBe(204);
  });

  it('204 su body vuoto', async () => {
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(204);
  });

  it('204 su body singolo non incartato', async () => {
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/json')
      .send({
        'violated-directive': 'style-src',
        'blocked-uri': 'inline',
      });
    expect(res.status).toBe(204);
  });

  it('endpoint NON richiede autenticazione', async () => {
    const body = JSON.stringify({
      'csp-report': { 'violated-directive': 'default-src' },
    });
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(body);
    expect(res.status).toBe(204);
    // no 401
  });
});

describe('CSP headers globali', () => {
  it('Reporting-Endpoints presente su tutte le response', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['reporting-endpoints']).toContain('cadenza-csp');
    expect(res.headers['reporting-endpoints']).toContain('/api/csp-report');
  });

  it('Content-Security-Policy include report-uri e report-to', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to cadenza-csp');
  });
});
