'use strict';

/**
 * Unit lib helpers piccoli ma con branch coverage bassa:
 *   - lib/pgBin.js — resolver path pg_dump/psql (env override + auto-detect)
 *   - routes/appIcons.js helper listIcons (indirettamente via mount)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('lib/pgBin · resolver path Postgres tools', () => {
  let tmpDir;
  let tmpBin;
  const origEnv = { PG_DUMP_PATH: process.env.PG_DUMP_PATH, PSQL_PATH: process.env.PSQL_PATH };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-pgbin-'));
    tmpBin = path.join(tmpDir, 'pg_dump');
    fs.writeFileSync(tmpBin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(tmpBin, 0o755);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    if (origEnv.PG_DUMP_PATH === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = origEnv.PG_DUMP_PATH;
    if (origEnv.PSQL_PATH === undefined) delete process.env.PSQL_PATH;
    else process.env.PSQL_PATH = origEnv.PSQL_PATH;
  });

  it('env PG_DUMP_PATH valido → ritorna quel path', () => {
    process.env.PG_DUMP_PATH = tmpBin;
    delete require.cache[require.resolve('../../lib/pgBin')];
    const { resolvePgDump } = require('../../lib/pgBin');
    expect(resolvePgDump()).toBe(tmpBin);
  });

  it('env PG_DUMP_PATH inesistente → fallback (auto-detect o nome binario nudo)', () => {
    process.env.PG_DUMP_PATH = '/nope/does/not/exist/pg_dump';
    delete require.cache[require.resolve('../../lib/pgBin')];
    const { resolvePgDump } = require('../../lib/pgBin');
    const out = resolvePgDump();
    // O un candidato di sistema esiste (es. /usr/local/bin/pg_dump) o
    // ricade sul nome nudo "pg_dump". In ogni caso != path inesistente.
    expect(out).not.toBe('/nope/does/not/exist/pg_dump');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/pg_dump$/);
  });

  it('senza env → ritorna un path candidato o il nome nudo', () => {
    delete process.env.PSQL_PATH;
    delete require.cache[require.resolve('../../lib/pgBin')];
    const { resolvePsql } = require('../../lib/pgBin');
    const out = resolvePsql();
    expect(typeof out).toBe('string');
    expect(out).toMatch(/psql$/);
  });
});

describe('routes/appIcons · GET /api/app-icons', () => {
  const request = require('supertest');
  const { buildApp } = require('../../app');
  const app = buildApp();

  it('200 + payload {icons: Array}', async () => {
    const res = await request(app).get('/api/app-icons');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.icons)).toBe(true);
  });

  it('imposta Cache-Control public 60s', async () => {
    const res = await request(app).get('/api/app-icons');
    expect(res.headers['cache-control']).toContain('max-age=60');
  });

  it('ogni icona ha shape {name, url, size, mtime}', async () => {
    const res = await request(app).get('/api/app-icons');
    for (const it of res.body.icons) {
      expect(typeof it.name).toBe('string');
      expect(it.url).toMatch(/^\/logo-app\//);
      expect(typeof it.size).toBe('number');
      expect(typeof it.mtime).toBe('string');
    }
  });

  it('esclude i file blacklist (cadenza.png, cadenza-bars.svg, cadenza-classic.png) se presenti', async () => {
    const res = await request(app).get('/api/app-icons');
    const names = res.body.icons.map((i) => i.name);
    expect(names).not.toContain('cadenza.png');
    expect(names).not.toContain('cadenza-bars.svg');
    expect(names).not.toContain('cadenza-classic.png');
  });
});
