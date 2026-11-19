'use strict';

const { DomainError, domainError } = require('../../lib/domainError');

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
});
