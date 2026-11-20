'use strict';

const { isAdmin, isOwner, isOwnerOrAdmin, assertOwnerOrAdmin } = require('../../lib/access');

const admin = { id: 1, role: 'admin' };
const teacher = { id: 2, role: 'teacher' };
const student = { id: 3, role: 'student' };

describe('lib/access', () => {
  it('isAdmin: solo role admin', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(teacher)).toBe(false);
    expect(isAdmin(student)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({})).toBe(false);
  });

  it('isOwner: confronto stretto sull id', () => {
    expect(isOwner(student, 3)).toBe(true);
    expect(isOwner(student, 4)).toBe(false);
    expect(isOwner(student, '3')).toBe(false);
    expect(isOwner(student, null)).toBe(false);
    expect(isOwner(null, 3)).toBe(false);
    expect(isOwner({ role: 'student' }, undefined)).toBe(false);
  });

  it.each([
    ['admin proprietario', admin, 1, true],
    ['admin non proprietario', admin, 99, true],
    ['teacher proprietario', teacher, 2, true],
    ['teacher non proprietario', teacher, 99, false],
    ['student proprietario', student, 3, true],
    ['student non proprietario', student, 99, false],
    ['utente assente', null, 3, false],
    ['admin con owner null', admin, null, true],
  ])('isOwnerOrAdmin: %s', (_n, user, ownerId, expected) => {
    expect(isOwnerOrAdmin(user, ownerId)).toBe(expected);
  });

  it('assertOwnerOrAdmin: non lancia se proprietario o admin', () => {
    expect(() => assertOwnerOrAdmin(student, 3)).not.toThrow();
    expect(() => assertOwnerOrAdmin(admin, 99)).not.toThrow();
  });

  it('assertOwnerOrAdmin: 403 FORBIDDEN "Non autorizzato" altrimenti', () => {
    let err;
    try {
      assertOwnerOrAdmin(teacher, 99);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Non autorizzato');
  });

  it('assertOwnerOrAdmin: code/message personalizzabili', () => {
    expect(() => assertOwnerOrAdmin(student, 1, { code: 'X', message: 'No' })).toThrow('No');
  });
});
