import { describe, expect, it } from 'vitest';
import { filterUsersBySearch } from '@/lib/userFilter';
import type { User } from '@/types';

function user(over: Partial<User>): User {
  return {
    id: 1,
    email: 'a@b.it',
    firstName: 'Anna',
    lastName: 'Rossi',
    role: 'studente',
    status: 'approved',
    isActive: true,
    ...over,
  } as User;
}

const users = [
  user({ id: 1, firstName: 'Anna', lastName: 'Rossi', matricola: 'M123' }),
  user({ id: 2, firstName: 'Luca', lastName: 'Bianchi', email: 'luca@x.it', matricola: null }),
  user({
    id: 3,
    firstName: 'Zoe',
    lastName: 'Verdi',
    course: { id: 9, code: 'PF', name: 'Pianoforte' } as User['course'],
  }),
];

describe('filterUsersBySearch', () => {
  it('ritorna la lista invariata con termine vuoto o solo spazi', () => {
    expect(filterUsersBySearch(users, '')).toBe(users);
    expect(filterUsersBySearch(users, '   ')).toBe(users);
  });

  it('cerca case-insensitive su nome, cognome, email, matricola e corso', () => {
    expect(filterUsersBySearch(users, 'ANNA').map((u) => u.id)).toEqual([1]);
    expect(filterUsersBySearch(users, 'bianchi').map((u) => u.id)).toEqual([2]);
    expect(filterUsersBySearch(users, 'luca@x').map((u) => u.id)).toEqual([2]);
    expect(filterUsersBySearch(users, 'm123').map((u) => u.id)).toEqual([1]);
    expect(filterUsersBySearch(users, 'pianof').map((u) => u.id)).toEqual([3]);
  });

  it('gestisce campi null/undefined senza errori e nessun match', () => {
    expect(filterUsersBySearch(users, 'zzz')).toEqual([]);
  });
});
