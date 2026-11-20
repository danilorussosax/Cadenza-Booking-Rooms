'use strict';

const { can, assertCan, ACTIONS } = require('../../lib/access');

const actors = {
  admin: { id: 1, role: 'admin' },
  teacher: { id: 2, role: 'teacher' },
  student: { id: 3, role: 'student' },
};
const ADMIN_ONLY = new Set(['loan:cancel-processed']);

describe('lib/access can()', () => {
  const cases = [];
  for (const action of Object.keys(ACTIONS)) {
    for (const [role, actor] of Object.entries(actors)) {
      for (const owned of [true, false]) {
        const expected = ADMIN_ONLY.has(action) ? role === 'admin' : role === 'admin' || owned;
        cases.push([action, role, owned, expected, actor.id]);
      }
    }
  }

  it.each(cases)('%s | %s | proprietario=%s -> %s', (action, role, owned, expected, id) => {
    const resource = { userId: owned ? id : 999 };
    expect(can(actors[role], action, resource)).toBe(expected);
  });

  it('copre le azioni richieste', () => {
    for (const a of [
      'booking:view',
      'booking:cancel',
      'booking:modify',
      'loan:view',
      'loan:modify',
      'waitlist:remove',
      'concert:modify',
    ]) {
      expect(ACTIONS[a]).toBeDefined();
    }
  });

  it('azione sconosciuta o actor assente: nega', () => {
    expect(can(actors.admin, 'nope:nope', { userId: 1 })).toBe(false);
    expect(can(null, 'booking:view', { userId: 1 })).toBe(false);
    expect(can(actors.student, 'booking:view', undefined)).toBe(false);
    expect(can(actors.admin, 'booking:view', undefined)).toBe(true);
  });

  it('assertCan lancia 403 FORBIDDEN', () => {
    expect(() => assertCan(actors.student, 'loan:view', { userId: 3 })).not.toThrow();
    let err;
    try {
      assertCan(actors.student, 'loan:view', { userId: 9 });
    } catch (e) {
      err = e;
    }
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Non autorizzato');
  });
});
