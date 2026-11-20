import type { User } from '@/types';

/**
 * Filtra gli utenti per ricerca testuale (case-insensitive) su nome, cognome,
 * email, matricola e nome corso. Termine vuoto → lista invariata.
 */
export function filterUsersBySearch(users: User[], search: string): User[] {
  const term = search.trim().toLowerCase();
  if (!term) return users;
  return users.filter((u) =>
    [u.firstName, u.lastName, u.email, u.matricola, u.course?.name].some((v) =>
      (v ?? '').toLowerCase().includes(term),
    ),
  );
}
