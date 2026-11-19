'use strict';

const { DomainError, domainError, httpError } = require('../../lib/domainError');

describe('domainError', () => {
  it('espone status/code/details compatibili con il gestore centrale di app.js', () => {
    const err = domainError('STALE_GRID', 'Rigenera la griglia', {
      status: 409,
      details: [{ field: 'x', message: 'y' }],
      fields: ['x'],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ status: 409, code: 'STALE_GRID', message: 'Rigenera la griglia' });
    expect(err.details).toEqual([{ field: 'x', message: 'y' }]);
    expect(err.fields).toEqual(['x']);
  });

  it('usa status 400 di default e omette details/fields se assenti', () => {
    const err = domainError('EMPTY_PLAN', 'm');
    expect(err.status).toBe(400);
    expect('details' in err).toBe(false);
    expect('fields' in err).toBe(false);
  });

  it('supporta `extra` per campi non standard (opt-in, assente di default)', () => {
    expect('extra' in domainError('X', 'm')).toBe(false);
    expect(domainError('X', 'm', { extra: { field: 'email' } }).extra).toEqual({ field: 'email' });
  });
});

describe('httpError', () => {
  it('crea un DomainError senza code (errori storici { error })', () => {
    const err = httpError(404, 'Non trovato', { extra: { retryAfter: 3 } });
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Non trovato');
    expect('code' in err).toBe(false);
    expect(err.extra).toEqual({ retryAfter: 3 });
  });
});

describe('gestore centrale (app.js)', () => {
  const express = require('express');
  const request = require('supertest');
  const { buildApp } = require('../../app');

  // Il gestore è l'ultimo middleware dello stack di buildApp: lo estraiamo e lo
  // montiamo su un'app minimale che lancia errori controllati.
  function mountHandler(err) {
    const full = buildApp();
    const layers = full._router ? full._router.stack : full.router.stack;
    const handler = layers[layers.length - 1].handle;
    const app = express();
    app.get('/t', (_req, _res, next) => next(err));
    app.use(handler);
    return app;
  }

  it('rende code, details, fields ed extra', async () => {
    const res = await request(
      mountHandler(
        domainError('C', 'msg', {
          status: 409,
          details: [1],
          fields: ['f'],
          extra: { field: 'f' },
        }),
      ),
    ).get('/t');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'msg', code: 'C', details: [1], fields: ['f'], field: 'f' });
  });

  it('rende httpError senza code', async () => {
    const res = await request(mountHandler(httpError(404, 'nope'))).get('/t');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'nope' });
  });
});
